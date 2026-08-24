import { useEffect, useState } from "react";
import { Award, CheckCircle2, Search, ShieldCheck, XCircle } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric" }).format(date);
};

export default function CertificateVerification() {
  const { certificateId = "" } = useParams();
  const [certificate, setCertificate] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const verify = async () => {
      setStatus("loading");
      const { data, error } = await supabase.functions.invoke("verify-certificate", {
        body: { certificateId },
      });
      if (!active) return;
      if (error || !data?.valid) {
        setCertificate(null);
        setStatus("invalid");
        setMessage(data?.error || error?.message || "This certificate could not be verified.");
        return;
      }
      setCertificate(data.certificate);
      setStatus("valid");
    };
    if (certificateId) verify();
    else { setStatus("invalid"); setMessage("A certificate ID is required."); }
    return () => { active = false; };
  }, [certificateId]);

  return <main className="min-h-screen bg-[radial-gradient(circle_at_85%_5%,#d7f6df_0,transparent_28%),linear-gradient(135deg,#f5fbf7,#eef4f8)] px-4 py-6 text-cert-ink sm:py-16"><section className="mx-auto w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-cert-line bg-white shadow-[0_30px_80px_-40px_rgba(7,26,47,0.35)] sm:rounded-[2rem]"><header className="bg-[linear-gradient(135deg,#071a2f,#08485a_62%,#0c8a58_150%)] px-5 py-7 text-center text-white sm:px-6 sm:py-8"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cert-green text-cert-ink"><ShieldCheck size={29} /></div><p className="mt-4 text-xs font-bold uppercase tracking-[0.23em] text-cert-yellow">Certisured</p><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Certificate verification</h1><p className="mt-2 text-sm text-emerald-50/85">Verify a certificate issued by Certisured Learning Management System.</p></header><div className="p-5 sm:p-8">{status === "loading" && <div className="py-10 text-center"><Search className="mx-auto animate-pulse text-cert-green-dark" size={34} /><p className="mt-4 text-sm text-slate-500">Checking certificate authenticity…</p></div>}{status === "valid" && certificate && <div className="text-center"><CheckCircle2 className="mx-auto text-emerald-500" size={45} /><p className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">Verified certificate</p><h2 className="mt-4 break-words font-serif text-3xl font-bold text-cert-ink sm:text-4xl">{certificate.studentName}</h2><div className="mt-6 grid gap-3 text-left sm:grid-cols-2"><div className="rounded-2xl bg-cert-mint p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-cert-green-dark">Course</p><p className="mt-2 break-words font-semibold">{certificate.courseTitle}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Completion date</p><p className="mt-2 font-semibold">{formatDate(certificate.completionDate)}</p></div></div><div className="mt-5 rounded-2xl border border-cert-line bg-white p-4 text-left"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Unique certificate ID</p><p className="mt-2 break-all font-mono text-sm font-bold text-cert-ink">{certificate.certificateId}</p></div></div>}{status === "invalid" && <div className="py-8 text-center"><XCircle className="mx-auto text-rose-500" size={45} /><h2 className="mt-4 text-xl font-semibold">Certificate not verified</h2><p className="mx-auto mt-2 max-w-md break-words text-sm leading-6 text-slate-500">{message}</p></div>}<div className="mt-8 border-t border-cert-line pt-5 text-center"><Link to="/" className="inline-flex max-w-full flex-wrap items-center justify-center gap-2 text-sm font-semibold text-cert-green-dark hover:underline"><Award size={16} /> Certisured Learning Management System</Link></div></div></section></main>;
}
