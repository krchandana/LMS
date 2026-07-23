import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";

const isMissingTableError = (error) => {
  const message = (error?.message || "").toLowerCase();
  return message.includes("could not find the table") || message.includes("relation") && message.includes("does not exist");
};

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
    const { data: rpcEmail, error: rpcError } = await supabase.rpc("find_trainer_login_email", {
      p_full_name: normalized,
    });
    if (!rpcError && typeof rpcEmail === "string" && rpcEmail.trim()) return rpcEmail.trim();

    const profileEmail = await queryTrainerEmailInTable("profiles", normalized, true);
    if (profileEmail) return profileEmail;

    const trainerEmail = await queryTrainerEmailInTable("trainers", normalized, false);
    if (trainerEmail) return trainerEmail;

    if (!supabaseUrl || !serviceRoleKey) return null;
    const params = new URLSearchParams({
      select: "email",
      full_name: `ilike.${normalized}`,
      role: "eq.trainer",
      limit: "1",
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${params.toString()}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!response.ok) return null;

    const profiles = await response.json();
    return Array.isArray(profiles) && profiles[0]?.email ? profiles[0].email : null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
};

const TrainerLogin = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [trainerName, setTrainerName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    const normalizedId = trainerName.trim();
    if (!normalizedId) {
      setError("Please enter your full name.");
      setIsSubmitting(false);
      return;
    }

    let trainerEmail = normalizedId.includes("@") ? normalizedId.toLowerCase() : null;
    if (!trainerEmail) {
      try {
        trainerEmail = await findTrainerEmailByName(normalizedId);
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
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trainerEmail,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    navigate("/trainer", { replace: true });
  };

  const handleResetPassword = async () => {
    setError("");
    setSuccess("");

    const normalizedId = trainerName.trim();
    if (!normalizedId) {
      setError("Please enter your full name first.");
      return;
    }

    setIsResetting(true);

    let trainerEmail = normalizedId.includes("@") ? normalizedId.toLowerCase() : null;
    if (!trainerEmail) {
      try {
        trainerEmail = await findTrainerEmailByName(normalizedId);
      } catch (err) {
        setError(err?.message || "Unable to look up the trainer account.");
        setIsResetting(false);
        return;
      }
    }

    if (!trainerEmail) {
      setError("Trainer not found. Use the name saved by admin or your registered email.");
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

  return (
    <div className="min-h-screen cert-bg-trainer px-4 py-8 sm:px-6 lg:px-8">
      <div className="cert-glass-panel mx-auto grid max-w-6xl overflow-hidden rounded-[2.5rem] shadow-[0_28px_90px_-45px_rgba(15,23,42,0.3)] lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative hidden overflow-hidden bg-[radial-gradient(circle_at_14%_15%,rgba(49,201,111,0.24),transparent_27%),radial-gradient(circle_at_88%_83%,rgba(231,232,91,0.16),transparent_26%),linear-gradient(145deg,#041c30_0%,#063b50_58%,#08734f_130%)] p-8 text-white sm:p-10 lg:block lg:p-12">
          <div className="absolute -right-24 top-20 h-64 w-64 rounded-full border border-white/10" />
          <div className="absolute -bottom-28 -left-16 h-72 w-72 rounded-full border border-white/10" />
          <div className="relative flex h-full flex-col justify-between gap-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cert-yellow backdrop-blur">
                <Sparkles size={14} aria-hidden="true" />
                Trainer Access
              </div>
              <div className="mt-9 flex h-16 w-16 items-center justify-center rounded-3xl bg-cert-green text-cert-ink shadow-lg shadow-black/20">
                <ShieldCheck size={34} />
              </div>
              <p className="mt-8 text-xs font-bold uppercase tracking-[0.25em] text-cert-yellow">Guide. Review. Celebrate.</p>
              <h1 className="mt-4 max-w-md text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Help every learner move forward.</h1>
              <p className="mt-5 max-w-md text-base leading-7 text-emerald-50/85">Your feedback turns completed work into confidence, progress, and achievement.</p>
            </div>

            <div className="rounded-[1.5rem] border border-white/15 bg-white/10 p-5 backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-yellow">Your workspace</p>
              <div className="mt-4 space-y-3 text-sm text-emerald-50/90">
                {[
                  "Create course assignments and projects",
                  "Review student work with clear feedback",
                  "Issue certificates when learning is complete",
                ].map((item) => <p key={item} className="flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-cert-green" />{item}</p>)}
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[radial-gradient(circle_at_88%_3%,rgba(49,201,111,0.12),transparent_27%),linear-gradient(180deg,#ffffff_0%,#f8fcf9_100%)] p-5 sm:p-10 lg:min-h-0 lg:p-12">
          <div className="w-full max-w-md rounded-[2rem] border border-cert-line bg-white p-8 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.18)] sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cert-green-dark">Welcome back</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-cert-ink">Trainer login</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">Use your trainer name and password to continue.</p>

            <form onSubmit={handleLogin} className="mt-8 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-cert-ink">Full name or email</label>
                <input
                  type="text"
                  placeholder="Enter your full name or email"
                  value={trainerName}
                  onChange={(e) => setTrainerName(e.target.value)}
                  className="w-full rounded-3xl border border-cert-line bg-cert-mint px-4 py-3 text-cert-ink outline-none focus:border-cert-green focus:ring-2 focus:ring-cert-green/20"
                  required
                />
                <p className="mt-2 text-sm text-slate-500">Use the name saved by admin, or enter your registered email.</p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-cert-ink">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-3xl border border-cert-line bg-cert-mint px-4 py-3 pr-12 text-cert-ink outline-none focus:border-cert-green focus:ring-2 focus:ring-cert-green/20"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-cert-ink"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="rounded-3xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
              )}

              {success && (
                <p className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center rounded-3xl bg-cert-green px-4 py-3 text-cert-ink font-semibold transition hover:bg-cert-green-dark hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Logging in..." : "Trainer Login"}
              </button>

              <button
                type="button"
                onClick={handleResetPassword}
                disabled={isResetting}
                className="inline-flex w-full items-center justify-center rounded-3xl border border-cert-line bg-white px-4 py-3 text-sm font-semibold text-cert-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isResetting ? "Sending reset link..." : "Reset password"}
              </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
};

export default TrainerLogin;
