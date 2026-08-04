import { useEffect, useMemo, useRef, useState } from "react";
import { Award, Bell, CheckCircle2, Download, FolderGit2, HardDriveUpload, LogOut, Play, ShieldCheck, Sparkles, Target, Video, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
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
  inactive: "bg-slate-200 text-slate-600",
};

const emptyData = [];
const certificateCompanyName = "CERTISURED LEARNING MANAGEMENT SYSTEM";

const titleFor = (item, fallback = "Untitled") =>
  item?.title || item?.name || item?.course_name || item?.project_name || item?.assignment_name || item?.full_name || fallback;

const currentDate = new Date().toISOString().slice(0, 10);
const taskEndDate = (task) => task?.end_date || task?.due_date || "";
const taskIsPastEndDate = (task) => Boolean(taskEndDate(task) && taskEndDate(task) < currentDate);

// Trainers can enter a brief or a fully structured brief.  Keep the latter
// readable for students by recognizing the labels used in the task builder.
const instructionLabels = "Objective|Dataset(?:\\s+(?:Columns|Requirements))?|Requirements?|Tasks?|Expected Output|Deliverables?|Steps?|Code";
const instructionHeadingPattern = new RegExp(`(?:^|\\n\\n)(${instructionLabels}):\\s*`, "gi");

const formatTaskDescription = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .replace(new RegExp(`\\s*(${instructionLabels})\\s*:?\\s*`, "gi"), (_, label, offset) => `${offset ? "\\n\\n" : ""}${label.replace(/\\b\\w/g, (letter) => letter.toUpperCase())}: `)
    .replace(/\\s+(\\d+[.)])\\s+/g, "\\n$1 ")
    .trim();
};

const taskInstructionSections = (description) => {
  const formatted = formatTaskDescription(description);
  if (!formatted) return [];

  const headings = [...formatted.matchAll(instructionHeadingPattern)];
  if (!headings.length) return [{ label: "Instructions", content: formatted }];

  return headings.map((heading, index) => ({
    label: heading[1],
    content: formatted.slice((heading.index || 0) + heading[0].length, index + 1 < headings.length ? headings[index + 1].index : undefined).trim(),
  })).filter((section) => section.content);
};

const TaskInstructions = ({ description }) => {
  const sections = taskInstructionSections(description);
  if (!sections.length) return null;

  return (
    <div className="mt-4 space-y-3">
      {sections.map((section) => {
        const steps = section.label.toLowerCase().startsWith("task") || section.label.toLowerCase().startsWith("step")
          ? section.content.split(/(?:^|\n)(?:\d+[.)]|[-•])\s+/).filter(Boolean)
          : [];

        return (
          <section key={section.label} className="rounded-xl border border-cert-line bg-cert-mint/60 p-3.5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-cert-green-dark">{section.label}</p>
            {steps.length > 1
              ? <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-slate-600">{steps.map((step, index) => <li key={`${section.label}-${index}`}>{step}</li>)}</ol>
              : <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{section.content}</p>}
          </section>
        );
      })}
    </div>
  );
};

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

const formatAttendanceDate = (value) => {
  if (!value) return "Date unavailable";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
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

const updateSubmissionForResubmission = async (submissionId, payload) => {
  const { data, error } = await supabase.from("submissions").update(payload).eq("id", submissionId).select();
  const updatedSubmission = Array.isArray(data) ? data[0] : data;
  if (!error && updatedSubmission) return { data: updatedSubmission, error: null };

  if (!hasServiceRoleKey) {
    return { data: null, error: error || { message: "Unable to find the previous submission to update." } };
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/submissions?id=eq.${encodeURIComponent(submissionId)}`, {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });
    const responseData = await response.json().catch(() => null);
    const serviceSubmission = Array.isArray(responseData) ? responseData[0] : responseData;
    return response.ok && serviceSubmission
      ? { data: serviceSubmission, error: null }
      : { data: null, error: { message: responseData?.message || error?.message || "Unable to update the previous submission." } };
  } catch {
    return { data: null, error: error || { message: "Unable to update the previous submission." } };
  }
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
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [studentRecord, setStudentRecord] = useState(null);
  const [courses, setCourses] = useState([]);
  const [courseVideos, setCourseVideos] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [submissionTask, setSubmissionTask] = useState(null);
  const [workFiles, setWorkFiles] = useState([]);
  const [workSource, setWorkSource] = useState("");
  const [workNotes, setWorkNotes] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showWorkSourcePicker, setShowWorkSourcePicker] = useState(false);
  const [activeTaskView, setActiveTaskView] = useState("assignment");
  const [activePanel, setActivePanel] = useState("courses");
  const [taskStatusFilter, setTaskStatusFilter] = useState("");
  const [taskCourseFilter, setTaskCourseFilter] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedAttendanceCourseId, setSelectedAttendanceCourseId] = useState("");
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const fileInputRef = useRef(null);
  const driveFolderInputRef = useRef(null);
  const githubFolderInputRef = useRef(null);
  const openedSubmissionLinkRef = useRef("");
  const studentName = profile?.full_name || profile?.name || user?.user_metadata?.full_name || "Student";

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
      const studentIds = [...new Set([
        student.id,
        student.profile_id,
        student.user_id,
        student.student_id,
        student.student_login_id,
        profile.id,
        profile.profile_id,
        profile.user_id,
        profile.student_id,
        profile.student_login_id,
      ].filter(Boolean))];
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
          : emptyData;

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
      const courseVideoRows = courseIds.length
        ? await firstWorkingList("course_videos", [
            (query) => query.in("course_id", courseIds).order("available_at", { ascending: false }),
            (query) => query.in("course_id", courseIds).order("created_at", { ascending: false }),
          ])
        : emptyData;
      const serviceProjectRows = courseIds.length
        ? await fetchRowsWithServiceRole("projects", { course_id: `in.(${courseIds.join(",")})` })
        : emptyData;
      const [studentProjectRows, courseProjectRows] = await Promise.all([
        firstWorkingList("projects", [
          (query) => query.in("student_id", studentIds),
          (query) => query.in("profile_id", studentIds),
        ]),
        courseIds.length
          ? firstWorkingList("projects", [(query) => query.in("course_id", courseIds)])
          : Promise.resolve(emptyData),
      ]);
      const studentIdKeys = new Set(studentIds.map(String));
      const courseIdKeys = new Set(courseIds.map(String));
      const projectRows = (serviceProjectRows.length ? serviceProjectRows : [...studentProjectRows, ...courseProjectRows])
        .filter((project) => {
          const projectCourseId = project.course_id || project.course;
          const projectStudentId = project.student_id || project.profile_id;
          return courseIdKeys.has(String(projectCourseId)) && studentIdKeys.has(String(projectStudentId));
        })
        .filter((project, index, rows) => rows.findIndex((row) => String(row.id) === String(project.id)) === index);
      const serviceAssignmentRows = courseIds.length
        ? await fetchRowsWithServiceRole("assignments", { course_id: `in.(${courseIds.join(",")})` })
        : emptyData;
      const [studentAssignmentRows, courseAssignmentRows] = await Promise.all([
        firstWorkingList("assignments", [
          (query) => query.in("student_id", studentIds),
          (query) => query.in("profile_id", studentIds),
        ]),
        courseIds.length
          ? firstWorkingList("assignments", [(query) => query.in("course_id", courseIds)])
          : Promise.resolve(emptyData),
      ]);
      const assignmentRows = (serviceAssignmentRows.length ? serviceAssignmentRows : [...studentAssignmentRows, ...courseAssignmentRows])
        .filter((assignment) => {
          const assignmentCourseId = assignment.course_id || assignment.course;
          const assignmentStudentId = assignment.student_id || assignment.profile_id;
          return courseIdKeys.has(String(assignmentCourseId))
            && (!assignmentStudentId || studentIdKeys.has(String(assignmentStudentId)));
        })
        .filter((assignment, index, rows) => rows.findIndex((row) => String(row.id) === String(assignment.id)) === index);
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
      const serviceAttendanceRows = courseIds.length
        ? await fetchRowsWithServiceRole("attendance", { student_id: `in.(${studentIds.join(",")})` })
        : emptyData;
      const directAttendanceRows = serviceAttendanceRows.length
        ? serviceAttendanceRows
        : await firstWorkingList("attendance", [
            (query) => query.in("student_id", studentIds).in("course_id", courseIds),
          ]);
      const attendanceRows = directAttendanceRows.filter((record) =>
        studentIdKeys.has(String(record.student_id)) && courseIdKeys.has(String(record.course_id))
      );

      setStudentRecord(student);
      setCourses(courseRowsWithTrainer);
      setCourseVideos(courseVideoRows);
      setTasks(taskRows);
      setSubmissions(submissionRows);
      setCertificates(certificateRows);
      setAttendanceRecords(attendanceRows);
      setLoading(false);
    };

    loadDashboard();
  }, [profile, user, dashboardRefreshKey]);

  useEffect(() => {
    if (!profile?.id) return undefined;

    const channel = supabase
      .channel(`student-certificates-${profile.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "certificates", filter: `student_id=eq.${profile.id}` }, () => {
        setDashboardRefreshKey((value) => value + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  const taskSummaries = useMemo(() => {
    const submissionByTask = new Map();
    submissions.forEach((submission) => {
      const taskId = submission.assignment_id || submission.project_id || submission.task_id;
      if (taskId) submissionByTask.set(taskId, submission);
    });

    return tasks.map((task) => {
      const taskId = task.id || task.assignment_id || task.project_id;
      const submission = task.task_type === "project" ? task : submissionByTask.get(taskId);
      const rawStatus = normalizeStatus(submission?.status || task.status || "pending");
      const status = taskIsPastEndDate(task) && !["submitted", "approved"].includes(rawStatus) ? "inactive" : rawStatus;
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
  const courseScopedTasks = taskCourseFilter
    ? baseTasks.filter((task) => String(task.course_id || task.course || "") === taskCourseFilter)
    : baseTasks;
  const visibleTasks = taskStatusFilter
    ? courseScopedTasks.filter((task) => task.status === taskStatusFilter)
    : courseScopedTasks;
  const courseById = useMemo(
    () => new Map(courses.map((course) => [String(course.id || course.course_id), course])),
    [courses]
  );

  const taskStats = useMemo(() => {
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
  const courseStats = useMemo(() => {
    const selectedCourseKey = String(selectedCourse?.id || selectedCourse?.course_id || "");
    const courseTasks = taskSummaries.filter((task) => String(task.course_id || task.course || "") === selectedCourseKey);
    const counts = courseTasks.reduce(
      (acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      },
      { pending: 0, submitted: 0, approved: 0, rejected: 0 }
    );
    const approved = counts.approved || 0;
    const totalTasks = courseTasks.length;
    return {
      totalTasks,
      counts,
      approved,
      progress: totalTasks ? Math.round((approved / totalTasks) * 100) : 0,
      eligible: totalTasks > 0 && approved === totalTasks,
    };
  }, [selectedCourse, taskSummaries]);
  const attendanceByCourse = useMemo(() => {
    const stats = new Map();
    courses.forEach((course) => {
      const courseId = String(course.id || course.course_id || "");
      const records = attendanceRecords.filter((record) => String(record.course_id) === courseId);
      const present = records.filter((record) => record.status === "present").length;
      stats.set(courseId, { total: records.length, present, percentage: records.length ? Math.round((present / records.length) * 100) : 0 });
    });
    return stats;
  }, [attendanceRecords, courses]);
  const selectedAttendanceCourse = useMemo(
    () => courses.find((course) => String(course.id || course.course_id) === selectedAttendanceCourseId) || null,
    [courses, selectedAttendanceCourseId]
  );
  const selectedAttendanceRecords = useMemo(() => attendanceRecords
    .filter((record) => String(record.course_id) === selectedAttendanceCourseId)
    .sort((first, second) => String(second.attendance_date || "").localeCompare(String(first.attendance_date || ""))),
    [attendanceRecords, selectedAttendanceCourseId]);
  const issuedCertificates = useMemo(() => {
    const seen = new Set();
    return certificates
      .filter((certificate) => {
        const key = `${certificate.student_id || certificate.profile_id || "unknown"}-${certificate.course_id || certificate.course || "unknown"}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((certificate) => {
        const certificateCourseId = String(certificate.course_id || certificate.course || "");
        const course = courses.find((item) => String(item.id || item.course_id || "") === certificateCourseId) || null;
        return { certificate, course };
      });
  }, [certificates, courses]);
  const selectedCourseVideoRecord = useMemo(() => {
    const selectedCourseKey = String(selectedCourse?.id || selectedCourse?.course_id || "");
    const now = Date.now();
    return courseVideos
      .filter((video) => {
        const isForSelectedCourse = String(video.course_id) === selectedCourseKey;
        const availableAt = video.available_at ? new Date(video.available_at).getTime() : 0;
        return isForSelectedCourse && !Number.isNaN(availableAt) && availableAt <= now;
      })
      .sort((first, second) => String(second.available_at || second.created_at || "").localeCompare(String(first.available_at || first.created_at || "")))[0] || null;
  }, [courseVideos, selectedCourse]);
  const selectedCourseVideo = selectedCourseVideoRecord?.video_url || courseVideoUrl(selectedCourse);
  const selectedCourseEmbed = videoEmbedUrl(selectedCourseVideo);

  const openSubmitForm = (task) => {
    if (task.status === "submitted") {
      setSubmitError("This work has already been submitted and is waiting for review.");
      return;
    }
    if (task.status === "approved") {
      setSubmitError("This work has already been approved.");
      return;
    }
    if (task.status === "inactive" || taskIsPastEndDate(task)) {
      setSubmitError(`This ${task.task_type || "task"} became inactive after ${taskEndDate(task)}.`);
      return;
    }
    setSubmissionTask(task);
    setWorkFiles([]);
    setWorkSource("");
    setWorkNotes("");
    setSubmitError("");
    setSubmitSuccess("");
    setShowWorkSourcePicker(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const workType = params.get("workType");
    const courseId = params.get("courseId");
    const workTitle = params.get("workTitle");
    const assignedDate = params.get("assignedDate");
    const endDate = params.get("endDate");
    if (!workType || !courseId || !workTitle || !assignedDate || !endDate) return;
    const linkKey = location.search;
    if (openedSubmissionLinkRef.current === linkKey) return;

    const task = taskSummaries.find((item) =>
      item.task_type === workType
      && String(item.course_id || item.course || "") === courseId
      && titleFor(item, "") === workTitle
      && String(item.assigned_date || "").slice(0, 10) === assignedDate
      && String(taskEndDate(item) || "").slice(0, 10) === endDate
    );
    if (!task) return;

    openedSubmissionLinkRef.current = linkKey;
    const openTimer = window.setTimeout(() => {
      setActiveTaskView(workType);
      setActivePanel(workType === "project" ? "projects" : "assignments");
      setTaskCourseFilter(courseId);
      openSubmitForm(task);
      document.getElementById("student-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    return () => window.clearTimeout(openTimer);
  }, [location.search, taskSummaries]);

  const selectWorkFiles = (files, source) => {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    setWorkFiles(selectedFiles);
    setWorkSource(source);
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
    const courseDuration = escapeCertificateText(course?.duration || "Duration not specified");
    const certificateNumber = escapeCertificateText(certificate.certificate_number || `CERT-${String(certificate.id || "COMPLETE").slice(-8).toUpperCase()}`);
    const issueDate = escapeCertificateText(formatCertificateDate(certificate.issue_date || certificate.created_at));

    printWindow.document.write(`<!doctype html><html><head><title>Certificate of Completion</title><style>
      @page { size: landscape; margin: 10mm; }
      * { box-sizing: border-box; } body { margin: 0; font-family: Arial, sans-serif; color: #071a2f; background: #f1fbf4; }
      .certificate { min-height: 185mm; border: 12px solid #071a2f; outline: 5px solid #31c96f; outline-offset: -22px; padding: 30mm 26mm; text-align: center; background: linear-gradient(135deg, #ffffff, #f1fbf4); }
      .brand { display: inline-flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 800; letter-spacing: .06em; }
      .shield { width: 34px; height: 34px; display: inline-grid; place-items: center; border-radius: 10px; background: #071a2f; color: #31c96f; }
      .eyebrow { margin: 26px 0 10px; color: #149b55; font-size: 13px; font-weight: 800; letter-spacing: .22em; } h1 { margin: 0; font-family: Georgia, serif; font-size: 48px; } .presented { margin: 28px 0 8px; font-size: 16px; } .name { margin: 0; font-family: Georgia, serif; font-size: 38px; font-weight: 700; } .copy { margin: 22px auto; max-width: 650px; font-size: 18px; line-height: 1.65; } .course { color: #149b55; font-weight: 800; } .footer { display: flex; justify-content: space-between; gap: 24px; margin-top: 35px; padding-top: 18px; border-top: 1px solid #b9ddc8; font-size: 13px; text-align: left; }
    </style></head><body><main class="certificate"><div class="brand"><span class="shield">✓</span> CERTISURED</div><p style="margin:7px 0 0;font-size:11px;font-weight:700;letter-spacing:.14em;color:#526375">${certificateCompanyName}</p><p class="eyebrow">CERTIFICATE OF COMPLETION</p><h1>Achievement Award</h1><p class="presented">This certificate is proudly presented to</p><p class="name">${studentName}</p><p class="copy">for successfully completing all approved assignments and projects in <span class="course">${courseName}</span>.</p><p style="display:inline-block;margin:0;padding:7px 12px;border-radius:999px;background:#e9f8ef;color:#087b43;font-size:13px;font-weight:700">Course duration: ${courseDuration}</p><div class="footer"><span>Certificate No: ${certificateNumber}</span><span>Issue date: ${issueDate}</span></div></main></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  };

  const openPanel = (panel, { taskType, status } = {}) => {
    if (taskType) setActiveTaskView(taskType);
    setTaskStatusFilter(status || "");
    setActivePanel(panel);
    if (panel === "assignments" || panel === "projects" || panel === "task-status") {
      setDashboardRefreshKey((current) => current + 1);
    }
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

    if (submissionTask.status === "inactive" || taskIsPastEndDate(submissionTask)) {
      setSubmitError(`This ${submissionTask.task_type || "task"} became inactive after ${taskEndDate(submissionTask)} and can no longer be submitted.`);
      return;
    }

    if (!workFiles.length && !workNotes.trim()) {
      setSubmitError("Choose a completed-work file or add notes before submitting.");
      return;
    }

    setIsSubmitting(true);

    let uploadedWorkUrl = null;
    if (workFiles.length) {
      const uploadFolder = `${user?.id || profile.id}/${Date.now()}`;
      const uploadedFiles = [];

      for (const workFile of workFiles) {
        const relativePath = (workFile.webkitRelativePath || workFile.name)
          .split("/")
          .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "-") || "file")
          .join("/");
        const filePath = `${uploadFolder}/${relativePath}`;
        const { error: uploadError } = await supabase.storage
          .from("student-work")
          .upload(filePath, workFile, { upsert: false });

        if (uploadError) {
          setIsSubmitting(false);
          setSubmitError(uploadError.message || "Unable to upload the selected file.");
          return;
        }

        const { data: publicUrl } = supabase.storage.from("student-work").getPublicUrl(filePath);
        uploadedFiles.push({ name: workFile.webkitRelativePath || workFile.name, url: publicUrl.publicUrl });
      }

      if (uploadedFiles.length === 1) {
        uploadedWorkUrl = uploadedFiles[0].url;
      } else {
        const fileLinks = uploadedFiles
          .map(({ name, url }) => `<li><a href="${url}">${name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</a></li>`)
          .join("");
        const packageFile = new Blob([`<!doctype html><title>Submitted work</title><h1>Submitted work</h1><p>${workSource || "Selected folder"}</p><ul>${fileLinks}</ul>`], { type: "text/html" });
        const packagePath = `${uploadFolder}/submission-files.html`;
        const { error: packageError } = await supabase.storage.from("student-work").upload(packagePath, packageFile, { contentType: "text/html", upsert: false });
        if (packageError) {
          setIsSubmitting(false);
          setSubmitError(packageError.message || "Unable to create the submitted-work package.");
          return;
        }
        const { data: packageUrl } = supabase.storage.from("student-work").getPublicUrl(packagePath);
        uploadedWorkUrl = packageUrl.publicUrl;
      }
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

    const previousSubmission = isProject
      ? null
      : submissionTask.submission || submissions.find((submission) => String(submission.assignment_id) === String(submissionTask.taskId));
    const result = isProject
      ? await supabase.from("projects").update(payload).eq("id", submissionTask.taskId).select().single()
      : previousSubmission?.id
        ? await updateSubmissionForResubmission(previousSubmission.id, payload)
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
      setSubmissions((prev) => previousSubmission?.id
        ? prev.map((submission) => (submission.id === previousSubmission.id ? { ...submission, ...data } : submission))
        : [data, ...prev]);
    }
    setSubmissionTask(null);
    setWorkFiles([]);
    setWorkSource("");
    setWorkNotes("");
    setSubmitSuccess(previousSubmission?.id ? "Revision submitted successfully." : "Work submitted successfully.");
  };

  const renderCourse = (course) => {
    const courseId = String(course.id || course.course_id || titleFor(course));
    const isSelected = String(selectedCourse?.id || selectedCourse?.course_id || titleFor(selectedCourse)) === courseId;

    return (
    <div key={courseId} className={`overflow-hidden rounded-2xl border bg-white shadow-[0_14px_40px_-30px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_48px_-30px_rgba(15,23,42,0.24)] ${isSelected ? "border-cert-green ring-2 ring-cert-green/20" : "border-slate-200"}`}>
      <div className="grid sm:grid-cols-[9.5rem_minmax(0,1fr)]">
        <div className="relative flex min-h-36 flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_78%_22%,rgba(49,201,111,0.62),transparent_30%),linear-gradient(145deg,#071a2f,#0a3d45_55%,#0b5943)] p-4 text-white">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2 py-1 text-[0.6rem] font-bold uppercase tracking-[0.13em] text-white/95" aria-label="Certisured">
            <span className="flex h-4 w-4 items-center justify-center rounded-md bg-cert-green text-cert-ink"><ShieldCheck size={11} strokeWidth={3} aria-hidden="true" /></span>
            Certisured
          </span>
          <div>
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

  const renderTask = (task) => {
    const isSubmitted = task.status === "submitted";
    const isApproved = task.status === "approved";
    const isInactive = task.status === "inactive";
    const canSubmit = !isSubmitted && !isApproved && !isInactive;
    const course = courseById.get(String(task.course_id || task.course || ""));
    return (
      <article key={`${task.task_type}-${task.taskId || titleFor(task)}`} className="group relative overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white shadow-[0_14px_34px_-30px_rgba(7,26,47,0.35)] transition duration-200 hover:-translate-y-0.5 hover:border-cert-green/50 hover:shadow-[0_18px_40px_-28px_rgba(7,26,47,0.32)]">
        <div className={`absolute inset-y-0 left-0 w-1 ${isApproved ? "bg-emerald-500" : isSubmitted ? "bg-sky-400" : isInactive ? "bg-slate-400" : "bg-cert-green"}`} />
        <div className="p-5 pl-6">
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isApproved ? "bg-emerald-50 text-emerald-600" : isSubmitted ? "bg-sky-50 text-sky-600" : isInactive ? "bg-slate-100 text-slate-500" : "bg-cert-mint text-cert-green-dark"}`}><Target size={19} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold leading-6 text-cert-ink">{titleFor(task, "Task")}</h3><p className="mt-1 text-xs font-medium text-slate-500">{titleFor(course, "Course")}</p></div><span className={`rounded-full px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.14em] ${statusStyles[task.status] || (task.status === "active" ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-700")}`}>{task.status === "active" ? "To do" : task.status}</span></div></div>
          </div>
          {task.description && <TaskInstructions description={task.description} />}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><p className="text-xs font-medium text-slate-500">{task.assigned_date && <>Assigned <span className="font-semibold text-cert-ink">{task.assigned_date}</span> · </>}{taskEndDate(task) ? <>Ends <span className="font-semibold text-cert-ink">{taskEndDate(task)}</span></> : "No end date"}</p>{canSubmit && <button type="button" onClick={() => openSubmitForm(task)} className="rounded-xl bg-cert-green px-4 py-2 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white">{task.status === "rejected" ? "Submit revision" : "Submit work"}</button>}{isInactive && <p className="text-xs font-semibold text-slate-600">Inactive after end date</p>}{isSubmitted && <p className="text-xs font-semibold text-sky-700">Waiting for review</p>}{isApproved && <p className="text-xs font-semibold text-emerald-700">Completed</p>}</div>
        </div>
      </article>
    );
  };

  if (!profile) return <div className="p-6 text-slate-700">Loading student profile...</div>;

  if (loading) {
    return (
      <div className="cert-bg-student flex min-h-[calc(100vh-96px)] items-center justify-center px-4">
        <div className="relative w-full max-w-xl overflow-hidden rounded-[2.5rem] border border-white/80 bg-white px-8 py-10 text-center shadow-[0_32px_90px_-42px_rgba(15,23,42,0.34)] sm:px-12 sm:py-12">
          <div className="absolute -left-16 -top-16 h-40 w-40 rounded-full bg-cert-green/15 blur-2xl" />
          <div className="absolute -bottom-20 -right-12 h-44 w-44 rounded-full bg-sky-100/80 blur-2xl" />
          <div className="relative">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-cert-navy text-cert-yellow shadow-lg shadow-cert-navy/20"><ShieldCheck size={31} aria-hidden="true" /></span>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.26em] text-cert-green-dark">Student workspace</p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-cert-ink sm:text-4xl">Welcome, {studentName}!</p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">We are opening your courses, trainer details, and course work.</p>
            <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-cert-line bg-cert-mint/70 p-4 text-left">
              <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.14em] text-cert-green-dark"><span>Preparing your learning space</span><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cert-green" /></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full w-2/3 animate-pulse rounded-full bg-[linear-gradient(90deg,#0c8a58,#31c96f,#e7e85b)]" /></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-cert-ink">
      <div className="w-full">
      <nav className="sticky top-0 z-30 flex gap-2 overflow-x-auto border-b border-cert-line bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:hidden" aria-label="Student workspace navigation">
        <button type="button" onClick={() => openPanel("courses")} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${activePanel === "courses" ? "bg-cert-green text-cert-ink" : "bg-cert-mint text-cert-ink"}`}>Courses</button>
        <button type="button" onClick={() => openTaskPage("assignment")} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${activePanel === "assignments" ? "bg-cert-green text-cert-ink" : "bg-cert-mint text-cert-ink"}`}>Assignments</button>
        <button type="button" onClick={() => openTaskPage("project")} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${activePanel === "projects" ? "bg-cert-green text-cert-ink" : "bg-cert-mint text-cert-ink"}`}>Projects</button>
        <button type="button" onClick={() => openPanel("attendance")} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${activePanel === "attendance" ? "bg-cert-green text-cert-ink" : "bg-cert-mint text-cert-ink"}`}>Attendance</button>
        {[['Pending', 'pending'], ['Submitted', 'submitted'], ['Approved', 'approved'], ['Rejected', 'rejected']].map(([label, status]) => (
          <button key={status} type="button" onClick={() => openPanel("task-status", { status })} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${activePanel === "task-status" && taskStatusFilter === status ? "bg-cert-green text-cert-ink" : "bg-cert-mint text-cert-ink"}`}>{label}</button>
        ))}
        <button type="button" onClick={() => openPanel("certificate")} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${activePanel === "certificate" ? "bg-cert-green text-cert-ink" : "bg-cert-mint text-cert-ink"}`}>Certificate</button>
        <button type="button" onClick={handleLogout} className="shrink-0 rounded-xl bg-cert-navy px-3 py-2 text-sm font-semibold text-white">Logout</button>
      </nav>
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
            <span>Courses</span>
          </button>
          <button type="button" onClick={() => openTaskPage("assignment")} className={`inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${activePanel === "assignments" ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/85 hover:bg-white/10"}`}>
            <span>Assignments</span>
          </button>
          <button type="button" onClick={() => openTaskPage("project")} className={`inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${activePanel === "projects" ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/85 hover:bg-white/10"}`}>
            <span>Projects</span>
          </button>
          <button type="button" onClick={() => openPanel("attendance")} className={`inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${activePanel === "attendance" ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/85 hover:bg-white/10"}`}>
            <span>Attendance</span>
          </button>
          {[
            ["Pending", "pending"],
            ["Submitted", "submitted"],
            ["Approved", "approved"],
            ["Rejected", "rejected"],
          ].map(([label, status]) => (
            <button key={label} type="button" onClick={() => openPanel("task-status", { status })} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${activePanel === "task-status" && taskStatusFilter === status ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/75 hover:bg-white/10"}`}>
              <span>{label}</span>
            </button>
          ))}
          <button type="button" onClick={() => openPanel("certificate")} className={`inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${activePanel === "certificate" ? "bg-cert-green text-cert-ink shadow-lg shadow-cert-ink/25" : "text-white/85 hover:bg-white/10"}`}>
            <span>Certificate</span><span className="rounded-full bg-white px-2 py-0.5 text-cert-green-dark">{courseStats.eligible ? "Eligible" : "Not yet"}</span>
          </button>
          <button type="button" onClick={handleLogout} className="mt-auto inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20">
            <LogOut size={16} aria-hidden="true" />
            Logout
          </button>
        </div>
      </nav>
      <div className="space-y-6 p-4 sm:p-6 lg:ml-60 lg:p-8">
      {activePanel === "courses" && <header className="flex items-center justify-end gap-4 rounded-2xl border border-slate-100 bg-white px-5 py-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
        <div className="flex items-center gap-3"><Bell size={19} className="hidden text-slate-500 sm:block" aria-hidden="true" /><span className="hidden text-sm font-medium text-slate-600 sm:block">{profile.full_name || "Student"}</span><span className="flex h-9 w-9 items-center justify-center rounded-full bg-cert-mint font-semibold text-cert-green-dark">{(profile.full_name || "S").charAt(0).toUpperCase()}</span></div>
      </header>}
      {activePanel === "courses" && <section className="grid gap-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-[0_16px_38px_-30px_rgba(15,23,42,0.3)] xl:grid-cols-[minmax(0,1fr)_15rem] xl:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cert-green-dark">Student dashboard</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Welcome back, {profile.full_name || "Student"}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Continue learning and achieve your goals.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-cert-mint p-3 text-center"><p className="text-2xl font-bold text-cert-green-dark">{courses.length}</p><p className="mt-1 text-[0.65rem] font-semibold text-slate-500">COURSES</p></div>
          <div className="rounded-2xl bg-[#effaf0] p-3 text-center"><p className="text-2xl font-bold text-[#2aa85d]">{courseStats.totalTasks}</p><p className="mt-1 text-[0.65rem] font-semibold text-slate-500">COURSE TASKS</p></div>
          <div className="rounded-2xl bg-[#fff7e9] p-3 text-center"><p className="text-2xl font-bold text-[#e59a14]">{courseStats.progress}%</p><p className="mt-1 text-[0.65rem] font-semibold text-slate-500">PROGRESS</p></div>
        </div>
      </section>}
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
              <p className="mt-3 text-3xl font-semibold text-cert-ink">{courseStats.progress}%</p>
              <p className="mt-2 text-sm text-slate-600">Live progress based on approved tasks.</p>
            </div>
            <div className="rounded-[1.5rem] bg-white p-4 ring-1 ring-cert-line">
              <p className="text-xs uppercase tracking-[0.28em] text-cert-green-dark">Readiness</p>
              <p className="mt-3 text-lg font-semibold text-cert-ink">{courseStats.eligible ? "Certificate eligible" : "In progress"}</p>
              <p className="mt-2 text-sm text-slate-600">{courseStats.approved} approved out of {courseStats.totalTasks} tasks.</p>
            </div>
            <div className="sm:col-span-2 xl:col-span-1 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <p className="mt-3 text-sm font-semibold text-cert-ink">Courses</p>
                <p className="mt-1 text-sm text-slate-500">{courses.length} active view</p>
              </div>
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <Target size={18} className="text-cert-green-dark" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-cert-ink">Tasks</p>
                <p className="mt-1 text-sm text-slate-500">{courseStats.totalTasks} in this course</p>
              </div>
              <div className="rounded-[1.25rem] bg-white p-4 ring-1 ring-cert-line">
                <CheckCircle2 size={18} className="text-cert-green-dark" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-cert-ink">Submitted</p>
                <p className="mt-1 text-sm text-slate-500">{courseStats.counts.submitted || 0} pending review</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="student-panel" className="w-full scroll-mt-28">
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
                <h2 className="mt-2 text-xl font-semibold text-cert-ink">{selectedCourseVideoRecord?.title || (selectedCourse ? titleFor(selectedCourse, "Course introduction") : "Course introduction")}</h2>
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
                  title={selectedCourseVideoRecord?.title || `${titleFor(selectedCourse, "Course")} video`}
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

        <div id="student-tasks" className={`grid gap-6 ${activePanel === "task-status" && taskStatusFilter === "approved" ? "" : "xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]"} ${(activePanel === "assignments" || activePanel === "projects" || activePanel === "task-status") ? "" : "hidden"}`}>
          <section className="overflow-hidden rounded-[2rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.15)]">
            <header className="border-b border-cert-line bg-[linear-gradient(135deg,#ffffff_0%,#f2fcf6_100%)] px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cert-green/15 text-cert-green-dark"><Target size={22} aria-hidden="true" /></span><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.18em] text-cert-green-dark">Course work</p><h2 className="mt-1 text-2xl font-semibold text-cert-ink">{activePanel === "task-status" ? `${taskStatusFilter.charAt(0).toUpperCase()}${taskStatusFilter.slice(1)} tasks` : activeTaskView === "assignment" ? "Assignments" : "Projects"}</h2></div></div><div className="flex w-full items-end gap-3 sm:w-auto"><label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-slate-500 sm:flex-none"><span>Show course</span><select value={taskCourseFilter} onChange={(event) => setTaskCourseFilter(event.target.value)} className="w-full rounded-xl border border-cert-line bg-white px-3 py-2 text-sm font-semibold text-cert-ink outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15 sm:min-w-40"><option value="">All courses</option>{courses.map((course) => <option key={course.id || course.course_id} value={String(course.id || course.course_id)}>{titleFor(course, "Course")}</option>)}</select></label><span className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl bg-cert-ink px-3 text-base font-bold text-cert-yellow">{visibleTasks.length}</span></div></div>
            </header>
            <div className="bg-[linear-gradient(180deg,#fbfefd_0%,#f5faf7_100%)] p-5 sm:p-6">
              {visibleTasks.length === 0 ? <div className="rounded-[1.5rem] border border-dashed border-cert-line bg-[linear-gradient(135deg,#f6fffa_0%,#edf8f2_100%)] px-6 py-12 text-center"><h3 className="text-lg font-semibold text-cert-ink">No {activeTaskView === "assignment" ? "assignments" : "projects"} right now</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Your trainer has not added any work for this course yet. New tasks will appear here automatically.</p></div> : <div className="space-y-3">{visibleTasks.map(renderTask)}</div>}
            </div>
          </section>

          <aside className={`h-fit overflow-hidden rounded-[2rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.15)] xl:sticky xl:top-28 ${activePanel === "task-status" && taskStatusFilter === "approved" ? "hidden" : ""}`}>
            <div className="border-b border-cert-line bg-[linear-gradient(135deg,#f4fff8_0%,#e9f8ef_100%)] px-6 py-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cert-green-dark">Submission desk</p><h3 className="mt-2 text-xl font-semibold text-cert-ink">Submit completed work</h3><p className="mt-1 text-sm leading-6 text-slate-500">Upload your file and leave a note for your trainer.</p></div><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-cert-green-dark ring-1 ring-cert-line"><HardDriveUpload size={21} /></span></div></div>
            <div className="p-5 sm:p-6">
            {submissionTask ? (
              <form onSubmit={submitWork} className="mt-5 space-y-4">
                <p className="rounded-3xl bg-cert-mint px-4 py-3 text-sm font-semibold text-cert-ink">{titleFor(submissionTask, "Selected task")}</p>
                {workFiles.length ? (
                  <div className="flex items-center justify-between gap-3 rounded-3xl border border-cert-green/30 bg-cert-mint px-4 py-3 text-sm text-cert-ink">
                    <span className="inline-flex min-w-0 items-center gap-2 font-medium"><HardDriveUpload size={18} className="shrink-0 text-cert-green-dark" aria-hidden="true" /><span className="truncate">{workFiles.length === 1 ? workFiles[0].name : `${workFiles.length} files from ${workSource || "selected folder"}`}</span></span>
                    <button type="button" onClick={() => { setWorkFiles([]); setWorkSource(""); }} className="rounded-xl p-1 text-slate-500 transition hover:bg-white hover:text-cert-ink" aria-label="Remove selected files"><X size={18} aria-hidden="true" /></button>
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
              <div className="rounded-[1.5rem] border border-dashed border-cert-line bg-slate-50 px-5 py-10 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-cert-green-dark ring-1 ring-cert-line"><CheckCircle2 size={23} /></span><p className="mt-4 font-semibold text-cert-ink">Ready when you are</p><p className="mt-2 text-sm leading-6 text-slate-500">Choose <span className="font-semibold text-cert-green-dark">Submit Work</span> on an assignment or project to start your submission.</p></div>
            )}
            {submitSuccess && <p className="mt-4 rounded-3xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{submitSuccess}</p>}
            </div>
          </aside>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              selectWorkFiles(event.target.files, "device");
              event.target.value = "";
            }}
          />
          <input
            ref={driveFolderInputRef}
            type="file"
            className="hidden"
            multiple
            webkitdirectory=""
            directory=""
            onChange={(event) => {
              selectWorkFiles(event.target.files, "Google Drive folder");
              event.target.value = "";
            }}
          />
          <input
            ref={githubFolderInputRef}
            type="file"
            className="hidden"
            multiple
            webkitdirectory=""
            directory=""
            onChange={(event) => {
              selectWorkFiles(event.target.files, "GitHub repository folder");
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
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-3 rounded-2xl border border-cert-line bg-white p-4 text-left transition hover:border-cert-green hover:bg-cert-mint">
                  <HardDriveUpload size={22} className="shrink-0 text-cert-green-dark" aria-hidden="true" />
                  <span><span className="block font-semibold text-cert-ink">Choose one file</span><span className="mt-1 block text-sm text-slate-500">Select a single completed-work file from your device.</span></span>
                </button>
                <button type="button" onClick={() => driveFolderInputRef.current?.click()} className="flex items-center gap-3 rounded-2xl border border-cert-line bg-cert-mint p-4 text-left transition hover:border-cert-green hover:bg-white">
                  <HardDriveUpload size={22} className="shrink-0 text-cert-green-dark" aria-hidden="true" />
                  <span><span className="block font-semibold text-cert-ink">Select Google Drive folder</span><span className="mt-1 block text-sm text-slate-500">Open the system folder picker and select a folder from a synced Google Drive.</span></span>
                </button>
                <button type="button" onClick={() => githubFolderInputRef.current?.click()} className="flex items-center gap-3 rounded-2xl border border-cert-line bg-white p-4 text-left transition hover:border-cert-green hover:bg-cert-mint">
                  <FolderGit2 size={22} className="shrink-0 text-cert-ink" aria-hidden="true" />
                  <span><span className="block font-semibold text-cert-ink">Select GitHub repository folder</span><span className="mt-1 block text-sm text-slate-500">Choose a cloned GitHub repository folder from your system.</span></span>
                </button>
              </div>
            </div>
          </div>}
        </div>

        <section className={activePanel === "attendance" ? "space-y-5" : "hidden"}>
          <header className="overflow-hidden rounded-[2rem] bg-[radial-gradient(circle_at_88%_12%,rgba(231,232,91,0.28),transparent_24%),linear-gradient(135deg,#062239_0%,#08415a_56%,#0c8a58_135%)] px-6 py-7 text-white shadow-[0_24px_60px_-35px_rgba(7,26,47,0.5)]"><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-yellow">Attendance</p><h1 className="mt-2 text-3xl font-semibold">Your attendance record</h1><p className="mt-2 text-sm leading-6 text-emerald-50/85">Your trainer records attendance for each course session. Percentages update whenever a record is saved.</p></header>
          {courses.length === 0 ? <div className="rounded-[2rem] border border-dashed border-cert-line bg-white px-6 py-12 text-center text-sm text-slate-500">Enroll in a course to see attendance.</div> : <><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{courses.map((course) => { const courseId = String(course.id || course.course_id || ""); const stats = attendanceByCourse.get(courseId) || { total: 0, present: 0, percentage: 0 }; const isSelected = selectedAttendanceCourseId === courseId; return <button type="button" key={courseId} onClick={() => setSelectedAttendanceCourseId(courseId)} aria-pressed={isSelected} className={`rounded-[2rem] border bg-white p-6 text-left shadow-[0_20px_50px_-35px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:border-cert-green hover:shadow-[0_24px_55px_-35px_rgba(15,23,42,0.28)] ${isSelected ? "border-cert-green ring-4 ring-cert-green/15" : "border-cert-line"}`}><p className="text-xs font-bold uppercase tracking-[0.18em] text-cert-green-dark">{titleFor(course, "Course")}</p><div className="mt-5 flex items-end justify-between gap-4"><div><p className="text-4xl font-bold text-cert-ink">{stats.percentage}%</p><p className="mt-1 text-sm text-slate-500">Attendance percentage</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${stats.percentage >= 75 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{stats.total ? `${stats.present}/${stats.total} present` : "No records yet"}</span></div><div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cert-green transition-all" style={{ width: `${stats.percentage}%` }} /></div><p className="mt-4 text-sm text-slate-600">{stats.total ? `You were present for ${stats.present} of ${stats.total} recorded sessions.` : "Your trainer has not recorded attendance for this course yet."}</p><p className="mt-5 text-sm font-semibold text-cert-green-dark">View date-wise attendance →</p></button>; })}</div>{selectedAttendanceCourse && <section className="overflow-hidden rounded-[2rem] border border-cert-line bg-white shadow-[0_20px_50px_-35px_rgba(15,23,42,0.18)]"><header className="flex flex-wrap items-center justify-between gap-4 border-b border-cert-line bg-cert-mint/60 px-6 py-5"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cert-green-dark">Date-wise attendance</p><h2 className="mt-1 text-2xl font-semibold text-cert-ink">{titleFor(selectedAttendanceCourse, "Course")}</h2></div><span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-cert-ink ring-1 ring-cert-line">{selectedAttendanceRecords.length} {selectedAttendanceRecords.length === 1 ? "session" : "sessions"}</span></header>{selectedAttendanceRecords.length === 0 ? <p className="p-6 text-sm text-slate-500">No attendance has been recorded for this course yet.</p> : <div className="divide-y divide-cert-line">{selectedAttendanceRecords.map((record) => <div key={record.id || `${record.attendance_date}-${record.student_id}`} className="flex items-center justify-between gap-4 px-6 py-4"><p className="font-semibold text-cert-ink">{formatAttendanceDate(record.attendance_date)}</p><span className={`rounded-full px-3 py-1.5 text-sm font-bold ${record.status === "present" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{record.status === "present" ? "Present" : "Absent"}</span></div>)}</div>}</section>}</>}
        </section>

        <div className={activePanel === "certificate" ? "space-y-5" : "hidden"}>
          {issuedCertificates.length ? (
            <div className="grid gap-6">
              {issuedCertificates.map(({ certificate, course }) => (
                <article key={certificate.id || `${certificate.student_id}-${certificate.course_id}`} className="relative overflow-hidden rounded-[2rem] border border-cert-green/60 bg-[radial-gradient(circle_at_12%_8%,rgba(49,201,111,0.28),transparent_24%),radial-gradient(circle_at_92%_90%,rgba(7,26,47,0.12),transparent_28%),linear-gradient(135deg,#ffffff_0%,#edf9f1_55%,#dff4e7_100%)] p-3 shadow-[0_28px_70px_-38px_rgba(7,26,47,0.48)]">
                  <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border-[28px] border-cert-green/10" />
                  <div className="pointer-events-none absolute -bottom-20 -left-16 h-52 w-52 rounded-full border-[22px] border-cert-ink/5" />
                  <div className="relative rounded-[1.45rem] border-[3px] border-cert-ink bg-white/70 px-6 py-8 text-center sm:px-12 sm:py-10">
                    <div className="flex flex-col items-center gap-3 rounded-2xl bg-cert-ink px-5 py-4 shadow-lg shadow-cert-ink/20 sm:flex-row sm:justify-between sm:text-left">
                      <div className="inline-flex items-center gap-3">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cert-green text-cert-ink shadow-lg shadow-black/20"><Award size={22} aria-hidden="true" /></span>
                        <span><span className="block text-lg font-extrabold tracking-tight text-white">CERTISURED</span><span className="block text-[0.6rem] font-bold tracking-[0.16em] text-white/65">LEARNING MANAGEMENT SYSTEM</span></span>
                      </div>
                      <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-cert-green">Verified completion</span>
                    </div>

                    <p className="mt-8 text-xs font-bold uppercase tracking-[0.3em] text-cert-green-dark">Certificate of completion</p>
                    <h2 className="mt-3 font-serif text-4xl font-semibold text-cert-ink sm:text-5xl">Achievement Award</h2>
                    <div className="mx-auto mt-5 h-1 w-20 rounded-full bg-cert-green shadow-[0_0_18px_rgba(49,201,111,0.7)]" />
                    <p className="mt-7 text-sm text-slate-500">This certificate is proudly presented to</p>
                    <p className="mt-2 font-serif text-4xl font-bold text-cert-ink sm:text-5xl">{profile.full_name || "Student"}</p>
                    <p className="mx-auto mt-6 max-w-2xl text-sm leading-7 text-slate-600">for successfully completing all approved assignments and projects for</p>
                    <p className="mt-1 text-xl font-bold text-cert-green-dark sm:text-2xl">{titleFor(course, "this course")}</p>

                    <div className="mx-auto mt-7 grid max-w-2xl gap-3 text-left sm:grid-cols-2">
                      <div className="rounded-2xl border border-cert-green/35 bg-cert-mint/70 px-4 py-3"><p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-cert-green-dark">Course duration</p><p className="mt-1 font-semibold text-cert-ink">{course?.duration || "Not specified"}</p></div>
                      <div className="rounded-2xl border border-cert-ink/15 bg-cert-ink/[0.04] px-4 py-3"><p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-cert-ink/60">Issued by</p><p className="mt-1 font-semibold text-cert-ink">{course?.trainer_name || "Certisured Training Team"}</p></div>
                    </div>

                    <div className="mt-8 flex flex-col gap-5 border-t border-cert-line pt-5 text-left sm:flex-row sm:items-end sm:justify-between">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs text-slate-500"><div><p>Certificate no.</p><p className="mt-1 font-semibold text-cert-ink">{certificate.certificate_number || `CERT-${String(certificate.id || "COMPLETE").slice(-8).toUpperCase()}`}</p></div><div><p>Issue date</p><p className="mt-1 font-semibold text-cert-ink">{formatCertificateDate(certificate.issue_date || certificate.created_at)}</p></div></div>
                      <button type="button" onClick={() => downloadCertificate(certificate, course)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cert-green px-5 py-3 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white"><Download size={16} aria-hidden="true" /> Download certificate</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div id="course-progress" className="rounded-[2rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
              <h2 className="text-xl font-semibold text-cert-ink">Certificate progress</h2>
              <p className="mt-2 text-sm text-slate-500">Your certificate is issued automatically once your trainer approves every assignment and project for the course.</p>
              <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-cert-green" style={{ width: `${courseStats.progress}%` }} />
              </div>
              <p className="mt-4 text-sm text-slate-500">{courseStats.approved} of {courseStats.totalTasks} required tasks approved for {titleFor(selectedCourse, "this course")}.</p>
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
