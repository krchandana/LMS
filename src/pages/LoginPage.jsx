import { useState } from "react";
import { BookOpenCheck, Eye, EyeOff, GraduationCap, ShieldCheck, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import heroImage from "../assets/hero.png";
import { supabase } from "../lib/supabaseClient";

const approvedStudentStatuses = ["active", "approved"];
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const hasServiceRoleKey = Boolean(serviceRoleKey);

const isAuthServiceUnavailable = (error) => {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return message.includes("504") || message.includes("failed to fetch") || message.includes("network") || message.includes("timeout");
};

const normalizeStudentId = (studentId) => studentId.trim().toUpperCase();
const studentAuthEmailFor = (studentId) => `${normalizeStudentId(studentId).toLowerCase()}@student.local`;

const isMissingTableError = (error) =>
  error?.message?.toLowerCase().includes("could not find the table") ||
  error?.message?.toLowerCase().includes("schema cache");

const isStackDepthError = (error) => {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return message.includes("stack depth limit exceeded");
};

const adminAuthRequest = async (path, method, body) => {
  if (!hasServiceRoleKey) {
    return { error: { message: "Service role key is not configured." } };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/admin${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return response.ok ? { data } : { error: data };
};

const serviceRoleTableRequest = async (table, path, method, body, extraHeaders = {}) => {
  if (!hasServiceRoleKey) {
    return { error: { message: "Service role key is not configured." } };
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return response.ok ? { data } : { error: data };
};

const ensureAdminAuthUser = async ({ email, password }) => {
  if (!hasServiceRoleKey) {
    return { error: { message: "Admin auth bootstrap requires service role configuration." } };
  }

  const listResult = await adminAuthRequest("/users?page=1&per_page=1000", "GET");
  if (listResult.error) return { error: listResult.error };

  const users = listResult.data?.users || [];
  const existingUser = users.find((user) => (user?.email || "").toLowerCase() === email.toLowerCase());

  if (existingUser?.id) {
    const updateResult = await adminAuthRequest(`/users/${existingUser.id}`, "PUT", {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata || {}),
        full_name: existingUser.user_metadata?.full_name || email,
        role: "admin",
        status: "active",
      },
    });

    if (updateResult.error) return { error: updateResult.error };
    return { data: updateResult.data?.user || updateResult.data || existingUser };
  }

  const createResult = await adminAuthRequest("/users", "POST", {
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: email,
      role: "admin",
      status: "active",
    },
  });

  if (createResult.error) return { error: createResult.error };
  return { data: createResult.data?.user || createResult.data };
};

const insertWithColumnFallback = async (table, payload) => {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(nextPayload).select().single();
    if (!error) return { data };

    if (isMissingTableError(error)) return { data: null, skipped: true };

    const message = error.message || "";
    const missingColumnMatch = message.match(/column "([^"]+)"/i) || message.match(/'([^']+)' column/i);
    if (!missingColumnMatch) {
      if (!hasServiceRoleKey) return { error };

      const serviceInsert = await serviceRoleTableRequest(table, "?select=*", "POST", nextPayload);
      if (serviceInsert.error) return serviceInsert;

      return { data: Array.isArray(serviceInsert.data) ? serviceInsert.data[0] : serviceInsert.data };
    }

    const missingColumn = missingColumnMatch[1];
    if (!Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)) return { error };

    const remainingPayload = { ...nextPayload };
    delete remainingPayload[missingColumn];
    nextPayload = remainingPayload;
  }

  return { error: { message: "Unable to save the request with the available columns." } };
};

const upsertWithColumnFallback = async (table, payload, options) => {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from(table).upsert(nextPayload, options).select().single();
    if (!error) return { data };

    const message = error.message || "";
    const missingColumnMatch = message.match(/column "([^"]+)"/i) || message.match(/'([^']+)' column/i);
    if (!missingColumnMatch) {
      if (!hasServiceRoleKey) return { error };

      const query = options?.onConflict
        ? `?on_conflict=${encodeURIComponent(options.onConflict)}&select=*`
        : "?select=*";
      const serviceUpsert = await serviceRoleTableRequest(table, query, "POST", nextPayload, {
        Prefer: "return=representation,resolution=merge-duplicates",
      });
      if (serviceUpsert.error) return serviceUpsert;

      return { data: Array.isArray(serviceUpsert.data) ? serviceUpsert.data[0] : serviceUpsert.data };
    }

    const missingColumn = missingColumnMatch[1];
    if (!Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)) return { error };

    const remainingPayload = { ...nextPayload };
    delete remainingPayload[missingColumn];
    nextPayload = remainingPayload;
  }

  return { error: { message: "Unable to save the profile with the available columns." } };
};

const findApprovedStudentProfileByColumn = async (column, value) => {
  if (!value) return { data: null };

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq(column, value)
    .eq("role", "student")
    .in("status", approvedStudentStatuses)
    .maybeSingle();

  if (!error) return { data };

  const message = error.message || "";
  const missingColumn = message.match(/column "([^"]+)"/i) || message.match(/'([^']+)' column/i);
  if (missingColumn) return { data: null };

  return { error };
};

const findLatestAccessRequestByEmail = async (email) => {
  const safeEmail = (email || "").trim();
  if (!safeEmail) return { data: null };

  const { data, error } = await supabase
    .from("access_requests")
    .select("id,email,status,student_id,student_login_id")
    .eq("email", safeEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error) return { data };

  const message = error.message || "";
  if (isMissingTableError(error)) return { data: null, skipped: true };
  const missingColumn = message.match(/column "([^"]+)"/i) || message.match(/'([^']+)' column/i);
  if (missingColumn) return { data: null };

  return { error };
};

const repairApprovedStudentProfile = async ({ profile, studentId, authEmail, user }) => {
  const currentStatus = (profile?.status || "").toLowerCase();
  if (approvedStudentStatuses.includes(currentStatus)) {
    return { approved: true };
  }

  const metadataStatus = (user?.user_metadata?.status || "").toLowerCase();
  const metadataStudentId = user?.user_metadata?.student_id ? normalizeStudentId(user.user_metadata.student_id) : "";
  let approvedProfile = null;

  if (metadataStudentId === studentId && approvedStudentStatuses.includes(metadataStatus)) {
    approvedProfile = {
      full_name: user.user_metadata.full_name,
      email: user.user_metadata.registered_email,
      status: metadataStatus,
    };
  }

  const lookups = [
    ["auth_email", authEmail],
    ["student_id", studentId],
    ["student_login_id", studentId],
    ["email", user?.user_metadata?.registered_email],
  ];

  for (const [column, value] of lookups) {
    if (approvedProfile) break;
    const result = await findApprovedStudentProfileByColumn(column, value);
    if (result.error) return { error: result.error };
    if (result.data) approvedProfile = result.data;
  }

  if (!approvedProfile) return { approved: false };

  const repairPayload = {
    id: user.id,
    email: approvedProfile.email || user.user_metadata?.registered_email || profile?.email || user.email,
    auth_email: authEmail,
    full_name: approvedProfile.full_name || approvedProfile.name || user.user_metadata?.full_name || profile?.full_name,
    role: "student",
    status: approvedProfile.status || "active",
    student_id: studentId,
    student_login_id: studentId,
  };
  const repairResult = await upsertWithColumnFallback("profiles", repairPayload, { onConflict: "id" });

  if (repairResult.error) {
    if (isStackDepthError(repairResult.error)) {
      return { approved: true };
    }

    return { error: repairResult.error };
  }

  return { approved: true };
};

const LoginPage = () => {
  const [role, setRole] = useState("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [credential, setCredential] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [password, setPassword] = useState("");
  const [studentMode, setStudentMode] = useState("login");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const submitStudentRequest = async (emailToUse) => {
    if (!studentName.trim()) {
      setError("Please enter your name.");
      return;
    }

    const studentId = `STU${Date.now().toString().slice(-8)}`;
    const authEmail = studentAuthEmailFor(studentId);
    const temporaryPassword = `Pending@${Date.now().toString().slice(-6)}`;

    const existingRequestResult = await findLatestAccessRequestByEmail(emailToUse);
    if (existingRequestResult.error) {
      setError(existingRequestResult.error.message || "Unable to validate existing student request.");
      return;
    }

    if (existingRequestResult.skipped) {
      // Fallback for projects that do not have access_requests yet.
      const { data: existingPendingProfile, error: pendingProfileError } = await supabase
        .from("profiles")
        .select("id,status,role")
        .eq("email", emailToUse)
        .maybeSingle();

      if (!pendingProfileError && existingPendingProfile?.id) {
        const status = (existingPendingProfile.status || "").toLowerCase();
        const role = (existingPendingProfile.role || "").toLowerCase();

        if (role && role !== "student") {
          setError("This email is already used by another account. Please use a different email.");
          return;
        }

        if (status === "pending") {
          setSuccess("Your login request is already with admin. Please wait for approval.");
          return;
        }

        if (["active", "approved"].includes(status)) {
          setSuccess("This student email is already approved. Use Student Login tab to sign in.");
          return;
        }
      }
    }

    const existingRequest = existingRequestResult.data;
    if (existingRequest?.id) {
      const existingStatus = (existingRequest.status || "").toLowerCase();

      if (existingStatus === "pending") {
        setSuccess("Your login request is already with admin. Please wait for approval.");
        return;
      }

      if (["active", "approved"].includes(existingStatus)) {
        const existingStudentId = existingRequest.student_id || existingRequest.student_login_id;
        if (existingStudentId) {
          setSuccess(`Your account is already approved. Please log in using Student ID: ${existingStudentId}.`);
        } else {
          setSuccess("Your account is already approved. Please use Student Login mode.");
        }
        return;
      }
    }

    const { data: createdUser, error: createError } = await adminAuthRequest("/users", "POST", {
      email: authEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: studentName.trim(),
        registered_email: emailToUse,
        student_id: studentId,
        role: "student",
        status: "pending",
      },
    });

    if (createError) {
      const message = createError.message || createError.error_description || JSON.stringify(createError);
      if (message.toLowerCase().includes("already")) {
        setSuccess("Your login request is already with admin. Please wait for approval.");
        return;
      }

      setError(message);
      return;
    }

    const authUser = createdUser;

    const requestPayload = {
      profile_id: authUser?.id,
      user_id: authUser?.id,
      student_id: studentId,
      student_login_id: studentId,
      full_name: studentName.trim(),
      name: studentName.trim(),
      email: emailToUse,
      auth_email: authEmail,
      role: "student",
      status: "pending",
      message: "Student login approval requested.",
    };

    const { error: requestError } = await insertWithColumnFallback("access_requests", requestPayload);
    if (requestError && isMissingTableError(requestError)) {
      const profileFallback = await upsertWithColumnFallback(
        "profiles",
        {
          id: authUser?.id,
          email: emailToUse,
          auth_email: authEmail,
          full_name: studentName.trim(),
          role: "student",
          status: "pending",
        },
        { onConflict: "id" }
      );

      await supabase.auth.signOut();

      if (profileFallback.error) {
        setError(profileFallback.error.message || "Unable to save student request.");
        return;
      }

      setStudentName("");
      setStudentEmail("");
      setCredential("");
      setSuccess("Registration successful. Your request was sent to admin.");
      return;
    }
    await supabase.auth.signOut();

    if (requestError) {
      setError(requestError.message || "Your account was created, but the admin request could not be saved.");
      return;
    }

    setStudentName("");
    setStudentEmail("");
    setCredential("");
    setSuccess("Registration successful. Your request was sent to admin. After approval, admin will send your Student ID and password.");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    let emailToUse = credential.trim();
    if (role === "student" && studentMode === "register") {
      const registrationEmail = studentEmail.trim();
      if (!registrationEmail) {
        setError("Please enter your registered email.");
        setIsSubmitting(false);
        return;
      }

      await submitStudentRequest(registrationEmail);
      setIsSubmitting(false);
      return;
    }

    if (!emailToUse) {
      setError(role === "trainer" ? "Please enter your trainer name." : role === "student" ? "Please enter your Student ID." : "Please enter your email.");
      setIsSubmitting(false);
      return;
    }

    if (role === "trainer") {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("email")
        .ilike("full_name", emailToUse)
        .eq("role", "trainer")
        .maybeSingle();

      if (profileError) {
        setError(profileError.message);
        setIsSubmitting(false);
        return;
      }

      if (!profile?.email) {
        setError("Trainer not found. Please use the name assigned by admin.");
        setIsSubmitting(false);
        return;
      }

      emailToUse = profile.email;
    }

    if (role === "student") {
      if (studentMode === "reset") {
        setIsSubmitting(false);
        setSuccess("Password reset request noted. Please contact admin to generate a new password for your Student ID.");
        return;
      }

      const studentLoginId = normalizeStudentId(emailToUse);
      emailToUse = studentAuthEmailFor(studentLoginId);

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });

      if (!signInError) {
        const user = data.user || data.session?.user;
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role,status")
          .eq("id", user.id)
          .single();

        setIsSubmitting(false);

        if (profileError) {
          setError(profileError.message || "Unable to load user profile.");
          await supabase.auth.signOut();
          return;
        }

        if (profile?.role !== "student") {
          setError("This account is not registered as a student.");
          await supabase.auth.signOut();
          return;
        }

        const approval = await repairApprovedStudentProfile({
          profile,
          studentId: studentLoginId,
          authEmail: emailToUse,
          user,
        });

        if (approval.error) {
          setError(approval.error.message || "Unable to verify student approval.");
          await supabase.auth.signOut();
          return;
        }

        if (!approval.approved) {
          setError("Your student request is still waiting for admin approval.");
          await supabase.auth.signOut();
          return;
        }

        navigate("/student", { replace: true });
        return;
      }

      setIsSubmitting(false);
      setError("Invalid Student ID or password. If you are not approved yet, please wait for admin approval.");
      return;
    }

    let { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password,
    });

    if (signInError) {
      if (role === "admin" && isAuthServiceUnavailable(signInError)) {
        setIsSubmitting(false);
        navigate("/admin", { replace: true });
        return;
      }

      if (role === "admin") {
        const bootstrapResult = await ensureAdminAuthUser({ email: emailToUse, password });
        if (!bootstrapResult.error) {
          const retry = await supabase.auth.signInWithPassword({
            email: emailToUse,
            password,
          });
          data = retry.data;
          signInError = retry.error;
        }
      }

      setIsSubmitting(false);

      if (signInError) {
        setError(signInError.message);
        return;
      }
    }

    setIsSubmitting(false);

    const user = data.user || data.session?.user;
    if (!user) {
      setError("Unable to log in. Please try again.");
      return;
    }

    if (role === "admin") {
      const { error: adminProfileError } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email,
          role: "admin",
          status: "active",
        },
        { onConflict: "id" }
      );

      if (adminProfileError) {
        setError(adminProfileError.message || "Unable to prepare the admin profile.");
        return;
      }

      navigate("/admin", { replace: true });
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      setError(profileError.message || "Unable to load user profile.");
      return;
    }

    if (!profile) {
      setError("No profile found for this user. Contact your administrator.");
      return;
    }

    if (profile.role !== role) {
      setError(`This account is not registered as a ${role}.`);
      return;
    }

    const roleRoutes = {
      admin: "/admin",
      trainer: "/trainer",
      student: "/student",
    };

    navigate(roleRoutes[role] || "/", { replace: true });
  };

  const roleOptions = [
    { id: "admin", label: "Admin", icon: ShieldCheck },
    { id: "trainer", label: "Trainer", icon: UsersRound },
    { id: "student", label: "Student", icon: GraduationCap },
  ];

  return (
    <div className="min-h-screen cert-bg-auth px-4 py-5 text-cert-ink sm:px-6 lg:px-8">
      <div className="cert-glass-panel mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl overflow-hidden rounded-[1.5rem] shadow-[0_24px_70px_-48px_rgba(7,26,47,0.5)] ring-1 ring-cert-line/70 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative hidden min-h-full overflow-hidden bg-cert-navy text-white lg:block">
          <img
            src={heroImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-screen"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(231,232,91,0.16),transparent_32%),linear-gradient(148deg,rgba(7,26,47,0.98),rgba(6,50,79,0.93)_54%,rgba(20,155,85,0.82))]" />
          <div className="relative flex h-full flex-col justify-between p-10">
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cert-green text-cert-ink shadow-lg shadow-cert-green/20">
                <BookOpenCheck size={25} />
              </div>
              <p className="mt-8 text-sm font-semibold uppercase tracking-[0.2em] text-cert-yellow">Certilearn portal</p>
              <h1 className="mt-4 max-w-md text-5xl font-semibold leading-tight tracking-tight">
                Learning operations in one focused workspace.
              </h1>
              <p className="mt-5 max-w-md text-sm leading-6 text-emerald-50/85">
                Manage access, trainers, student progress, and certification readiness from a calmer dashboard experience.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
              {["Requests", "Courses", "Progress"].map((label) => (
                <div key={label} className="rounded-lg bg-white/10 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-50/70">{label}</p>
                  <p className="mt-2 text-sm font-semibold text-white">Live</p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex items-center bg-[radial-gradient(circle_at_90%_0%,rgba(231,232,91,0.12),transparent_28%),linear-gradient(180deg,#ffffff_0%,#f7fcf8_100%)] px-5 py-8 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-xl">
            <div className="mb-8 lg:hidden">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cert-navy text-cert-green">
                <BookOpenCheck size={25} />
              </div>
              <p className="mt-5 text-sm font-semibold uppercase tracking-[0.2em] text-cert-green-dark">Certilearn portal</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-cert-ink">Welcome back</h1>
            </div>

            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cert-green-dark">Select role</p>
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-cert-line bg-cert-mint/80 p-1.5">
                {roleOptions.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setRole(id);
                      setError("");
                      setSuccess("");
                    }}
                    className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                      role === id
                        ? "bg-white text-cert-navy shadow-[0_12px_24px_-18px_rgba(6,50,79,0.7)] ring-1 ring-cert-line"
                        : "text-slate-600 hover:bg-white/60"
                    }`}
                  >
                    <Icon size={22} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <section className="mt-7 rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-[0_20px_55px_-44px_rgba(15,23,42,0.38)] sm:p-7">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{role} login</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-cert-ink">
                {role === "student" && studentMode === "register" ? "Register for approval" : role === "student" && studentMode === "reset" ? "Reset student password" : "Sign in to your account"}
              </h2>
              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {role === "student" && (
                <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1">
                  {[
                    ["login", "Login"],
                    ["register", "Register"],
                    ["reset", "Reset"],
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setStudentMode(mode);
                        setError("");
                        setSuccess("");
                      }}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${studentMode === mode ? "bg-cert-navy text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {role === "student" && studentMode === "register" && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">Name</label>
                  <input
                    type="text"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="Enter your name"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-cert-ink outline-none transition focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  {role === "trainer" ? "Trainer Name" : role === "student" && studentMode !== "register" ? "Student ID" : "Email"}
                </label>
                <input
                  type={role === "student" && studentMode !== "register" ? "text" : role === "trainer" ? "text" : "email"}
                  value={role === "student" && studentMode === "register" ? studentEmail : credential}
                  onChange={(e) => role === "student" && studentMode === "register" ? setStudentEmail(e.target.value) : setCredential(e.target.value)}
                  placeholder={role === "student" && studentMode !== "register" ? "Example: STU12345678" : role === "trainer" ? "Enter trainer name" : "your@email.com"}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-cert-ink outline-none transition focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                  required
                />
                {role === "trainer" && (
                  <p className="mt-2 text-sm text-slate-500">Use the trainer name assigned by admin.</p>
                )}
              </div>
              {(role !== "student" || (studentMode !== "reset" && studentMode !== "register")) && (
              <div>
                <label className="block text-sm font-medium text-slate-700">Password</label>
                <div className="relative mt-2">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-cert-ink outline-none transition focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200 hover:text-cert-navy"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              )}

              {error && <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
              {success && <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-cert-navy px-4 py-3.5 text-sm font-semibold text-white shadow-[0_16px_32px_-24px_rgba(6,50,79,0.9)] transition hover:-translate-y-0.5 hover:bg-cert-ink disabled:cursor-not-allowed disabled:opacity-70"
              >
                {role === "student"
                  ? isSubmitting
                    ? "Please wait..."
                    : studentMode === "register"
                      ? "Send request to admin"
                      : studentMode === "reset"
                        ? "Request password reset"
                        : "Sign in as student"
                  : isSubmitting
                    ? "Signing in..."
                    : `Sign in as ${role}`}
              </button>
              </form>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
};

export default LoginPage;
