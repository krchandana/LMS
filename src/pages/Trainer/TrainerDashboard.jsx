import { useEffect, useState } from "react";
import { CheckCircle2, Gauge, Sparkles, Target, UsersRound } from "lucide-react";
import { useAuth } from "../../context/useAuth";
import { supabase } from "../../lib/supabaseClient";

const statAccent = {
  "Assigned Students": "from-sky-400 via-cyan-400 to-teal-400",
  "Active Courses": "from-emerald-400 via-green-400 to-lime-400",
  "Pending Submissions": "from-amber-400 via-orange-400 to-rose-400",
  "Approved Tasks": "from-emerald-400 via-green-500 to-teal-500",
  "Rework Requests": "from-rose-400 via-pink-400 to-fuchsia-400",
  "Assigned Projects": "from-indigo-400 via-violet-400 to-fuchsia-400",
};

const trainerStats = [
  {
    label: "Assigned Students",
    table: "students",
    description: "Students assigned to you.",
    countQuery: (query, profile) => query.eq("trainer_id", profile.id),
  },
  {
    label: "Active Courses",
    table: "courses",
    description: "Courses you are teaching.",
    countQuery: (query, profile) => query.eq("trainer_id", profile.id).eq("status", "active"),
  },
  {
    label: "Pending Submissions",
    table: "submissions",
    description: "Student work awaiting review.",
    countQuery: (query, profile) => query.eq("trainer_id", profile.id).eq("status", "pending"),
  },
  {
    label: "Approved Tasks",
    table: "submissions",
    description: "Work you have approved.",
    countQuery: (query, profile) => query.eq("trainer_id", profile.id).eq("status", "approved"),
  },
  {
    label: "Rework Requests",
    table: "submissions",
    description: "Submissions sent back for changes.",
    countQuery: (query, profile) => query.eq("trainer_id", profile.id).eq("status", "rework"),
  },
  {
    label: "Assigned Projects",
    table: "projects",
    description: "Course projects you have assigned.",
    countQuery: (query, profile) => query.eq("trainer_id", profile.id),
  },
];

const fetchList = async (table, queryBuilder) => {
  try {
    let query = supabase.from(table).select("*");
    if (queryBuilder) query = queryBuilder(query);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(5);
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
};

export default function TrainerDashboard() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState([]);
  const [students, setStudents] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    if (!profile) return;

    const loadData = async () => {
      setLoading(true);

      const statResults = await Promise.all(
        trainerStats.map(async (item) => {
          let query = supabase.from(item.table).select("*", { count: "exact", head: true });
          if (item.countQuery) query = item.countQuery(query, profile);

          const { count, error } = await query;
          return {
            ...item,
            count: error ? null : count ?? 0,
            error: error ? error.message : null,
          };
        })
      );

      const [studentRows, submissionRows, projectRows] = await Promise.all([
        fetchList("students", (query) => query.eq("trainer_id", profile.id)),
        fetchList("submissions", (query) => query.eq("trainer_id", profile.id).order("created_at", { ascending: false })),
        fetchList("projects", (query) => query.eq("trainer_id", profile.id)),
      ]);

      setStats(statResults);
      setStudents(studentRows);
      setSubmissions(submissionRows);
      setProjects(projectRows);
      setLoading(false);
    };

    loadData();
  }, [profile]);

  const renderItem = (item) => {
    const title = item.full_name || item.name || item.title || item.email || item.id || "Untitled";
    return (
      <div key={item.id ?? title} className="rounded-[1.75rem] border border-cert-line bg-white p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_-32px_rgba(15,23,42,0.2)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-cert-ink">{title}</p>
            {item.email && <p className="text-sm text-slate-500">{item.email}</p>}
          </div>
          {item.status && (
            <span className="rounded-full bg-cert-green/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cert-green-dark">
              {item.status}
            </span>
          )}
        </div>
      </div>
    );
  };

  if (!profile) {
    return <div className="p-6 text-slate-700">Loading trainer profile...</div>;
  }

  if (loading) {
    return (
      <div className="cert-bg-trainer flex min-h-[calc(100vh-96px)] items-center justify-center px-4">
        <div className="rounded-[2rem] border border-cert-line bg-white px-10 py-8 text-center shadow-[0_24px_70px_-45px_rgba(15,23,42,0.22)]">
          <p className="text-lg font-semibold text-cert-ink">Loading trainer dashboard...</p>
          <p className="mt-2 text-sm text-slate-500">Fetching your assigned students and tasks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cert-bg-trainer min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
      <section className="cert-glass-panel overflow-hidden rounded-[2.5rem] px-8 py-8 text-cert-ink shadow-[0_28px_80px_-40px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cert-mint px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cert-green-dark ring-1 ring-cert-line">
              <Sparkles size={14} aria-hidden="true" />
              Trainer dashboard
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Hello, {profile.full_name || "Trainer"}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
              Review your students and assignments, assign projects, and manage submission statuses from one place.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" className="rounded-full bg-cert-green px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white">
                Open reviews
              </button>
              <button type="button" className="rounded-full border border-cert-line bg-white px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-mint">
                View projects
              </button>
            </div>
          </div>
          <div className="grid gap-4 rounded-[2rem] bg-cert-mint p-5 ring-1 ring-cert-line sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-[1.5rem] bg-white p-4 ring-1 ring-cert-line">
              <p className="text-xs uppercase tracking-[0.3em] text-cert-green-dark">Role</p>
              <p className="mt-3 text-2xl font-semibold text-cert-ink">{profile.role}</p>
              <p className="mt-2 text-sm text-slate-600">Your workspace for mentoring and reviews.</p>
            </div>
            <div className="rounded-[1.5rem] bg-white p-4 ring-1 ring-cert-line">
              <p className="text-xs uppercase tracking-[0.3em] text-cert-green-dark">Current focus</p>
              <p className="mt-3 text-lg font-semibold text-cert-ink">Student progress and feedback</p>
              <p className="mt-2 text-sm text-slate-600">Use submissions and projects to guide outcomes.</p>
            </div>
            <div className="sm:col-span-2 xl:col-span-1 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <UsersRound size={18} className="text-cert-green-dark" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-cert-ink">Students</p>
                <p className="mt-1 text-sm text-slate-500">{students.length} recent</p>
              </div>
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <Target size={18} className="text-cert-green-dark" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-cert-ink">Submissions</p>
                <p className="mt-1 text-sm text-slate-500">{submissions.length} pending flow</p>
              </div>
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <CheckCircle2 size={18} className="text-cert-green-dark" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-cert-ink">Projects</p>
                <p className="mt-1 text-sm text-slate-500">{projects.length} tracked</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((item) => (
          <div key={item.table + item.label} className="relative overflow-hidden rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
            <div className={`mb-5 h-1 rounded-full bg-gradient-to-r ${statAccent[item.label] || "from-slate-400 via-slate-500 to-slate-600"}`} />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{item.label}</p>
                <p className="mt-4 text-4xl font-semibold text-cert-ink">{item.count === null ? "N/A" : item.count}</p>
              </div>
              <div className={`rounded-3xl bg-gradient-to-br ${statAccent[item.label] || "from-slate-400 via-slate-500 to-slate-600"} px-4 py-3 text-sm font-semibold text-white shadow-lg`}>
                Tracker
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-500">{item.description}</p>
            {item.error && <p className="mt-4 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{item.error}</p>}
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-5 xl:grid-cols-[1.8fr_1fr]">
        <div className="space-y-5">
          <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-cert-ink">Assigned Students</h2>
                <p className="mt-2 text-sm text-slate-500">Students currently assigned to you.</p>
              </div>
              <span className="rounded-full bg-cert-green/15 px-3 py-1 text-sm font-semibold text-cert-green-dark">
                {students.length} recent
              </span>
            </div>
            <div className="mt-6 space-y-4">
              {students.length === 0 ? (
                <div className="rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">No assigned students found.</div>
              ) : (
                students.map(renderItem)
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-cert-ink">Pending Submissions</h2>
                <p className="mt-2 text-sm text-slate-500">Review work that needs your attention.</p>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-700">
                {submissions.length} recent
              </span>
            </div>
            <div className="mt-6 space-y-4">
              {submissions.length === 0 ? (
                <div className="rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">No submissions ready for review.</div>
              ) : (
                submissions.map(renderItem)
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <h2 className="text-xl font-semibold text-cert-ink">Assigned Projects</h2>
            <p className="mt-2 text-sm text-slate-500">Projects required for course completion.</p>
            <div className="mt-6 space-y-4">
              {projects.length === 0 ? (
                <div className="rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">No assigned projects found.</div>
              ) : (
                projects.map(renderItem)
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-cert-line bg-white p-6 text-cert-ink shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <h2 className="text-xl font-semibold">Trainer Actions</h2>
            <p className="mt-2 text-sm text-slate-500">Create assignments, manage projects, and update completion status.</p>
            <div className="mt-5 rounded-2xl bg-cert-mint px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-cert-ink">Guidance</p>
              <p className="mt-1">Prioritize pending submissions first, then assign next-step projects.</p>
            </div>
            <div className="mt-6 grid gap-3">
              <button className="w-full rounded-3xl bg-cert-green px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white">
                Create Assignment
              </button>
              <button className="w-full rounded-3xl border border-cert-line bg-white px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-mint">
                Assign Project
              </button>
              <button className="w-full rounded-3xl border border-cert-line bg-cert-mint px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-white">
                Review Submissions
              </button>
            </div>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
