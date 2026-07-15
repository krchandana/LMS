import { useState } from "react";
import { Eye, EyeOff, GraduationCap, ShieldCheck, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import certisuredLoginHero from "../assets/certisured-login-hero.png";
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
const generateStudentLoginId = () => `STU${Math.floor(10000 + Math.random() * 90000)}`;

const isMissingTableError = (error) =>
  error?.message?.toLowerCase().includes("could not find the table") ||
  error?.message?.toLowerCase().includes("schema cache");

const isMissingColumnError = (error) => {
  const message = (error?.message || "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
};

const queryTrainerEmailInTable = async (table, search, requireRole = false) => {
  const columns = ["full_name", "name"];
  let roleFilterEnabled = requireRole;

  for (const column of columns) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt === 1 && !roleFilterEnabled) break;

      const useRoleFilter = attempt === 0 && roleFilterEnabled;
      try {
        let query = supabase.from(table).select("email").ilike(column, search).limit(1);
        if (useRoleFilter) query = query.eq("role", "trainer");

        const { data, error } = await query;
        if (!error && Array.isArray(data) && data.length > 0) {
          return data[0].email;
        }

        if (error) {
          if (isMissingTableError(error)) return null;
          if (isMissingColumnError(error)) {
            const message = error.message.toLowerCase();
            if (useRoleFilter && message.includes("role")) {
              roleFilterEnabled = false;
              continue;
            }
            break;
          }
          throw error;
        }

        if (useRoleFilter) {
          continue;
        }
      } catch (err) {
        if (isMissingTableError(err)) return null;
        if (isMissingColumnError(err)) {
          const message = err.message.toLowerCase();
          if (useRoleFilter && message.includes("role")) {
            roleFilterEnabled = false;
            continue;
          }
          break;
        }
        throw err;
      }
    }
  }

  return null;
};

const findTrainerEmailByName = async (trainerName) => {
  const normalized = (trainerName || "").trim();
  if (!normalized) return null;

  try {
    const profileEmail = await queryTrainerEmailInTable("profiles", normalized, true);
    if (profileEmail) return profileEmail;
    const trainerEmail = await queryTrainerEmailInTable("trainers", normalized, false);
    if (trainerEmail) return trainerEmail;

    if (!hasServiceRoleKey) return null;
    const serviceResult = await serviceRoleTableRequest(
      "profiles",
      `?select=email&full_name=ilike.${encodeURIComponent(normalized)}&role=eq.trainer&limit=1`,
      "GET"
    );
    if (serviceResult.error || !Array.isArray(serviceResult.data)) return null;
    return serviceResult.data[0]?.email || null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
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

  if (repairResult.error) return { error: repairResult.error };

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
  const [isResetting, setIsResetting] = useState(false);
  const navigate = useNavigate();

  const handleTrainerReset = async () => {
    setError("");
    setSuccess("");

    const trainerName = credential.trim();
    if (!trainerName) {
      setError("Please enter your full name first.");
      return;
    }

    setIsResetting(true);
    let trainerEmail;
    try {
      trainerEmail = await findTrainerEmailByName(trainerName);
    } catch (err) {
      setError(err?.message || "Unable to look up the trainer account.");
      setIsResetting(false);
      return;
    }

    if (!trainerEmail) {
      setError("Trainer not found. Please use the full name saved by admin.");
      setIsResetting(false);
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trainerEmail, {
      redirectTo: `${window.location.origin}/trainer-login`,
    });

    setIsResetting(false);

    if (resetError) {
      setError(resetError.message || "Unable to send password reset email.");
      return;
    }

    setSuccess(`Password reset email sent to ${trainerEmail}.`);
  };

  const submitStudentRequest = async (emailToUse) => {
    if (!studentName.trim()) {
      setError("Please enter your name.");
      return;
    }

    const normalizedEmail = emailToUse.trim().toLowerCase();
    if (hasServiceRoleKey) {
      const [profileResult, requestResult] = await Promise.all([
        serviceRoleTableRequest("profiles", `?select=id,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, "GET"),
        serviceRoleTableRequest("access_requests", `?select=id,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, "GET"),
      ]);
      const existingProfile = Array.isArray(profileResult.data) ? profileResult.data[0] : null;
      const existingRequest = Array.isArray(requestResult.data) ? requestResult.data[0] : null;

      if (existingProfile || existingRequest) {
        const status = (existingProfile?.status || existingRequest?.status || "pending").toLowerCase();
        if (["active", "approved"].includes(status)) {
          setError("An active student account already uses this email. Please sign in with the Student ID sent by admin.");
        } else if (status === "rejected") {
          setError("This registration was previously rejected. Please contact the admin before registering again.");
        } else {
          setSuccess("A registration request for this email is already pending admin approval.");
        }
        return;
      }
    }

    const studentId = generateStudentLoginId();
    const authEmail = studentAuthEmailFor(studentId);
    const temporaryPassword = `Pending@${Date.now().toString().slice(-6)}`;

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
    const profilePayload = {
      id: authUser?.id,
      email: emailToUse,
      auth_email: authEmail,
      full_name: studentName.trim(),
      role: "student",
      status: "pending",
      student_id: studentId,
    };

    if (authUser?.id) {
      const { error: profileError } = await upsertWithColumnFallback("profiles", profilePayload, { onConflict: "id" });
      if (profileError) {
        const message = profileError.message || "";
        if (message.includes("profiles_email_key")) {
          await serviceRoleAuthRequest(`/users/${authUser.id}`, "DELETE");
          setSuccess("A registration request for this email already exists. Please wait for admin approval.");
          return;
        }
        setError(profileError.message || "Unable to save the student request.");
        return;
      }
    }

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
      setError(role === "trainer" ? "Please enter your full name." : role === "student" ? "Please enter your Student ID." : "Please enter your email.");
      setIsSubmitting(false);
      return;
    }

    if (role === "trainer") {
      let trainerEmail;
      try {
        trainerEmail = await findTrainerEmailByName(emailToUse);
      } catch (err) {
        setError(err?.message || "Unable to look up the trainer account.");
        setIsSubmitting(false);
        return;
      }

      if (!trainerEmail) {
        setError("Trainer not found. Please use the full name saved by admin.");
        setIsSubmitting(false);
        return;
      }

      emailToUse = trainerEmail;
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

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      if (role === "admin" && isAuthServiceUnavailable(signInError)) {
        navigate("/admin", { replace: true });
        return;
      }

      setError(signInError.message);
      return;
    }

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
        <aside className="relative hidden min-h-full overflow-hidden bg-[#f7fbff] lg:block">
          <img
            src={certisuredLoginHero}
            alt="Students, trainers, and administrators using the Certisured learning platform"
            className="absolute inset-0 h-full w-full object-contain object-center"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.04)_45%,rgba(6,34,57,0.1))]" />
          <div className="relative h-full p-6 sm:p-8">
            <div>
              <div className="inline-flex items-center gap-3 rounded-2xl border border-white/80 bg-white/90 px-3 py-3 shadow-[0_18px_40px_-26px_rgba(7,26,47,0.35)] backdrop-blur" aria-label="Certisured Learning Management System">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cert-ink text-cert-green shadow-lg shadow-cert-ink/20">
                  <ShieldCheck size={29} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-base font-bold uppercase tracking-[0.22em] text-cert-ink">Certisured</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-cert-green-dark">Learning Management System</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex items-center bg-[radial-gradient(circle_at_90%_0%,rgba(231,232,91,0.12),transparent_28%),linear-gradient(180deg,#ffffff_0%,#f7fcf8_100%)] px-5 py-8 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-xl">
            <div className="mb-8 lg:hidden">
              <div className="inline-flex items-center gap-3" aria-label="Certisured Learning Management System">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cert-navy text-cert-green">
                  <ShieldCheck size={25} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-cert-green-dark">Certisured</p>
                  <p className="mt-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-slate-500">Learning Management System</p>
                </div>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-cert-ink">Welcome back</h1>
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
                  {role === "trainer" ? "Full name" : role === "student" && studentMode !== "register" ? "Student ID" : "Email"}
                </label>
                <input
                  type={role === "student" && studentMode !== "register" ? "text" : role === "trainer" ? "text" : "email"}
                  value={role === "student" && studentMode === "register" ? studentEmail : credential}
                  onChange={(e) => role === "student" && studentMode === "register" ? setStudentEmail(e.target.value) : setCredential(e.target.value)}
                  placeholder={role === "student" && studentMode !== "register" ? "Example: STU12345678" : role === "trainer" ? "Enter your full name" : "your@email.com"}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-cert-ink outline-none transition focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                  required
                />
                {role === "trainer" && (
                  <p className="mt-2 text-sm text-slate-500">Use the full name saved by admin when your account was created.</p>
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
              {role === "trainer" && (
                <button
                  type="button"
                  onClick={handleTrainerReset}
                  disabled={isResetting}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-cert-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isResetting ? "Sending reset link..." : "Reset password"}
                </button>
              )}
              </form>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
};

export default LoginPage;
