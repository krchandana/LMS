import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CheckCircle2, Gauge, Sparkles, Target } from "lucide-react";
import { useAuth } from "../../context/useAuth";
import { supabase } from "../../lib/supabaseClient";

const statusStyles = {
  pending: "bg-amber-100 text-amber-700",
  submitted: "bg-cert-green/15 text-cert-green-dark",
  approved: "bg-cert-green/20 text-cert-green-dark",
  rejected: "bg-rose-100 text-rose-700",
  rework: "bg-rose-100 text-rose-700",
};

const statAccent = {
  Pending: "from-amber-400 via-orange-400 to-rose-400",
  Submitted: "from-sky-400 via-cyan-400 to-teal-400",
  Approved: "from-emerald-400 via-green-500 to-lime-400",
  Rejected: "from-rose-400 via-pink-400 to-fuchsia-400",
  Certificate: "from-indigo-400 via-violet-400 to-fuchsia-400",
};

const emptyData = [];

const titleFor = (item, fallback = "Untitled") =>
  item?.title || item?.name || item?.course_name || item?.project_name || item?.assignment_name || item?.full_name || fallback;

const normalizeStatus = (status) => {
  const value = (status || "pending").toLowerCase();
  if (value === "rework") return "rejected";
  return value;
};

const runQuery = async (table, buildQuery) => {
  try {
    let query = supabase.from(table).select("*");
    if (buildQuery) query = buildQuery(query);
    const { data, error } = await query;
    return error ? emptyData : data ?? emptyData;
  } catch {
    return emptyData;
  }
};

const firstWorkingList = async (table, builders) => {
  for (const buildQuery of builders) {
    const rows = await runQuery(table, buildQuery);
    if (rows.length) return rows;
  }

  return emptyData;
};

const insertWithColumnFallback = async (table, payload) => {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(nextPayload).select().single();
    if (!error) return { data };

    const message = error.message || "";
    const missingColumnMatch = message.match(/column "([^"]+)"/i) || message.match(/'([^']+)' column/i);
    if (!missingColumnMatch) return { error };

    const missingColumn = missingColumnMatch[1];
    if (!Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)) return { error };

    const remainingPayload = { ...nextPayload };
    delete remainingPayload[missingColumn];
    nextPayload = remainingPayload;
  }

  return { error: { message: "Unable to submit work with the available submission columns." } };
};

export default function StudentDashboard() {
  const { profile, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [studentRecord, setStudentRecord] = useState(null);
  const [courses, setCourses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [submissionTask, setSubmissionTask] = useState(null);
  const [workLink, setWorkLink] = useState("");
  const [workNotes, setWorkNotes] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!profile || !user) return;

    const loadDashboard = async () => {
      setLoading(true);

      const studentRows = await firstWorkingList("students", [
        (query) => query.eq("profile_id", profile.id).limit(1),
        (query) => query.eq("user_id", profile.id).limit(1),
        (query) => query.eq("id", profile.id).limit(1),
        (query) => query.eq("email", profile.email || user.email).limit(1),
      ]);

      const student = studentRows[0] || {
        id: profile.id,
        profile_id: profile.id,
        email: profile.email || user.email,
        full_name: profile.full_name,
        trainer_id: profile.trainer_id,
        course_id: profile.course_id,
      };
      const studentIds = [student.id, student.profile_id, student.user_id, profile.id].filter(Boolean);
      const trainerId = student.trainer_id || profile.trainer_id;
      const directCourseIds = [student.course_id, student.course, profile.course_id].filter(Boolean);

      const enrollmentRows = await firstWorkingList("enrollments", [
        (query) => query.in("student_id", studentIds),
      ]);
      const enrolledCourseIds = [...new Set([...directCourseIds, ...enrollmentRows.map((row) => row.course_id || row.id).filter(Boolean)])];

      const courseRows = enrolledCourseIds.length
        ? await firstWorkingList("courses", [
            (query) => query.in("id", enrolledCourseIds),
            (query) => query.in("course_id", enrolledCourseIds),
          ])
        : await firstWorkingList("courses", [
            (query) => query.in("student_id", studentIds),
            (query) => query.eq("trainer_id", trainerId),
            (query) => query.eq("status", "active").limit(5),
          ]);

      const trainerIds = [...new Set([trainerId, ...courseRows.map((course) => course.trainer_id).filter(Boolean)])];
      const trainerRows = trainerIds.length
        ? await firstWorkingList("profiles", [
            (query) => query.in("id", trainerIds).eq("role", "trainer"),
            (query) => query.in("id", trainerIds),
          ])
        : emptyData;

      const trainerById = new Map(trainerRows.map((trainer) => [trainer.id, trainer]));
      const courseRowsWithTrainer = courseRows.map((course) => {
        const trainer = trainerById.get(course.trainer_id || trainerId);
        return {
          ...course,
          trainer_name: course.trainer_name || trainer?.full_name || trainer?.name || "Unassigned",
        };
      });

      const courseIds = courseRowsWithTrainer.map((course) => course.id || course.course_id).filter(Boolean);
      const projectRows = await firstWorkingList("projects", [
        (query) => query.in("student_id", studentIds),
        (query) => query.in("profile_id", studentIds),
        (query) => query.in("course_id", courseIds),
        (query) => query.eq("trainer_id", trainerId),
      ]);
      const assignmentRows = await firstWorkingList("assignments", [
        (query) => query.in("student_id", studentIds),
        (query) => query.in("profile_id", studentIds),
        (query) => query.in("course_id", courseIds),
        (query) => query.eq("trainer_id", trainerId),
      ]);
      const taskRows = [
        ...assignmentRows.map((task) => ({ ...task, task_type: "assignment" })),
        ...projectRows.map((task) => ({ ...task, task_type: "project" })),
      ];

      const submissionRows = await firstWorkingList("submissions", [
        (query) => query.in("student_id", studentIds),
        (query) => query.in("profile_id", studentIds),
        (query) => query.eq("student_email", profile.email || user.email),
      ]);
      const certificateRows = await firstWorkingList("certificates", [
        (query) => query.in("student_id", studentIds),
        (query) => query.in("profile_id", studentIds),
        (query) => query.eq("student_email", profile.email || user.email),
      ]);

      setStudentRecord(student);
      setCourses(courseRowsWithTrainer);
      setTasks(taskRows);
      setSubmissions(submissionRows);
      setCertificates(certificateRows);
      setLoading(false);
    };

    loadDashboard();
  }, [profile, user]);

  const taskSummaries = useMemo(() => {
    const submissionByTask = new Map();
    submissions.forEach((submission) => {
      const taskId = submission.assignment_id || submission.project_id || submission.task_id;
      if (taskId) submissionByTask.set(taskId, submission);
    });

    return tasks.map((task) => {
      const taskId = task.id || task.assignment_id || task.project_id;
      const submission = task.task_type === "project" ? task : submissionByTask.get(taskId);
      const status = normalizeStatus(submission?.status || task.status || "pending");
      return { ...task, taskId, submission, status };
    });
  }, [tasks, submissions]);

  const stats = useMemo(() => {
    const totalTasks = taskSummaries.length;
    const counts = taskSummaries.reduce(
      (acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      },
      { pending: 0, submitted: 0, approved: 0, rejected: 0 }
    );
    const approved = counts.approved || 0;
    const progress = totalTasks ? Math.round((approved / totalTasks) * 100) : 0;
    const eligible = totalTasks > 0 && approved === totalTasks;

    return { totalTasks, counts, approved, progress, eligible };
  }, [taskSummaries]);

  const openSubmitForm = (task) => {
    setSubmissionTask(task);
    setWorkLink("");
    setWorkNotes("");
    setSubmitError("");
    setSubmitSuccess("");
  };

  const submitWork = async (event) => {
    event.preventDefault();
    setSubmitError("");
    setSubmitSuccess("");

    if (!submissionTask) {
      setSubmitError("Please select a task.");
      return;
    }

    if (!workLink.trim() && !workNotes.trim()) {
      setSubmitError("Add a work link or notes before submitting.");
      return;
    }

    setIsSubmitting(true);

    const isProject = submissionTask.task_type === "project";
    const payload = isProject
      ? {
          github_url: workLink.trim() || null,
          project_file_url: workLink.trim() || null,
          review_feedback: workNotes.trim() || null,
          status: "submitted",
          submitted_at: new Date().toISOString(),
        }
      : {
          student_id: studentRecord?.id || profile.id,
          assignment_id: submissionTask.taskId,
          submission_url: workLink.trim() || null,
          feedback: workNotes.trim() || null,
          status: "submitted",
          submitted_at: new Date().toISOString(),
        };

    const result = isProject
      ? await supabase.from("projects").update(payload).eq("id", submissionTask.taskId).select().single()
      : await insertWithColumnFallback("submissions", payload);
    const { data, error } = result;
    setIsSubmitting(false);

    if (error) {
      setSubmitError(error.message || "Unable to submit work.");
      return;
    }

    if (isProject) {
      setTasks((prev) => prev.map((task) => (task.id === data.id ? { ...task, ...data } : task)));
    } else {
      setSubmissions((prev) => [data, ...prev]);
    }
    setSubmissionTask(null);
    setWorkLink("");
    setWorkNotes("");
    setSubmitSuccess("Work submitted successfully.");
  };

  const renderCourse = (course) => (
    <div key={course.id || titleFor(course)} className="rounded-[1.75rem] border border-cert-line bg-white p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_-32px_rgba(15,23,42,0.2)]">
      <div className="mb-4 h-1.5 rounded-full bg-gradient-to-r from-emerald-400 via-green-500 to-teal-500" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-cert-ink">{titleFor(course, "Course")}</p>
          <p className="mt-2 text-sm text-slate-500">Trainer: {course.trainer_name || "Unassigned"}</p>
          {course.duration && <p className="mt-2 text-sm text-slate-500">Duration: {course.duration}</p>}
        </div>
        <span className="rounded-full bg-cert-green/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cert-green-dark">
          {course.status || "enrolled"}
        </span>
      </div>
    </div>
  );

  const renderTask = (task) => (
    <div key={`${task.task_type}-${task.taskId || titleFor(task)}`} className="rounded-[1.75rem] border border-cert-line bg-white p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_-32px_rgba(15,23,42,0.2)]">
      <div className={`mb-4 h-1.5 rounded-full bg-gradient-to-r ${task.status === "approved" ? "from-emerald-400 via-green-500 to-teal-500" : "from-sky-400 via-cyan-400 to-indigo-400"}`} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-cert-ink">{titleFor(task, "Task")}</p>
          <p className="mt-2 text-sm capitalize text-slate-500">{task.task_type}</p>
          {task.description && <p className="mt-2 text-sm leading-6 text-slate-500">{task.description}</p>}
          {task.due_date && <p className="mt-2 text-sm text-slate-500">Due: {task.due_date}</p>}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${statusStyles[task.status] || "bg-slate-200 text-slate-700"}`}>
          {task.status}
        </span>
      </div>
      {task.status !== "approved" && (
        <button
          type="button"
          onClick={() => openSubmitForm(task)}
          className="mt-4 rounded-3xl bg-cert-green px-4 py-2 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white"
        >
          Submit Work
        </button>
      )}
    </div>
  );

  if (!profile) return <div className="p-6 text-slate-700">Loading student profile...</div>;

  if (loading) {
    return (
      <div className="cert-bg-student flex min-h-[calc(100vh-96px)] items-center justify-center px-4">
        <div className="rounded-[2rem] border border-cert-line bg-white px-10 py-8 text-center shadow-[0_24px_70px_-45px_rgba(15,23,42,0.22)]">
          <p className="text-lg font-semibold text-cert-ink">Loading student dashboard...</p>
          <p className="mt-2 text-sm text-slate-500">Fetching your courses, trainer, and course work.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cert-bg-student min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
      <section className="cert-glass-panel overflow-hidden rounded-[2.5rem] px-8 py-8 text-cert-ink shadow-[0_28px_80px_-40px_rgba(15,23,42,0.18)]">
        <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cert-mint px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cert-green-dark ring-1 ring-cert-line">
              <Sparkles size={14} aria-hidden="true" />
              Student dashboard
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Hello, {profile.full_name || "Student"}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
              Track your enrolled courses, assigned work, submissions, progress, and certificate readiness.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" className="rounded-full bg-cert-green px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white">
                Open assignments
              </button>
              <button type="button" className="rounded-full border border-cert-line bg-white px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-mint">
                View course progress
              </button>
            </div>
          </div>
          <div className="grid gap-4 rounded-[2rem] bg-cert-mint p-5 ring-1 ring-cert-line sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-[1.5rem] bg-white p-4 ring-1 ring-cert-line">
              <p className="text-xs uppercase tracking-[0.28em] text-cert-green-dark">Completion</p>
              <p className="mt-3 text-3xl font-semibold text-cert-ink">{stats.progress}%</p>
              <p className="mt-2 text-sm text-slate-600">Live progress based on approved tasks.</p>
            </div>
            <div className="rounded-[1.5rem] bg-white p-4 ring-1 ring-cert-line">
              <p className="text-xs uppercase tracking-[0.28em] text-cert-green-dark">Readiness</p>
              <p className="mt-3 text-lg font-semibold text-cert-ink">{stats.eligible ? "Certificate eligible" : "In progress"}</p>
              <p className="mt-2 text-sm text-slate-600">{stats.approved} approved out of {stats.totalTasks} tasks.</p>
            </div>
            <div className="sm:col-span-2 xl:col-span-1 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <BookOpenCheck size={18} className="text-cert-green-dark" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-cert-ink">Courses</p>
                <p className="mt-1 text-sm text-slate-500">{courses.length} active view</p>
              </div>
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <Target size={18} className="text-cert-green-dark" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-cert-ink">Tasks</p>
                <p className="mt-1 text-sm text-slate-500">{taskSummaries.length} tracked</p>
              </div>
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <CheckCircle2 size={18} className="text-cert-green-dark" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-cert-ink">Submitted</p>
                <p className="mt-1 text-sm text-slate-500">{stats.counts.submitted || 0} pending review</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Pending", stats.counts.pending || 0, "Tasks not submitted yet."],
          ["Submitted", stats.counts.submitted || 0, "Work waiting for review."],
          ["Approved", stats.counts.approved || 0, "Completed course work."],
          ["Rejected", stats.counts.rejected || 0, "Tasks needing changes."],
          ["Certificate", stats.eligible ? "Eligible" : "Not yet", certificates.length ? "Certificate record found." : "Complete all work to qualify."],
        ].map(([label, value, description]) => (
          <div key={label} className="relative overflow-hidden rounded-[2rem] border border-cert-line bg-white p-5 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${statAccent[label] || "from-slate-400 via-slate-500 to-slate-600"}`} />
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{label}</p>
            <p className="mt-4 text-3xl font-semibold text-cert-ink">{value}</p>
            <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-5 xl:grid-cols-[1fr_1.4fr_0.9fr]">
        <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
          <h2 className="text-xl font-semibold text-cert-ink">Enrolled Courses</h2>
          <p className="mt-2 text-sm text-slate-500">Courses and trainer assignment.</p>
          <div className="mt-6 space-y-4">
            {courses.length === 0 ? <div className="rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">No enrolled courses found.</div> : courses.map(renderCourse)}
          </div>
        </div>

        <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
          <h2 className="text-xl font-semibold text-cert-ink">Assignments & Projects</h2>
          <p className="mt-2 text-sm text-slate-500">Submit work and track review status.</p>
          <div className="mt-6 space-y-4">
            {taskSummaries.length === 0 ? <div className="rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">No assignments or projects found.</div> : taskSummaries.map(renderTask)}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <h2 className="text-xl font-semibold text-cert-ink">Course Progress</h2>
            <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-cert-green" style={{ width: `${stats.progress}%` }} />
            </div>
            <p className="mt-4 text-sm text-slate-500">
              {stats.approved} of {stats.totalTasks} required tasks approved.
            </p>
            <div className="mt-5 rounded-2xl bg-cert-mint px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-cert-ink">Focus today</p>
              <p className="mt-1">Finish pending items to move faster toward certificate eligibility.</p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <h2 className="text-xl font-semibold text-cert-ink">Submit Completed Work</h2>
            {submissionTask ? (
              <form onSubmit={submitWork} className="mt-5 space-y-4">
                <p className="rounded-3xl bg-cert-mint px-4 py-3 text-sm font-semibold text-cert-ink">{titleFor(submissionTask, "Selected task")}</p>
                <input
                  type="url"
                  value={workLink}
                  onChange={(event) => setWorkLink(event.target.value)}
                  placeholder="Work link"
                  className="w-full rounded-3xl border border-cert-line bg-cert-mint px-4 py-3 text-sm text-cert-ink outline-none focus:border-cert-green focus:ring-2 focus:ring-cert-green/20"
                />
                <textarea
                  value={workNotes}
                  onChange={(event) => setWorkNotes(event.target.value)}
                  placeholder="Notes"
                  className="min-h-28 w-full rounded-3xl border border-cert-line bg-cert-mint px-4 py-3 text-sm text-cert-ink outline-none focus:border-cert-green focus:ring-2 focus:ring-cert-green/20"
                />
                {submitError && <p className="rounded-3xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{submitError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={isSubmitting} className="flex-1 rounded-3xl bg-cert-green px-4 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white disabled:bg-slate-400 disabled:text-white">
                    {isSubmitting ? "Submitting..." : "Submit"}
                  </button>
                  <button type="button" onClick={() => setSubmissionTask(null)} className="rounded-3xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-4 rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">Choose Submit Work on an assignment or project.</p>
            )}
            {submitSuccess && <p className="mt-4 rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{submitSuccess}</p>}
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
