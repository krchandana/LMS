import { useEffect, useMemo, useRef, useState } from "react";
import { Award, Bell, BookOpenCheck, CheckCircle2, Download, FolderGit2, HardDriveUpload, LogOut, Play, ShieldCheck, Sparkles, Target, Video, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { supabase } from "../../lib/supabaseClient";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const hasServiceRoleKey = Boolean(supabaseUrl && serviceRoleKey);

const statusStyles = {
  pending: "bg-amber-100 text-amber-700",
  submitted: "bg-cert-green/15 text-cert-green-dark",
  approved: "bg-cert-green/20 text-cert-green-dark",
  rejected: "bg-rose-100 text-rose-700",
  rework: "bg-rose-100 text-rose-700",
};

const emptyData = [];

const titleFor = (item, fallback = "Untitled") =>
  item?.title || item?.name || item?.course_name || item?.project_name || item?.assignment_name || item?.full_name || fallback;

const normalizeStatus = (status) => {
  const value = (status || "pending").toLowerCase();
  if (value === "rework") return "rejected";
  return value;
};

const courseVideoUrl = (course) =>
  course?.video_url || course?.course_video_url || course?.intro_video_url || course?.lesson_video_url || "";

const videoEmbedUrl = (url) => {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const isYouTube = parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtu.be");
    if (isYouTube) {
      const videoId = parsed.hostname.includes("youtu.be")
        ? parsed.pathname.slice(1)
        : parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).pop();
      return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : "";
    }

    if (parsed.hostname.includes("vimeo.com")) {
      const videoId = parsed.pathname.split("/").filter(Boolean).pop();
      return videoId ? `https://player.vimeo.com/video/${videoId}` : "";
    }
  } catch {
    return "";
  }

  return "";
};

const formatCertificateDate = (value) => {
  if (!value) return "Issued today";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(parsed);
};

const escapeCertificateText = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[character]));

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

const fetchRowsWithServiceRole = async (table, params = {}) => {
  if (!hasServiceRoleKey) return [];

  const search = new URLSearchParams({ select: "*", ...params });
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${search.toString()}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) return [];
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
};

const fetchProfilesWithServiceRole = async (ids) => {
  if (!hasServiceRoleKey || !ids.length) return [];

  const params = new URLSearchParams({
    // `profiles` stores the trainer display name in `full_name`; requesting a
    // non-existent `name` column makes PostgREST reject the complete lookup.
    select: "id,full_name,email,role",
    id: `in.(${ids.join(",")})`,
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${params.toString()}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) return [];
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
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
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [studentRecord, setStudentRecord] = useState(null);
  const [courses, setCourses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [submissionTask, setSubmissionTask] = useState(null);
  const [workFile, setWorkFile] = useState(null);
  const [workNotes, setWorkNotes] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showWorkSourcePicker, setShowWorkSourcePicker] = useState(false);
  const [activeTaskView, setActiveTaskView] = useState("assignment");
  const [activePanel, setActivePanel] = useState("courses");
  const [taskStatusFilter, setTaskStatusFilter] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const fileInputRef = useRef(null);

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

      const serviceEnrollmentRows = await fetchRowsWithServiceRole("enrollments", {
        student_id: `in.(${studentIds.join(",")})`,
      });
      const enrollmentRows = serviceEnrollmentRows.length
        ? serviceEnrollmentRows
        : await firstWorkingList("enrollments", [
            (query) => query.in("student_id", studentIds),
          ]);
      const enrolledCourseIds = [...new Set([...directCourseIds, ...enrollmentRows.map((row) => row.course_id || row.id).filter(Boolean)])];

      const serviceCourseRows = enrolledCourseIds.length
        ? await fetchRowsWithServiceRole("courses", { id: `in.(${enrolledCourseIds.join(",")})` })
        : [];
      const courseRows = serviceCourseRows.length
        ? serviceCourseRows
        : enrolledCourseIds.length
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
      const serviceTrainerRows = trainerIds.length ? await fetchProfilesWithServiceRole(trainerIds) : emptyData;
      let trainerRows = serviceTrainerRows.length
        ? serviceTrainerRows
        : trainerIds.length
          ? await firstWorkingList("profiles", [
              (query) => query.in("id", trainerIds).eq("role", "trainer"),
              (query) => query.in("id", trainerIds),
            ])
          : emptyData;

      // Some installations keep trainer records in a separate `trainers`
      // table, where the record id and profile id can differ. Fall back to
      // that mapping so students still see the trainer assigned to the course.
      if (!trainerRows.length && trainerIds.length) {
        trainerRows = await firstWorkingList("trainers", [
          (query) => query.in("id", trainerIds),
          (query) => query.in("profile_id", trainerIds),
          (query) => query.in("user_id", trainerIds),
          (query) => query.in("trainer_id", trainerIds),
        ]);
      }

      const trainerById = new Map();
      trainerRows.forEach((trainer) => {
        [trainer.id, trainer.profile_id, trainer.user_id, trainer.trainer_id]
          .filter(Boolean)
          .forEach((id) => trainerById.set(String(id), trainer));
      });
      const courseRowsWithTrainer = courseRows.map((course) => {
        const trainer = trainerById.get(String(course.trainer_id || trainerId));
        return {
          ...course,
          trainer_name: course.trainer_name || course.trainer_full_name || trainer?.full_name || trainer?.name || trainer?.email || "Unassigned",
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

  const assignmentTasks = useMemo(
    () => taskSummaries.filter((task) => task.task_type === "assignment"),
    [taskSummaries]
  );
  const projectTasks = useMemo(
    () => taskSummaries.filter((task) => task.task_type === "project"),
    [taskSummaries]
  );
  const baseTasks = activePanel === "task-status"
    ? taskSummaries
    : activeTaskView === "project" ? projectTasks : assignmentTasks;
  const visibleTasks = taskStatusFilter
    ? baseTasks.filter((task) => task.status === taskStatusFilter)
    : baseTasks;

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

  const selectedCourse = useMemo(
    () => courses.find((course) => String(course.id || course.course_id) === selectedCourseId) || courses[0] || null,
    [courses, selectedCourseId]
  );
  const selectedCourseCertificate = useMemo(() => {
    const selectedCourseKey = String(selectedCourse?.id || selectedCourse?.course_id || "");
    return certificates.find((certificate) => String(certificate.course_id || certificate.course || "") === selectedCourseKey) || null;
  }, [certificates, selectedCourse]);
  const selectedCourseVideo = courseVideoUrl(selectedCourse);
  const selectedCourseEmbed = videoEmbedUrl(selectedCourseVideo);

  const openSubmitForm = (task) => {
    setSubmissionTask(task);
    setWorkFile(null);
    setWorkNotes("");
    setSubmitError("");
    setSubmitSuccess("");
    setShowWorkSourcePicker(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const downloadCertificate = (certificate, course) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const studentName = escapeCertificateText(profile.full_name || "Student");
    const courseName = escapeCertificateText(titleFor(course, "Course"));
    const certificateNumber = escapeCertificateText(certificate.certificate_number || `CERT-${String(certificate.id || "COMPLETE").slice(-8).toUpperCase()}`);
    const issueDate = escapeCertificateText(formatCertificateDate(certificate.issue_date || certificate.created_at));

    printWindow.document.write(`<!doctype html><html><head><title>Certificate of Completion</title><style>
      @page { size: landscape; margin: 10mm; }
      * { box-sizing: border-box; } body { margin: 0; font-family: Arial, sans-serif; color: #071a2f; background: #f1fbf4; }
      .certificate { min-height: 185mm; border: 12px solid #071a2f; outline: 5px solid #31c96f; outline-offset: -22px; padding: 30mm 26mm; text-align: center; background: linear-gradient(135deg, #ffffff, #f1fbf4); }
      .brand { display: inline-flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 800; letter-spacing: .06em; }
      .shield { width: 34px; height: 34px; display: inline-grid; place-items: center; border-radius: 10px; background: #071a2f; color: #31c96f; }
      .eyebrow { margin: 26px 0 10px; color: #149b55; font-size: 13px; font-weight: 800; letter-spacing: .22em; } h1 { margin: 0; font-family: Georgia, serif; font-size: 48px; } .presented { margin: 28px 0 8px; font-size: 16px; } .name { margin: 0; font-family: Georgia, serif; font-size: 38px; font-weight: 700; } .copy { margin: 22px auto; max-width: 650px; font-size: 18px; line-height: 1.65; } .course { color: #149b55; font-weight: 800; } .footer { display: flex; justify-content: space-between; gap: 24px; margin-top: 35px; padding-top: 18px; border-top: 1px solid #b9ddc8; font-size: 13px; text-align: left; }
    </style></head><body><main class="certificate"><div class="brand"><span class="shield">✓</span> CERTISURED</div><p class="eyebrow">CERTIFICATE OF COMPLETION</p><h1>Achievement Award</h1><p class="presented">This certificate is proudly presented to</p><p class="name">${studentName}</p><p class="copy">for successfully completing all approved assignments and projects in <span class="course">${courseName}</span>.</p><div class="footer"><span>Certificate No: ${certificateNumber}</span><span>Issue date: ${issueDate}</span></div></main></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  };

  const openPanel = (panel, { taskType, status } = {}) => {
    if (taskType) setActiveTaskView(taskType);
    setTaskStatusFilter(status || "");
    setActivePanel(panel);
    window.history.replaceState(null, "", `#${panel}`);
    document.getElementById("student-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openTaskPage = (taskType) => {
    openPanel(taskType === "project" ? "projects" : "assignments", { taskType });
  };

  const submitWork = async (event) => {
    event.preventDefault();
    setSubmitError("");
    setSubmitSuccess("");

    if (!submissionTask) {
      setSubmitError("Please select a task.");
      return;
    }

    if (!workFile && !workNotes.trim()) {
      setSubmitError("Choose a completed-work file or add notes before submitting.");
      return;
    }

    setIsSubmitting(true);

    let uploadedWorkUrl = null;
    if (workFile) {
      const safeFileName = workFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const filePath = `${user?.id || profile.id}/${Date.now()}-${safeFileName}`;
      const { error: uploadError } = await supabase.storage
        .from("student-work")
        .upload(filePath, workFile, { upsert: false });

      if (uploadError) {
        setIsSubmitting(false);
        setSubmitError(uploadError.message || "Unable to upload the selected file.");
        return;
      }

      const { data: publicUrl } = supabase.storage.from("student-work").getPublicUrl(filePath);
      uploadedWorkUrl = publicUrl.publicUrl;
    }

    const isProject = submissionTask.task_type === "project";
    const payload = isProject
      ? {
          project_file_url: uploadedWorkUrl,
          review_feedback: workNotes.trim() || null,
          status: "submitted",
          submitted_at: new Date().toISOString(),
        }
      : {
          student_id: studentRecord?.id || profile.id,
          assignment_id: submissionTask.taskId,
          submission_url: uploadedWorkUrl,
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
    setWorkFile(null);
    setWorkNotes("");
    setSubmitSuccess("Work submitted successfully.");
  };

  const renderCourse = (course) => {
    const courseId = String(course.id || course.course_id || titleFor(course));
    const isSelected = String(selectedCourse?.id || selectedCourse?.course_id || titleFor(selectedCourse)) === courseId;

    return (
    <div key={courseId} className={`overflow-hidden rounded-2xl border bg-white shadow-[0_14px_40px_-30px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_48px_-30px_rgba(15,23,42,0.24)] ${isSelected ? "border-cert-green ring-2 ring-cert-green/20" : "border-slate-200"}`}>
      <div className="grid sm:grid-cols-[9.5rem_minmax(0,1fr)]">
        <div className="relative flex min-h-36 flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_78%_22%,rgba(49,201,111,0.62),transparent_30%),linear-gradient(145deg,#071a2f,#0a3d45_55%,#0b5943)] p-4 text-white">
          <span className="w-fit rounded-full bg-white/15 px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em]">Certisured</span>
          <div>
            <BookOpenCheck size={27} className="mb-2 text-[#55e49b]" aria-hidden="true" />
            <p className="text-sm font-bold leading-tight">{titleFor(course, "Course")}</p>
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-cert-green-dark">Online course</p>
              <h3 className="mt-1 text-lg font-bold text-cert-ink">{titleFor(course, "Course")}</h3>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-emerald-600">
              {course.status || "enrolled"}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
            <span>Trainer: <strong className="font-medium text-slate-700">{course.trainer_name || "Unassigned"}</strong></span>
            {course.duration && <span>Duration: <strong className="font-medium text-slate-700">{course.duration}</strong></span>}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <span className="text-xs font-medium text-slate-400">Select to open the course lesson</span>
            <button
              type="button"
              onClick={() => setSelectedCourseId(courseId)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${isSelected ? "bg-cert-green text-cert-ink" : "bg-cert-mint text-cert-green-dark hover:bg-cert-green hover:text-cert-ink"}`}
            >
              <Play size={15} fill="currentColor" aria-hidden="true" />
              {isSelected ? "Selected" : "View course"}
            </button>
          </div>
        </div>
      </div>
    </div>
    );
  };

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
    <div className="min-h-screen bg-[#f5f8fc] text-cert-ink">
      <div className="mx-auto max-w-[1440px]">
      <nav className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-white/10 lg:bg-[linear-gradient(180deg,#071a2f_0%,#063d42_62%,#0b5943_100%)] lg:p-5 lg:text-white" aria-label="Student workspace navigation">
        <div className="border-b border-white/15 pb-5">
          <div className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cert-ink text-cert-green"><ShieldCheck size={20} strokeWidth={2.7} aria-hidden="true" /></span>
            <span className="text-xl font-extrabold tracking-tight text-cert-ink">CERTISURED</span>
          </div>
          <p className="mt-2 text-[0.65rem] font-medium text-white/70">Learning Management System</p>
        </div>
        <span className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Student workspace</span>
        <div className="mt-3 flex flex-1 flex-col gap-2">
          <button type="button" onClick={() => openPanel("courses")} className={`inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${activePanel === "courses" ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/85 hover:bg-white/10"}`}>
            <span>Courses</span><span className="rounded-full bg-white px-2 py-0.5 text-cert-green-dark">{courses.length}</span>
          </button>
          <button type="button" onClick={() => openTaskPage("assignment")} className={`inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${activePanel === "assignments" ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/85 hover:bg-white/10"}`}>
            <span>Assignments</span><span className="rounded-full bg-white px-2 py-0.5 text-cert-green-dark">{assignmentTasks.length}</span>
          </button>
          <button type="button" onClick={() => openTaskPage("project")} className={`inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${activePanel === "projects" ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/85 hover:bg-white/10"}`}>
            <span>Projects</span><span className="rounded-full bg-white px-2 py-0.5 text-cert-green-dark">{projectTasks.length}</span>
          </button>
          {[
            ["Pending", stats.counts.pending || 0, "pending"],
            ["Submitted", stats.counts.submitted || 0, "submitted"],
            ["Approved", stats.counts.approved || 0, "approved"],
            ["Rejected", stats.counts.rejected || 0, "rejected"],
          ].map(([label, value, status]) => (
            <button key={label} type="button" onClick={() => openPanel("task-status", { status })} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${activePanel === "task-status" && taskStatusFilter === status ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/75 hover:bg-white/10"}`}>
              <span>{label}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-cert-green-dark">{value}</span>
            </button>
          ))}
          <button type="button" onClick={() => openPanel("certificate")} className={`inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${activePanel === "certificate" ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/85 hover:bg-white/10"}`}>
            <span>Certificate</span><span className="rounded-full bg-white px-2 py-0.5 text-cert-green-dark">{stats.eligible ? "Eligible" : "Not yet"}</span>
          </button>
          <button type="button" onClick={handleLogout} className="mt-auto inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20">
            <LogOut size={16} aria-hidden="true" />
            Logout
          </button>
        </div>
      </nav>
      <div className="space-y-6 p-4 sm:p-6 lg:ml-60 lg:p-8">
      <header className="flex items-center justify-end gap-4 rounded-2xl border border-slate-100 bg-white px-5 py-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
        <div className="flex items-center gap-3"><Bell size={19} className="hidden text-slate-500 sm:block" aria-hidden="true" /><span className="hidden text-sm font-medium text-slate-600 sm:block">{profile.full_name || "Student"}</span><span className="flex h-9 w-9 items-center justify-center rounded-full bg-cert-mint font-semibold text-cert-green-dark">{(profile.full_name || "S").charAt(0).toUpperCase()}</span></div>
      </header>
      <section className="grid gap-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-[0_16px_38px_-30px_rgba(15,23,42,0.3)] xl:grid-cols-[minmax(0,1fr)_15rem] xl:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cert-green-dark">Student dashboard</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Welcome back, {profile.full_name || "Student"}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Continue learning and achieve your goals.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-cert-mint p-3 text-center"><p className="text-2xl font-bold text-cert-green-dark">{courses.length}</p><p className="mt-1 text-[0.65rem] font-semibold text-slate-500">COURSES</p></div>
          <div className="rounded-2xl bg-[#effaf0] p-3 text-center"><p className="text-2xl font-bold text-[#2aa85d]">{taskSummaries.length}</p><p className="mt-1 text-[0.65rem] font-semibold text-slate-500">TASKS</p></div>
          <div className="rounded-2xl bg-[#fff7e9] p-3 text-center"><p className="text-2xl font-bold text-[#e59a14]">{stats.progress}%</p><p className="mt-1 text-[0.65rem] font-semibold text-slate-500">PROGRESS</p></div>
        </div>
      </section>
      <section className="hidden cert-glass-panel overflow-hidden rounded-[2.5rem] px-8 py-8 text-cert-ink shadow-[0_28px_80px_-40px_rgba(15,23,42,0.18)]">
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
              <button type="button" onClick={() => openTaskPage("assignment")} className="rounded-full bg-cert-green px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white">
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

      <section id="student-panel" className="mx-auto max-w-7xl scroll-mt-28">
        <div id="enrolled-courses" className={`grid gap-6 xl:grid-cols-[1.05fr_0.95fr] ${activePanel === "courses" ? "" : "hidden"}`}>
          <div className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <h2 className="text-xl font-semibold text-cert-ink">Enrolled Courses</h2>
            <p className="mt-2 text-sm text-slate-500">Choose a course to watch its learning video.</p>
            <div className="mt-6 space-y-4">
              {courses.length === 0 ? <div className="rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">No enrolled courses found.</div> : courses.map(renderCourse)}
            </div>
          </div>

          <aside className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]" aria-label="Course video player">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cert-green-dark">Course video</p>
                <h2 className="mt-2 text-xl font-semibold text-cert-ink">{selectedCourse ? titleFor(selectedCourse, "Course introduction") : "Course introduction"}</h2>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cert-green/15 text-cert-green-dark">
                <Video size={21} aria-hidden="true" />
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">Watch lessons alongside your course details.</p>

            <div className="mt-6 aspect-video overflow-hidden rounded-[1.5rem] bg-cert-ink shadow-inner">
              {selectedCourseEmbed ? (
                <iframe
                  className="h-full w-full"
                  src={selectedCourseEmbed}
                  title={`${titleFor(selectedCourse, "Course")} video`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : selectedCourseVideo ? (
                <video className="h-full w-full bg-cert-ink object-contain" controls preload="metadata">
                  <source src={selectedCourseVideo} />
                  Your browser does not support course videos.
                </video>
              ) : (
                <div className="flex h-full flex-col justify-between bg-[radial-gradient(circle_at_18%_12%,rgba(49,201,111,0.52),transparent_32%),linear-gradient(135deg,#06324f,#071a2f)] p-6 text-white">
                  <span className="w-fit rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]">Introduction</span>
                  <div>
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cert-green text-cert-ink shadow-lg shadow-black/20">
                      <Play size={24} fill="currentColor" aria-hidden="true" />
                    </span>
                    <p className="mt-4 text-lg font-semibold">{selectedCourse ? `Welcome to ${titleFor(selectedCourse, "your course")}` : "Select a course to begin"}</p>
                    <p className="mt-1 text-sm text-white/75">Your trainer can add the first video lesson here.</p>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-5 rounded-2xl bg-cert-mint px-4 py-3 text-sm text-slate-600">
              <span className="font-semibold text-cert-ink">Up next: </span>
              {selectedCourseVideo ? "Continue this course lesson." : "Course videos will appear here when added by your trainer."}
            </div>
          </aside>
        </div>

        <div id="student-tasks" className={`grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] ${(activePanel === "assignments" || activePanel === "projects" || activePanel === "task-status") ? "" : "hidden"}`}>
          <section className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
            <div>
              <h2 className="text-xl font-semibold text-cert-ink">{activePanel === "task-status" ? `${taskStatusFilter.charAt(0).toUpperCase()}${taskStatusFilter.slice(1)} tasks` : activeTaskView === "assignment" ? "Assignments" : "Projects"}</h2>
              <p className="mt-2 text-sm text-slate-500">Choose a task to submit your completed work.</p>
            </div>
            <div className="mt-6 space-y-4">
              {visibleTasks.length === 0 ? <div className="rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">{activeTaskView === "assignment" ? "No assignments found." : "No projects found."}</div> : visibleTasks.map(renderTask)}
            </div>
          </section>

          <aside className="h-fit rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)] xl:sticky xl:top-28">
            <h3 className="text-lg font-semibold text-cert-ink">Submit Completed Work</h3>
            <p className="mt-2 text-sm text-slate-500">Choose a file from Google Drive or your device, then add any notes for your trainer.</p>
            {submissionTask ? (
              <form onSubmit={submitWork} className="mt-5 space-y-4">
                <p className="rounded-3xl bg-cert-mint px-4 py-3 text-sm font-semibold text-cert-ink">{titleFor(submissionTask, "Selected task")}</p>
                {workFile ? (
                  <div className="flex items-center justify-between gap-3 rounded-3xl border border-cert-green/30 bg-cert-mint px-4 py-3 text-sm text-cert-ink">
                    <span className="inline-flex min-w-0 items-center gap-2 font-medium"><HardDriveUpload size={18} className="shrink-0 text-cert-green-dark" aria-hidden="true" /><span className="truncate">{workFile.name}</span></span>
                    <button type="button" onClick={() => setWorkFile(null)} className="rounded-xl p-1 text-slate-500 transition hover:bg-white hover:text-cert-ink" aria-label="Remove selected file"><X size={18} aria-hidden="true" /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowWorkSourcePicker(true)} className="flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-cert-green/50 bg-cert-mint px-4 py-4 text-sm font-semibold text-cert-green-dark transition hover:border-cert-green hover:bg-white">
                    <HardDriveUpload size={18} aria-hidden="true" /> Choose completed-work file
                  </button>
                )}
                <textarea value={workNotes} onChange={(event) => setWorkNotes(event.target.value)} placeholder="Notes" className="min-h-28 w-full rounded-3xl border border-cert-line bg-cert-mint px-4 py-3 text-sm text-cert-ink outline-none focus:border-cert-green focus:ring-2 focus:ring-cert-green/20" />
                {submitError && <p className="rounded-3xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{submitError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={isSubmitting} className="flex-1 rounded-3xl bg-cert-green px-4 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white disabled:bg-slate-400 disabled:text-white">{isSubmitting ? "Submitting..." : "Submit"}</button>
                  <button type="button" onClick={() => setSubmissionTask(null)} className="rounded-3xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Cancel</button>
                </div>
              </form>
            ) : (
              <p className="mt-4 rounded-3xl bg-cert-mint p-5 text-sm text-slate-500">Choose Submit Work on an assignment or project.</p>
            )}
            {submitSuccess && <p className="mt-4 rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{submitSuccess}</p>}
          </aside>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const [file] = event.target.files || [];
              if (file) setWorkFile(file);
              setShowWorkSourcePicker(false);
              event.target.value = "";
            }}
          />
          {showWorkSourcePicker && <div className="fixed inset-0 z-50 flex items-center justify-center bg-cert-ink/40 p-4" role="dialog" aria-modal="true" aria-labelledby="work-source-title">
            <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cert-green-dark">Completed work</p>
                  <h3 id="work-source-title" className="mt-2 text-xl font-semibold text-cert-ink">Choose a file source</h3>
                </div>
                <button type="button" onClick={() => setShowWorkSourcePicker(false)} className="rounded-xl p-2 text-slate-500 transition hover:bg-cert-mint hover:text-cert-ink" aria-label="Close file source picker"><X size={20} aria-hidden="true" /></button>
              </div>
              <div className="mt-6 grid gap-3">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-3 rounded-2xl border border-cert-line bg-cert-mint p-4 text-left transition hover:border-cert-green hover:bg-white">
                  <HardDriveUpload size={22} className="shrink-0 text-cert-green-dark" aria-hidden="true" />
                  <span><span className="block font-semibold text-cert-ink">Google Drive or device files</span><span className="mt-1 block text-sm text-slate-500">Open the system file picker to select a file, including a synced Google Drive folder.</span></span>
                </button>
                <button type="button" onClick={() => window.open("https://github.com", "_blank", "noopener,noreferrer")} className="flex items-center gap-3 rounded-2xl border border-cert-line bg-white p-4 text-left transition hover:border-cert-green hover:bg-cert-mint">
                  <FolderGit2 size={22} className="shrink-0 text-cert-ink" aria-hidden="true" />
                  <span><span className="block font-semibold text-cert-ink">Open GitHub</span><span className="mt-1 block text-sm text-slate-500">Open GitHub in a new tab to access your repository files.</span></span>
                </button>
              </div>
            </div>
          </div>}
        </div>

        <div className={activePanel === "certificate" ? "space-y-5" : "hidden"}>
          {selectedCourseCertificate ? (
            <div className="overflow-hidden rounded-[2rem] border border-cert-green/40 bg-[linear-gradient(135deg,#ffffff_0%,#f1fbf4_100%)] p-2 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.2)]">
              <div className="rounded-[1.55rem] border-[3px] border-cert-ink p-6 text-center sm:p-9">
                <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-cert-ink px-4 py-2 text-xs font-bold tracking-[0.2em] text-white">
                  <Award size={16} className="text-cert-green" aria-hidden="true" /> CERTISURED
                </div>
                <p className="mt-7 text-xs font-bold uppercase tracking-[0.28em] text-cert-green-dark">Certificate of completion</p>
                <h2 className="mt-3 font-serif text-3xl font-semibold text-cert-ink sm:text-4xl">Achievement Award</h2>
                <p className="mt-7 text-sm text-slate-500">This certificate is proudly presented to</p>
                <p className="mt-2 font-serif text-3xl font-bold text-cert-ink sm:text-4xl">{profile.full_name || "Student"}</p>
                <p className="mx-auto mt-6 max-w-xl text-sm leading-7 text-slate-600">for successfully completing all approved assignments and projects in <span className="font-bold text-cert-green-dark">{titleFor(selectedCourse, "this course")}</span>.</p>
                <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-cert-line pt-5 text-left sm:flex-row">
                  <div className="text-xs text-slate-500"><p>Certificate no.</p><p className="mt-1 font-semibold text-cert-ink">{selectedCourseCertificate.certificate_number || `CERT-${String(selectedCourseCertificate.id || "COMPLETE").slice(-8).toUpperCase()}`}</p></div>
                  <p className="text-xs text-slate-500">Issued {formatCertificateDate(selectedCourseCertificate.issue_date || selectedCourseCertificate.created_at)}</p>
                  <button type="button" onClick={() => downloadCertificate(selectedCourseCertificate, selectedCourse)} className="inline-flex items-center gap-2 rounded-xl bg-cert-green px-4 py-2.5 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white"><Download size={16} aria-hidden="true" /> Download certificate</button>
                </div>
              </div>
            </div>
          ) : (
            <div id="course-progress" className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
              <h2 className="text-xl font-semibold text-cert-ink">Certificate progress</h2>
              <p className="mt-2 text-sm text-slate-500">Your certificate is issued automatically once your trainer approves every assignment and project for the course.</p>
              <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-cert-green" style={{ width: `${stats.progress}%` }} />
              </div>
              <p className="mt-4 text-sm text-slate-500">{stats.approved} of {stats.totalTasks} required tasks approved.</p>
              <div className="mt-5 rounded-2xl bg-cert-mint px-4 py-3 text-sm text-slate-600"><p className="font-semibold text-cert-ink">Almost there</p><p className="mt-1">After the remaining work is approved, the certificate will appear here to download.</p></div>
            </div>
          )}
        </div>
      </section>
      </div>
    </div>
    </div>
  );
}
