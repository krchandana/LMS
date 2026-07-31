import { useState } from "react";
import { Eye, EyeOff, GraduationCap, ShieldCheck, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import CertisuredBrand, { CertisuredMark } from "../components/CertisuredBrand";

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
const nextStudentLoginId = async () => {
  const { data, error } = await supabase.rpc("next_student_login_id");
  if (error || typeof data !== "string" || !data.trim()) {
    throw error || new Error("Unable to generate the next student ID.");
  }
  return data.trim();
};

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
    // This RPC is intentionally available before sign-in. It bypasses profile
    // RLS only for this exact trainer-name-to-email lookup, so name login works
    // just as reliably on a new phone as it does in an existing admin session.
    const { data: rpcEmail, error: rpcError } = await supabase.rpc("find_trainer_login_email", {
      p_full_name: normalized,
    });
    if (!rpcError && typeof rpcEmail === "string" && rpcEmail.trim()) return rpcEmail.trim();

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
  const [newTrainerPassword, setNewTrainerPassword] = useState("");
  const [confirmTrainerPassword, setConfirmTrainerPassword] = useState("");
  const [trainerPasswordMode, setTrainerPasswordMode] = useState(false);
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

    const { data, error: registrationError } = await supabase.functions.invoke("submit-student-registration", {
      body: { name: studentName.trim(), email: emailToUse.trim() },
    });
    if (registrationError || data?.error) {
      setError(data?.error || registrationError?.message || "Unable to submit the registration request.");
      return;
    }

    setStudentName("");
    setStudentEmail("");
    setCredential("");
    setSuccess(data?.message || "Registration successful. Your request was sent to admin. After approval, admin will send your Student ID and password.");
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

    if (role === "trainer" && trainerPasswordMode && newTrainerPassword.length < 6) {
      setError("Use a new password with at least 6 characters.");
      setIsSubmitting(false);
      return;
    }
    if (role === "trainer" && trainerPasswordMode && newTrainerPassword !== confirmTrainerPassword) {
      setError("The new passwords do not match.");
      setIsSubmitting(false);
      return;
    }

    if (role === "trainer") {
      if (emailToUse.includes("@")) {
        emailToUse = emailToUse.toLowerCase();
      } else {
        let trainerEmail;
        try {
          trainerEmail = await findTrainerEmailByName(emailToUse);
        } catch (err) {
          setError(err?.message || "Unable to look up the trainer account.");
          setIsSubmitting(false);
          return;
        }

        if (!trainerEmail) {
          setError("Trainer not found. Use the name saved by admin or your registered email.");
          setIsSubmitting(false);
          return;
        }

        emailToUse = trainerEmail;
      }
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

    if (signInError) {
      if (role === "admin" && isAuthServiceUnavailable(signInError)) {
        setIsSubmitting(false);
        navigate("/admin", { replace: true });
        return;
      }

      setError(role === "trainer" && trainerPasswordMode ? "The trainer name or current password is incorrect." : signInError.message);
      setIsSubmitting(false);
      return;
    }

    const user = data.user || data.session?.user;
    if (!user) {
      setIsSubmitting(false);
      setError("Unable to log in. Please try again.");
      return;
    }

    if (role === "trainer" && trainerPasswordMode) {
      const { data: trainerProfile, error: trainerProfileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (trainerProfileError || trainerProfile?.role !== "trainer") {
        await supabase.auth.signOut();
        setIsSubmitting(false);
        setError("This account is not registered as a trainer.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newTrainerPassword });
      setIsSubmitting(false);
      if (updateError) {
        setError(updateError.message || "Unable to update your password.");
        return;
      }

      await supabase.auth.signOut();
      setPassword("");
      setNewTrainerPassword("");
      setConfirmTrainerPassword("");
      setTrainerPasswordMode(false);
      setSuccess("Password updated. Sign in with your new password.");
      return;
    }

    setIsSubmitting(false);

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
    <div className="min-h-screen bg-white text-cert-ink">
      <div className="grid min-h-screen w-full overflow-hidden bg-white lg:grid-cols-[0.95fr_1.05fr]">
        <aside className="relative hidden min-h-full overflow-hidden bg-[radial-gradient(circle_at_12%_18%,rgba(49,201,111,0.24),transparent_28%),radial-gradient(circle_at_88%_78%,rgba(255,227,83,0.18),transparent_25%),linear-gradient(150deg,#041c30_0%,#06324f_55%,#075d4c_100%)] lg:block">
          <div className="absolute -right-32 top-24 h-72 w-72 rounded-full border border-white/10" />
          <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full border border-white/10" />
          <div className="relative flex h-full flex-col justify-between p-8 xl:p-10">
            <CertisuredBrand />
            <div className="max-w-md pb-6 text-white">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-cert-yellow">Learn together</p>
              <blockquote className="mt-5 border-l-2 border-cert-green pl-5 text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
                “Students grow through every challenge; trainers turn that effort into confidence.”
              </blockquote>
              <p className="mt-5 max-w-sm text-base leading-7 text-emerald-50/80">Every lesson shared, task completed, and piece of feedback given moves learning forward.</p>
              <p className="mt-7 text-sm font-semibold text-cert-yellow">— Certisured Learning Community</p>
            </div>
          </div>
        </aside>

        <main className="flex items-center bg-[radial-gradient(circle_at_92%_4%,rgba(49,201,111,0.12),transparent_24%),linear-gradient(180deg,#ffffff_0%,#f8fcf9_100%)] px-5 py-8 sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-lg">
            <div className="mb-8 lg:hidden">
              <div className="inline-flex items-center gap-3" aria-label="Certisured Learning Management System">
                <CertisuredMark className="h-12 w-12" />
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-cert-green-dark">Certisured</p>
                  <p className="mt-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-slate-500">Learning Management System</p>
                </div>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-cert-ink">Welcome back</h1>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-green-dark">Secure sign in</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-cert-ink sm:text-4xl">Welcome to your workspace</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">Choose your role to access the tools designed for you.</p>
              <p className="mt-7 text-xs font-bold uppercase tracking-[0.2em] text-cert-green-dark">Select role</p>
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-cert-line bg-cert-mint/70 p-1.5">
                {roleOptions.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setRole(id);
                      setTrainerPasswordMode(false);
                      setNewTrainerPassword("");
                      setConfirmTrainerPassword("");
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

            <section className="mt-7 rounded-[1.5rem] border border-slate-200/90 bg-white p-5 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.26)] sm:p-7">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{role} login</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-cert-ink">
                {role === "trainer" && trainerPasswordMode ? "Change trainer password" : role === "student" && studentMode === "register" ? "Register for approval" : role === "student" && studentMode === "reset" ? "Reset student password" : "Sign in to your account"}
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
                  {role === "trainer" ? "Full name or email" : role === "student" && studentMode !== "register" ? "Student ID" : "Email"}
                </label>
                <input
                  type={role === "student" && studentMode !== "register" ? "text" : role === "trainer" ? "text" : "email"}
                  value={role === "student" && studentMode === "register" ? studentEmail : credential}
                  onChange={(e) => role === "student" && studentMode === "register" ? setStudentEmail(e.target.value) : setCredential(e.target.value)}
                  placeholder={role === "student" && studentMode !== "register" ? "Example: STU12345678" : role === "trainer" ? "Enter your full name or email" : "your@email.com"}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-cert-ink outline-none transition focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                  required
                />
                {role === "trainer" && (
                  <p className="mt-2 text-sm text-slate-500">Use the name saved by admin, or enter your registered email.</p>
                )}
              </div>
              {(role !== "student" || (studentMode !== "reset" && studentMode !== "register")) && (
              <div>
                <label className="block text-sm font-medium text-slate-700">{role === "trainer" && trainerPasswordMode ? "Current password" : "Password"}</label>
                <div className="relative mt-2">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={role === "trainer" && trainerPasswordMode ? "Enter your current password" : "Enter your password"}
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

              {role === "trainer" && trainerPasswordMode && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">New password</label>
                    <input type={showPassword ? "text" : "password"} value={newTrainerPassword} onChange={(event) => setNewTrainerPassword(event.target.value)} placeholder="Enter a new password" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-cert-ink outline-none transition focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" minLength="6" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Confirm new password</label>
                    <input type={showPassword ? "text" : "password"} value={confirmTrainerPassword} onChange={(event) => setConfirmTrainerPassword(event.target.value)} placeholder="Enter the new password again" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-cert-ink outline-none transition focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" minLength="6" required />
                  </div>
                </>
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
                    ? trainerPasswordMode ? "Updating password..." : "Signing in..."
                    : trainerPasswordMode ? "Update password" : `Sign in as ${role}`}
              </button>
              {role === "trainer" && (
                <button
                  type="button"
                  onClick={() => {
                    setTrainerPasswordMode((value) => !value);
                    setNewTrainerPassword("");
                    setConfirmTrainerPassword("");
                    setError("");
                    setSuccess("");
                  }}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-cert-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {trainerPasswordMode ? "Back to trainer login" : "Change password"}
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
