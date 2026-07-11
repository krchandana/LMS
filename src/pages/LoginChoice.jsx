import { useNavigate } from "react-router-dom";
import { BookOpenCheck, ShieldCheck, Sparkles, UsersRound } from "lucide-react";

export default function LoginChoice() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen cert-bg-auth px-4 py-8 sm:px-6 lg:px-8">
      <div className="cert-glass-panel mx-auto max-w-5xl overflow-hidden rounded-[2.5rem] shadow-[0_28px_90px_-45px_rgba(15,23,42,0.24)]">
        <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
          <aside className="relative overflow-hidden bg-[linear-gradient(180deg,_#061e33_0%,_#06324f_50%,_#10945a_100%)] p-8 text-white sm:p-10 lg:p-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(231,232,91,0.2),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(49,201,111,0.22),_transparent_34%)]" />
            <div className="relative flex h-full flex-col justify-between gap-8">
              <div>
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cert-green text-cert-ink shadow-lg">
                  <BookOpenCheck size={24} aria-hidden="true" />
                </div>
                <p className="mt-8 text-sm font-semibold uppercase tracking-[0.24em] text-cert-yellow">CertiLearn portal</p>
                <h1 className="mt-4 max-w-md text-5xl font-semibold leading-tight tracking-tight">
                  Choose the right workspace in one step.
                </h1>
                <p className="mt-5 max-w-md text-sm leading-7 text-emerald-50/85">
                  A cleaner entry point helps admins and trainers get to the right tools without extra clicks.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {[
                  { label: "Admin", detail: "Approvals & analytics", icon: ShieldCheck },
                  { label: "Trainer", detail: "Students & projects", icon: UsersRound },
                  { label: "Student", detail: "Progress & work", icon: Sparkles },
                ].map(({ label, detail, icon: Icon }) => (
                  <div key={label} className="rounded-[1.5rem] border border-white/10 bg-white/10 p-4 backdrop-blur">
                    <Icon size={18} className="text-cert-yellow" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold text-white">{label}</p>
                    <p className="mt-1 text-sm text-emerald-50/75">{detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="flex items-center justify-center bg-[radial-gradient(circle_at_90%_0%,rgba(231,232,91,0.12),transparent_30%),linear-gradient(180deg,#ffffff_0%,#f8fcf8_100%)] px-5 py-8 sm:px-8 lg:px-12">
            <div className="w-full max-w-xl">
              <div className="text-center lg:text-left">
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cert-green-dark">Select role</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-cert-ink sm:text-4xl">Choose your login</h2>
                <p className="mt-4 text-sm leading-7 text-slate-600">Select the correct portal for your role to continue.</p>
              </div>

              <div className="mt-10 grid gap-5 md:grid-cols-2">
                <button
                  onClick={() => navigate("/admin-login")}
                  className="group rounded-[1.9rem] border border-cert-navy bg-cert-navy p-7 text-left text-white shadow-[0_18px_50px_-35px_rgba(6,50,79,0.55)] transition hover:-translate-y-0.5 hover:bg-cert-ink"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/10">
                    <ShieldCheck size={22} className="text-cert-yellow" aria-hidden="true" />
                  </div>
                  <p className="mt-5 text-sm uppercase tracking-[0.28em] text-cert-yellow">Admin Portal</p>
                  <h3 className="mt-3 text-2xl font-semibold">Admin Login</h3>
                  <p className="mt-3 text-sm leading-7 text-emerald-50/85">Manage requests, users, courses, mapping, and analytics.</p>
                </button>

                <button
                  onClick={() => navigate("/trainer-login")}
                  className="group rounded-[1.9rem] border border-cert-line bg-cert-mint p-7 text-left text-cert-ink shadow-[0_18px_50px_-35px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:bg-white"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white ring-1 ring-cert-line">
                    <UsersRound size={22} className="text-cert-green-dark" aria-hidden="true" />
                  </div>
                  <p className="mt-5 text-sm uppercase tracking-[0.28em] text-cert-green-dark">Trainer Portal</p>
                  <h3 className="mt-3 text-2xl font-semibold">Trainer Login</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">Manage assigned students, evaluate work, and track progress.</p>
                </button>

                <button
                  onClick={() => navigate("/login")}
                  className="group rounded-[1.9rem] border border-cert-line bg-white p-7 text-left text-cert-ink shadow-[0_18px_50px_-35px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:bg-cert-mint md:col-span-2"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cert-mint ring-1 ring-cert-line">
                    <Sparkles size={22} className="text-cert-green-dark" aria-hidden="true" />
                  </div>
                  <p className="mt-5 text-sm uppercase tracking-[0.28em] text-cert-green-dark">Student Portal</p>
                  <h3 className="mt-3 text-2xl font-semibold">Student Login</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">Open your student access, progress, and learning workspace.</p>
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
