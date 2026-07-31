import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

const resetLinkError = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("error_description") || params.get("error") || "";
};

export default function TrainerResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [error, setError] = useState(resetLinkError());
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const activateRecovery = (session) => {
      if (!isMounted) return;
      setHasRecoverySession(Boolean(session));
      setCheckingLink(false);
    };

    const code = new URLSearchParams(window.location.search).get("code");
    const loadRecoverySession = async () => {
      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (isMounted) {
            setError(exchangeError.message || "This password-reset link is invalid or has expired.");
            setCheckingLink(false);
          }
          return;
        }
        activateRecovery(data.session);
        return;
      }

      const { data } = await supabase.auth.getSession();
      activateRecovery(data.session);
    };

    void loadRecoverySession();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") activateRecovery(session);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (password.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setIsSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSaving(false);

    if (updateError) {
      setError(updateError.message || "Unable to update your password. Request a new reset link and try again.");
      return;
    }

    setSuccess("Password updated. You can now sign in with your new password.");
    await supabase.auth.signOut();
    window.setTimeout(() => navigate("/trainer-login", { replace: true }), 1400);
  };

  return (
    <div className="min-h-screen cert-bg-trainer flex items-center justify-center p-4 sm:p-8">
      <main className="w-full max-w-md rounded-[2rem] border border-cert-line bg-white p-7 shadow-[0_28px_70px_-38px_rgba(7,26,47,0.35)] sm:p-9">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cert-navy text-cert-green"><ShieldCheck size={28} aria-hidden="true" /></span>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.24em] text-cert-green-dark">Trainer access</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-cert-ink">Set a new password</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">Choose a new password for your trainer account.</p>

        {checkingLink ? (
          <p className="mt-7 rounded-2xl bg-cert-mint px-4 py-4 text-sm text-cert-green-dark">Checking your password-reset link…</p>
        ) : hasRecoverySession ? (
          <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-cert-ink">New password
              <div className="relative mt-2">
                <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 pr-12 outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-cert-ink" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
              </div>
            </label>
            <label className="block text-sm font-medium text-cert-ink">Confirm new password
              <input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required />
            </label>
            {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
            {success && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>}
            <button type="submit" disabled={isSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cert-green px-4 py-3.5 font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white disabled:opacity-60"><KeyRound size={18} />{isSaving ? "Saving password..." : "Save new password"}</button>
          </form>
        ) : (
          <div className="mt-7 rounded-2xl bg-rose-50 px-4 py-4 text-sm leading-6 text-rose-700">
            <p>{error || "This password-reset link is invalid or has expired."}</p>
            <button type="button" onClick={() => navigate("/trainer-login", { replace: true })} className="mt-3 font-semibold underline">Return to trainer login and request a new link</button>
          </div>
        )}
      </main>
    </div>
  );
}
