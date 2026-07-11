import { useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message || "Unable to sign in.");
      setLoading(false);
      return;
    }

    const user = data.user || data.session?.user;
    if (!user) {
      setError("Unable to identify admin account.");
      setLoading(false);
      return;
    }

    const { error: metadataError } = await supabase.auth.updateUser({
      data: {
        full_name: user.user_metadata?.full_name || user.email,
        role: "admin",
        status: "active",
      },
    });

    if (metadataError) {
      setError(metadataError.message || "Unable to tag admin session.");
      setLoading(false);
      return;
    }

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email,
        role: "admin",
        status: "active",
      },
      { onConflict: "id" }
    );

    setLoading(false);

    if (profileError) {
      setError(profileError.message || "Unable to prepare admin profile.");
      return;
    }

    navigate("/admin", { replace: true });
  };

  return (
    <div className="cert-bg-admin flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="cert-glass-panel w-full max-w-md rounded-[2rem] p-8 shadow-[0_26px_65px_-38px_rgba(7,26,47,0.45)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cert-navy text-cert-yellow">
          <ShieldCheck size={30} aria-hidden="true" />
        </div>
        <p className="mt-6 text-center text-xs font-semibold uppercase tracking-[0.25em] text-cert-green-dark">Certilearn admin</p>
        <h1 className="mt-3 text-center text-3xl font-semibold text-cert-ink">Admin Login</h1>
        <p className="mt-2 text-center text-sm text-slate-600">Sign in to manage requests, users, courses, and analytics.</p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-cert-ink outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
              placeholder="admin@company.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Password</label>
            <div className="relative mt-2">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-cert-ink outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                placeholder="Enter password"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-cert-navy"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {error && <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-cert-navy px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-cert-ink disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Signing in..." : "Sign in as admin"}
          </button>
        </form>
      </div>
    </div>
  );
}
