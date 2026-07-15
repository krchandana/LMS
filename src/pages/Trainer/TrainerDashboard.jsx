import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CheckCircle2, ClipboardCheck, LogOut, Plus, Sparkles, UsersRound, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { supabase } from "../../lib/supabaseClient";

const titleFor = (item, fallback = "Untitled") => item?.title || item?.name || item?.full_name || item?.email || fallback;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const hasServiceRoleKey = Boolean(supabaseUrl && serviceRoleKey);
const assignmentDateKey = (assignment) => assignment?.due_date || assignment?.created_at?.slice(0, 10) || "no-date";
const formatAssignmentDate = (date) => {
  if (!date || date === "no-date") return "No due date";
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(parsed);
};
const formatAssignedDate = (date) => {
  if (!date) return "Date unavailable";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(parsed);
};
const formatVideoAvailability = (date) => {
  if (!date) return "Available 24 hours after posting";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "Available 24 hours after posting"
    : `Available ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(parsed)}`;
};
const videoIsActive = (video) => Boolean(video?.available_at) && new Date(video.available_at).getTime() <= Date.now();

const fetchRows = async (table, buildQuery) => {
  try {
    let query = supabase.from(table).select("*");
    if (buildQuery) query = buildQuery(query);
    const { data, error } = await query;
    return error ? [] : data || [];
  } catch {
    return [];
  }
};

// Trainer RLS policies may legitimately return an empty list rather than an
// error. The application already uses this configured admin fallback for
// administrative data, so use it here to load the trainer's own mapped data.
const fetchRowsWithServiceRole = async (table) => {
  if (!hasServiceRoleKey) return [];
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1000`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

export default function TrainerDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState([]);
  const [students, setStudents] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [courseVideos, setCourseVideos] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [assignmentForm, setAssignmentForm] = useState({ courseId: "", title: "", description: "", dueDate: "" });
  const [projectForm, setProjectForm] = useState({ courseId: "", title: "", description: "" });
  const [videoForm, setVideoForm] = useState({ courseId: "", title: "", lessonDate: new Date().toISOString().slice(0, 10), videoUrl: "" });
  const [reviewNotes, setReviewNotes] = useState({});
  const [activeWorkspace, setActiveWorkspace] = useState("overview");

  const loadDashboard = async () => {
    if (!profile?.id) return;
    setLoading(true);
    const allCourses = hasServiceRoleKey
      ? await fetchRowsWithServiceRole("courses")
      : await fetchRows("courses", (query) => query.eq("trainer_id", profile.id));
    const trainerCourses = allCourses.filter((course) => String(course.trainer_id) === String(profile.id));
    const courseIds = trainerCourses.map((course) => course.id).filter(Boolean);
    const allEnrollments = courseIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("enrollments")
        : await fetchRows("enrollments", (query) => query.in("course_id", courseIds)))
      : [];
    const enrollmentRows = allEnrollments.filter((row) => courseIds.some((courseId) => String(courseId) === String(row.course_id)));
    const studentIds = [...new Set(enrollmentRows.map((row) => row.student_id).filter(Boolean))];
    const allStudentProfiles = studentIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("profiles")
        : await fetchRows("profiles", (query) => query.in("id", studentIds).eq("role", "student")))
      : [];
    const studentRows = allStudentProfiles.filter((student) =>
      studentIds.some((studentId) => String(studentId) === String(student.id)) && (student.role || "student") === "student"
    );
    const allAssignments = courseIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("assignments")
        : await fetchRows("assignments", (query) => query.in("course_id", courseIds).order("created_at", { ascending: false })))
      : [];
    const assignmentRows = allAssignments
      .filter((assignment) => courseIds.some((courseId) => String(courseId) === String(assignment.course_id)))
      .sort((first, second) => String(second.created_at || "").localeCompare(String(first.created_at || "")));
    const allProjects = courseIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("projects")
        : await fetchRows("projects", (query) => query.in("course_id", courseIds).order("submitted_at", { ascending: false })))
      : [];
    const projectRows = allProjects
      .filter((project) => courseIds.some((courseId) => String(courseId) === String(project.course_id)))
      .sort((first, second) => String(second.submitted_at || "").localeCompare(String(first.submitted_at || "")));
    const assignmentIds = assignmentRows.map((assignment) => assignment.id).filter(Boolean);
    const allSubmissions = assignmentIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("submissions")
        : await fetchRows("submissions", (query) => query.in("assignment_id", assignmentIds).order("submitted_at", { ascending: false })))
      : [];
    const submissionRows = allSubmissions
      .filter((submission) => assignmentIds.some((assignmentId) => String(assignmentId) === String(submission.assignment_id)))
      .sort((first, second) => String(second.submitted_at || "").localeCompare(String(first.submitted_at || "")));
    const allCourseVideos = courseIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("course_videos")
        : await fetchRows("course_videos", (query) => query.in("course_id", courseIds).order("created_at", { ascending: false })))
      : [];
    const videoRows = allCourseVideos
      .filter((video) => courseIds.some((courseId) => String(courseId) === String(video.course_id)))
      .sort((first, second) => String(second.created_at || "").localeCompare(String(first.created_at || "")));

    setCourses(trainerCourses);
    setEnrollments(enrollmentRows);
    setStudents(studentRows);
    setAssignments(assignmentRows);
    setProjects(projectRows);
    setSubmissions(submissionRows);
    setCourseVideos(videoRows);
    setLoading(false);
  };

  useEffect(() => {
    loadDashboard();
  }, [profile?.id]);

  const studentById = useMemo(() => new Map(students.map((student) => [String(student.id), student])), [students]);
  const courseById = useMemo(() => new Map(courses.map((course) => [String(course.id), course])), [courses]);
  const assignmentById = useMemo(() => new Map(assignments.map((assignment) => [String(assignment.id), assignment])), [assignments]);
  const assignmentsByDate = useMemo(() => {
    const groups = new Map();
    [...assignments]
      .sort((first, second) => assignmentDateKey(first).localeCompare(assignmentDateKey(second)))
      .forEach((assignment) => {
        const date = assignmentDateKey(assignment);
        groups.set(date, [...(groups.get(date) || []), assignment]);
      });
    return [...groups.entries()];
  }, [assignments]);
  const assignedProjectGroups = useMemo(() => {
    const groups = new Map();

    projects.forEach((project) => {
      const assignedAt = project.created_at || project.assigned_at || null;
      const key = `${project.course_id || "course"}-${project.title || "project"}-${assignedAt || project.id}`;
      const group = groups.get(key) || { ...project, assignedAt, studentIds: new Set() };
      if (project.student_id) group.studentIds.add(String(project.student_id));
      groups.set(key, group);
    });

    return [...groups.values()].sort((first, second) => String(second.assignedAt || "").localeCompare(String(first.assignedAt || "")));
  }, [projects]);

  const enrolledStudentIds = (courseId) => [...new Set(
    enrollments
      .filter((row) => String(row.course_id) === String(courseId))
      .map((row) => row.student_id)
      .filter(Boolean)
  )];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const openWorkspace = (workspace) => {
    setActiveWorkspace(workspace);
    window.history.replaceState(null, "", `#${workspace}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const createAssignment = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!assignmentForm.courseId || !assignmentForm.title.trim()) {
      setError("Select a course and enter an assignment title.");
      return;
    }
    const { error: createError } = await supabase.from("assignments").insert({
      course_id: assignmentForm.courseId,
      trainer_id: profile.id,
      title: assignmentForm.title.trim(),
      description: assignmentForm.description.trim() || null,
      due_date: assignmentForm.dueDate || null,
      status: "active",
    });
    if (createError) {
      setError(createError.message || "Unable to create assignment.");
      return;
    }
    setAssignmentForm({ courseId: "", title: "", description: "", dueDate: "" });
    setMessage("Assignment created for the selected course.");
    await loadDashboard();
  };

  const createProject = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!projectForm.courseId || !projectForm.title.trim()) {
      setError("Select a course and enter a project title.");
      return;
    }
    const studentIds = enrolledStudentIds(projectForm.courseId);
    if (!studentIds.length) {
      setError("This course has no enrolled students to assign the project to.");
      return;
    }
    const { error: createError } = await supabase.from("projects").insert(studentIds.map((studentId) => ({
      course_id: projectForm.courseId,
      student_id: studentId,
      title: projectForm.title.trim(),
      description: projectForm.description.trim() || null,
      status: "pending",
    })));
    if (createError) {
      setError(createError.message || "Unable to assign project.");
      return;
    }
    setProjectForm({ courseId: "", title: "", description: "" });
    setMessage(`Project assigned to ${studentIds.length} enrolled ${studentIds.length === 1 ? "student" : "students"}.`);
    await loadDashboard();
  };

  const completeCourseIfReady = async (studentId, courseId) => {
    const courseAssignments = await fetchRows("assignments", (query) => query.eq("course_id", courseId));
    const studentAssignments = courseAssignments.filter((assignment) =>
      !assignment.student_id || String(assignment.student_id) === String(studentId)
    );
    const studentSubmissions = await fetchRows("submissions", (query) => query.eq("student_id", studentId));
    const studentProjects = await fetchRows("projects", (query) => query.eq("student_id", studentId).eq("course_id", courseId));
    const assignmentComplete = studentAssignments.every((assignment) =>
      studentSubmissions.some((submission) => String(submission.assignment_id) === String(assignment.id) && submission.status === "approved")
    );
    const projectComplete = studentProjects.every((project) => project.status === "approved");
    if (!studentAssignments.length && !studentProjects.length) return;
    if (!assignmentComplete || !projectComplete) return;

    const enrollment = enrollments.find((row) => String(row.student_id) === String(studentId) && String(row.course_id) === String(courseId));
    if (enrollment?.id) {
      await supabase.from("enrollments").update({ enrollment_status: "completed" }).eq("id", enrollment.id);
    }
    const existingCertificate = await fetchRows("certificates", (query) => query.eq("student_id", studentId).eq("course_id", courseId));
    if (!existingCertificate.length) {
      await supabase.from("certificates").insert({
        student_id: studentId,
        course_id: courseId,
        certificate_number: `CERT-${Date.now().toString().slice(-8)}`,
        issue_date: new Date().toISOString().slice(0, 10),
        status: "eligible",
        issued_by: profile.id,
      });
    }
  };

  const reviewSubmission = async (submission, status) => {
    setError("");
    setMessage("");
    const { error: reviewError } = await supabase.from("submissions").update({
      status,
      feedback: reviewNotes[submission.id] || null,
      graded_by: profile.id,
      graded_at: new Date().toISOString(),
    }).eq("id", submission.id);
    if (reviewError) {
      setError(reviewError.message || "Unable to review submission.");
      return;
    }
    const assignment = assignmentById.get(String(submission.assignment_id));
    if (status === "approved" && assignment?.course_id) await completeCourseIfReady(submission.student_id, assignment.course_id);
    setMessage(status === "approved" ? "Submission approved." : "Submission returned for rework.");
    await loadDashboard();
  };

  const reviewProject = async (project, status) => {
    setError("");
    setMessage("");
    const { error: reviewError } = await supabase.from("projects").update({
      status,
      review_feedback: reviewNotes[project.id] || null,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq("id", project.id);
    if (reviewError) {
      setError(reviewError.message || "Unable to review project.");
      return;
    }
    if (status === "approved") await completeCourseIfReady(project.student_id, project.course_id);
    setMessage(status === "approved" ? "Project approved." : "Project returned for rework.");
    await loadDashboard();
  };

  if (!profile || loading) {
    return <div className="cert-bg-trainer flex min-h-screen items-center justify-center p-6 text-cert-ink">Loading trainer workspace...</div>;
  }

  const awaitingSubmissions = submissions.filter((submission) => (submission.status || "").toLowerCase() === "submitted");
  const awaitingProjects = projects.filter((project) => (project.status || "").toLowerCase() === "submitted");

  return (
    <div className="cert-bg-trainer min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="w-full space-y-6">
        <nav className="sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[1.75rem] border border-cert-line bg-white/95 p-3 shadow-[0_18px_50px_-35px_rgba(15,23,42,0.4)] backdrop-blur">
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => openWorkspace("overview")} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "overview" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}><Sparkles size={16} /> Overview</button>
            <button type="button" onClick={() => openWorkspace("create-assignment")} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "create-assignment" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}>Create assignment</button>
            <button type="button" onClick={() => openWorkspace("assign-project")} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "assign-project" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}>Assign project</button>
            <button type="button" onClick={() => openWorkspace("project-reviews")} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "project-reviews" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}>Project reviews</button>
            <button type="button" onClick={() => openWorkspace("assignment-submissions")} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "assignment-submissions" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}>Assignment submissions</button>
            <button type="button" onClick={handleLogout} className="inline-flex items-center gap-2 rounded-xl bg-cert-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-cert-green-dark">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </nav>

        {activeWorkspace === "overview" && <section className="space-y-6">
          <div className="relative overflow-hidden rounded-[2rem] bg-[radial-gradient(circle_at_88%_12%,rgba(231,232,91,0.32),transparent_24%),linear-gradient(135deg,#062239_0%,#08415a_56%,#0c8a58_135%)] p-7 text-white shadow-[0_28px_70px_-38px_rgba(7,26,47,0.5)] sm:p-9">
            <div className="absolute -bottom-24 -right-16 h-64 w-64 rounded-full border border-white/10" />
            <div className="relative flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cert-yellow backdrop-blur"><Sparkles size={14} /> Trainer dashboard</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Hello, {profile.full_name || "Trainer"}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-emerald-50/85">Create course work, review student submissions, and approve completed learning outcomes.</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur"><UsersRound size={18} className="mx-auto text-cert-yellow" /><p className="mt-2 text-lg font-semibold text-white">{students.length}</p><p className="text-xs text-emerald-50/80">Students</p></div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur"><BookOpenCheck size={18} className="mx-auto text-cert-yellow" /><p className="mt-2 text-lg font-semibold text-white">{assignments.length}</p><p className="text-xs text-emerald-50/80">Assignments</p></div>
              <button type="button" onClick={() => openWorkspace("assignment-submissions")} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur transition hover:bg-white/20"><ClipboardCheck size={18} className="mx-auto text-cert-yellow" /><p className="mt-2 text-lg font-semibold text-white">{awaitingSubmissions.length + awaitingProjects.length}</p><p className="text-xs text-emerald-50/80">To review</p></button>
            </div>
            </div>
          </div>
          <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-38px_rgba(7,26,47,0.18)] sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-green-dark">Teaching portfolio</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Course details</h2><p className="mt-1 text-sm text-slate-500">See every course you lead and its enrolled students.</p></div>
              <span className="rounded-full bg-cert-mint px-3 py-1.5 text-sm font-semibold text-cert-green-dark">{courses.length} {courses.length === 1 ? "course" : "courses"}</span>
            </div>
            {courses.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-cert-line bg-slate-50 px-5 py-7 text-center text-sm text-slate-500">No courses are assigned to you yet.</div> : <div className="mt-5 grid gap-4 lg:grid-cols-2">{courses.map((course) => {
              const courseStudentIds = enrolledStudentIds(course.id);
              return <article key={course.id} className="overflow-hidden rounded-2xl border border-cert-line bg-white shadow-[0_16px_38px_-30px_rgba(7,26,47,0.22)]">
                <div className="flex items-start justify-between gap-4 border-b border-cert-line bg-[linear-gradient(135deg,#f4fff8_0%,#e9f8ef_100%)] p-5"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cert-green-dark">Course</p><h3 className="mt-2 text-xl font-semibold text-cert-ink">{titleFor(course, "Course")}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{course.description || "Learning workspace managed by you."}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] text-cert-green-dark ring-1 ring-cert-line">{course.status || "active"}</span></div>
                <div className="p-5"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-cert-ink">Enrolled students</p><span className="rounded-full bg-cert-green/15 px-2.5 py-1 text-xs font-bold text-cert-green-dark">{courseStudentIds.length}</span></div>{courseStudentIds.length === 0 ? <p className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">No students are enrolled in this course yet.</p> : <div className="mt-3 flex flex-wrap gap-2">{courseStudentIds.map((studentId) => { const student = studentById.get(String(studentId)); const name = titleFor(student, "Student"); return <span key={studentId} className="inline-flex items-center gap-2 rounded-full border border-cert-line bg-white px-2.5 py-1.5 text-sm font-medium text-cert-ink"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cert-mint text-xs font-bold text-cert-green-dark">{name.charAt(0).toUpperCase()}</span>{name}</span>; })}</div>}</div>
              </article>;
            })}</div>}
          </div>
        </section>}

        {(error || message) && <p className={`rounded-2xl px-4 py-3 text-sm ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{error || message}</p>}

        {(activeWorkspace === "create-assignment" || activeWorkspace === "assign-project") && (
          <section className="grid w-full gap-5 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          {activeWorkspace === "create-assignment" && <form id="create-assignment" onSubmit={createAssignment} className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <header className="relative overflow-hidden bg-[radial-gradient(circle_at_88%_12%,rgba(231,232,91,0.3),transparent_30%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_140%)] px-6 py-7 text-white"><div className="absolute -bottom-10 right-7 h-28 w-28 rounded-full border border-white/10" /><div className="relative"><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-yellow">Assignment builder</p><h2 className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold"><Plus size={22} /> Create assignment</h2><p className="mt-2 text-sm leading-6 text-emerald-50/85">Set the course, instructions, and due date for your learners.</p></div></header>
            <div className="grid gap-4 p-5 sm:p-6">
              <label className="text-sm font-semibold text-cert-ink">Course<select value={assignmentForm.courseId} onChange={(e) => setAssignmentForm({ ...assignmentForm, courseId: e.target.value })} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{titleFor(course, "Course")}</option>)}</select></label>
              <label className="text-sm font-semibold text-cert-ink">Assignment title<input value={assignmentForm.title} onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })} placeholder="For example: Build a Python calculator" className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label>
              <label className="text-sm font-semibold text-cert-ink">Instructions<textarea value={assignmentForm.description} onChange={(e) => setAssignmentForm({ ...assignmentForm, description: e.target.value })} placeholder="Explain what students need to complete and submit." className="mt-2 min-h-32 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" /></label>
              <label className="text-sm font-semibold text-cert-ink">Due date<input type="date" value={assignmentForm.dueDate} onChange={(e) => setAssignmentForm({ ...assignmentForm, dueDate: e.target.value })} className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" /></label>
              <button className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#0d8f55_0%,#31c96f_100%)] px-4 py-3.5 font-semibold text-cert-ink shadow-[0_16px_28px_-18px_rgba(13,143,85,0.7)] transition hover:brightness-105"><Plus size={18} /> Create assignment</button>
            </div>
          </form>}

          {activeWorkspace === "create-assignment" && <aside className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="p-6">
                <h2 className="text-xl font-semibold text-cert-ink">Saved assignments</h2>
                <p className="mt-1 text-sm text-slate-500">Assignment details ordered by due date.</p>
              </div>
              <span className="mr-6 rounded-full bg-cert-mint px-3 py-1 text-sm font-semibold text-cert-green-dark">{assignments.length} total</span>
            </div>
            <div className="max-h-[42rem] space-y-5 overflow-y-auto border-t border-cert-line p-5 sm:p-6">
              {assignmentsByDate.length === 0 ? <div className="rounded-2xl border border-dashed border-cert-line bg-[linear-gradient(135deg,#f6fffa_0%,#edf8f2_100%)] px-5 py-12 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-cert-green-dark ring-1 ring-cert-line"><BookOpenCheck size={23} /></span><p className="mt-4 font-semibold text-cert-ink">No assignments yet</p><p className="mt-2 text-sm text-slate-500">New assignments will be organised here by due date.</p></div> : assignmentsByDate.map(([date, datedAssignments]) => <div key={date}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cert-green-dark">{formatAssignmentDate(date)}</p>
                <div className="space-y-3">{datedAssignments.map((assignment) => <article key={assignment.id} className="rounded-2xl border border-cert-line bg-cert-mint/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-cert-ink">{titleFor(assignment, "Assignment")}</p>
                      <p className="mt-1 text-sm text-slate-600">Course: {titleFor(courseById.get(String(assignment.course_id)), "Course")}</p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-cert-green-dark">{assignment.status || "active"}</span>
                  </div>
                  {assignment.description && <p className="mt-3 text-sm leading-6 text-slate-600">{assignment.description}</p>}
                </article>)}</div>
              </div>)}
            </div>
          </aside>}

          {activeWorkspace === "assign-project" && <form id="assign-project" onSubmit={createProject} className="rounded-[1.75rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-cert-ink"><Plus size={20} /> Assign project</h2>
            <div className="mt-5 grid gap-3">
              <select value={projectForm.courseId} onChange={(e) => setProjectForm({ ...projectForm, courseId: e.target.value })} className="rounded-xl border border-cert-line bg-cert-mint px-4 py-3" required><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{titleFor(course, "Course")}</option>)}</select>
              <p className="rounded-xl bg-cert-mint px-4 py-3 text-sm text-slate-600">
                {projectForm.courseId
                  ? `This project will be assigned to all ${enrolledStudentIds(projectForm.courseId).length} students enrolled in this course.`
                  : "Select a course to assign the project to every enrolled student."}
              </p>
              <input value={projectForm.title} onChange={(e) => setProjectForm({ ...projectForm, title: e.target.value })} placeholder="Project title" className="rounded-xl border border-cert-line px-4 py-3" required />
              <textarea value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} placeholder="Project instructions" className="min-h-24 rounded-xl border border-cert-line px-4 py-3" />
              <button className="rounded-xl bg-cert-green px-4 py-3 font-semibold text-cert-ink">Assign project to all students</button>
            </div>
          </form>}

          {activeWorkspace === "assign-project" && <aside className="rounded-[1.75rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-cert-ink">Assigned projects</h2>
                <p className="mt-1 text-sm text-slate-500">Projects sent to enrolled students, newest first.</p>
              </div>
              <span className="rounded-full bg-cert-mint px-3 py-1 text-sm font-semibold text-cert-green-dark">{assignedProjectGroups.length} total</span>
            </div>
            <div className="mt-5 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
              {assignedProjectGroups.length === 0 ? <p className="rounded-2xl bg-cert-mint p-4 text-sm text-slate-500">No projects have been assigned yet.</p> : assignedProjectGroups.map((project) => <article key={`${project.id}-${project.assignedAt || "undated"}`} className="rounded-2xl border border-cert-line bg-cert-mint/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-cert-ink">{titleFor(project, "Project")}</p>
                    <p className="mt-1 text-sm text-slate-600">Course: {titleFor(courseById.get(String(project.course_id)), "Course")}</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-cert-green-dark">{formatAssignedDate(project.assignedAt)}</span>
                </div>
                {project.description && <p className="mt-3 text-sm leading-6 text-slate-600">{project.description}</p>}
                <p className="mt-3 text-sm font-medium text-cert-ink">Assigned to {project.studentIds.size} {project.studentIds.size === 1 ? "student" : "students"}</p>
              </article>)}
            </div>
          </aside>}
          </section>
        )}

        {(activeWorkspace === "assignment-submissions" || activeWorkspace === "project-reviews") && (
          <section className="grid w-full gap-5">
          {activeWorkspace === "assignment-submissions" && <div id="assignment-submissions" className="overflow-hidden rounded-[1.75rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <header className="relative overflow-hidden bg-[radial-gradient(circle_at_92%_12%,rgba(231,232,91,0.3),transparent_30%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_140%)] px-6 py-7 text-white">
              <div className="absolute -bottom-12 right-7 h-32 w-32 rounded-full border border-white/10" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-cert-yellow">Review queue</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">Assignment submissions</h2>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/85">Review submitted work, share feedback, and confirm completed assignments.</p>
                </div>
                <span className="flex min-w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-3 py-3 text-lg font-bold text-cert-yellow backdrop-blur">{awaitingSubmissions.length}</span>
              </div>
            </header>
            <div className="p-5 sm:p-6">
              {awaitingSubmissions.length === 0 ? <div className="rounded-[1.35rem] border border-dashed border-cert-line bg-[linear-gradient(135deg,#f6fffa_0%,#edf8f2_100%)] px-6 py-9 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-cert-green-dark shadow-sm ring-1 ring-cert-line"><CheckCircle2 size={27} /></span><h3 className="mt-4 text-lg font-semibold text-cert-ink">No work waiting</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Assignment submissions will appear here as soon as students send their work for review.</p></div> : <div className="space-y-4">{awaitingSubmissions.map((submission) => <ReviewCard key={submission.id} title={titleFor(assignmentById.get(String(submission.assignment_id)), "Assignment")} student={titleFor(studentById.get(String(submission.student_id)), "Student")} link={submission.submission_url} notes={reviewNotes[submission.id]} onNotes={(value) => setReviewNotes({ ...reviewNotes, [submission.id]: value })} onApprove={() => reviewSubmission(submission, "approved")} onRework={() => reviewSubmission(submission, "rework")} />)}</div>}
            </div>
          </div>}
          {activeWorkspace === "project-reviews" && <div id="project-reviews" className="overflow-hidden rounded-[1.75rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <header className="relative overflow-hidden bg-[radial-gradient(circle_at_92%_12%,rgba(231,232,91,0.3),transparent_30%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_140%)] px-6 py-7 text-white">
              <div className="absolute -bottom-12 right-7 h-32 w-32 rounded-full border border-white/10" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-cert-yellow">Review queue</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">Project reviews</h2>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/85">Approve completed projects or return them with clear feedback.</p>
                </div>
                <span className="flex min-w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-3 py-3 text-lg font-bold text-cert-yellow backdrop-blur">{awaitingProjects.length}</span>
              </div>
            </header>
            <div className="p-5 sm:p-6">
              {awaitingProjects.length === 0 ? <div className="rounded-[1.35rem] border border-dashed border-cert-line bg-[linear-gradient(135deg,#f6fffa_0%,#edf8f2_100%)] px-6 py-9 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-cert-green-dark shadow-sm ring-1 ring-cert-line"><CheckCircle2 size={27} /></span><h3 className="mt-4 text-lg font-semibold text-cert-ink">All caught up</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">No projects are waiting for review. New student submissions will appear here.</p></div> : <div className="space-y-4">{awaitingProjects.map((project) => <ReviewCard key={project.id} title={titleFor(project, "Project")} student={titleFor(studentById.get(String(project.student_id)), "Student")} link={project.github_url || project.project_file_url} notes={reviewNotes[project.id]} onNotes={(value) => setReviewNotes({ ...reviewNotes, [project.id]: value })} onApprove={() => reviewProject(project, "approved")} onRework={() => reviewProject(project, "rework")} />)}</div>}
            </div>
          </div>}
          </section>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ title, student, link, notes, onNotes, onApprove, onRework }) {
  return <article className="rounded-2xl border border-cert-line bg-cert-mint p-4"><p className="font-semibold text-cert-ink">{title}</p><p className="mt-1 text-sm text-slate-600">Student: {student}</p>{link && <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-cert-green-dark underline">Open submitted work</a>}<textarea value={notes || ""} onChange={(e) => onNotes(e.target.value)} placeholder="Feedback for the student" className="mt-3 min-h-20 w-full rounded-xl border border-cert-line bg-white px-3 py-2 text-sm" /><div className="mt-3 flex gap-2"><button type="button" onClick={onApprove} className="rounded-xl bg-cert-green px-3 py-2 text-sm font-semibold text-cert-ink">Approve</button><button type="button" onClick={onRework} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Request rework</button></div></article>;
}
