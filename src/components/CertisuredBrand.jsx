export function CertisuredMark({ className = "h-12 w-12" }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#31C96F" />
      <path
        d="M24 12.4c2.9 2.1 6.3 2.7 9.5 2.3v7.7c0 6.2-3.9 10.6-9.5 12.8-5.6-2.2-9.5-6.6-9.5-12.8v-7.7c3.2.4 6.6-.2 9.5-2.3Z"
        stroke="#06324F"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path d="m19.6 23.5 3 3 6.2-6.5" stroke="#06324F" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CertisuredBrand({ className = "", light = false }) {
  return (
    <div
      className={`inline-flex w-fit items-center gap-3 ${light ? "" : "rounded-2xl border border-white/15 bg-white/10 px-3 py-3 shadow-xl shadow-black/10 backdrop-blur"} ${className}`}
      aria-label="Certisured Learning Management System"
    >
      <CertisuredMark />
      <div>
        <p className={`text-base font-bold uppercase tracking-[0.22em] ${light ? "text-cert-green-dark" : "text-white"}`}>Certisured</p>
        <p className={`mt-1 text-xs font-medium uppercase tracking-[0.14em] ${light ? "text-slate-500" : "text-emerald-50/80"}`}>Learning Management System</p>
      </div>
    </div>
  );
}
