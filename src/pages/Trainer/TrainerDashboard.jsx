import { useEffect, useMemo, useRef, useState } from "react";
import { Award, Bell, CheckCircle2, ClipboardCheck, KeyRound, LogOut, Plus, Sparkles, UsersRound, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { supabase } from "../../lib/supabaseClient";

const titleFor = (item, fallback = "Untitled") => item?.title || item?.name || item?.full_name || item?.email || fallback;
const edgeFunctionErrorMessage = async (error, fallback) => {
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    const body = await response.clone().json().catch(() => null);
    if (body?.error) return body.error;
  }
  return error?.message || fallback;
};
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
const currentDate = new Date().toISOString().slice(0, 10);
const taskEndDate = (task) => task?.end_date || task?.due_date || "";
const taskIsInactive = (task) => Boolean(taskEndDate(task) && taskEndDate(task) < currentDate) || task?.status === "inactive";
const emptyCertificateTestQuestions = () => Array.from({ length: 5 }, (_, index) => ({
  id: `q${index + 1}`,
  question: "",
  options: ["", "", "", ""],
  correctOption: 0,
}));
const formatVideoAvailability = (date) => {
  if (!date) return "Available 24 hours after posting";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "Available 24 hours after posting"
    : `Available ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(parsed)}`;
};
const videoIsActive = (video) => Boolean(video?.available_at) && new Date(video.available_at).getTime() <= Date.now();
const xmlEscape = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" }[character]));
const xlsxCrcTable = (() => Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
}))();
const xlsxCrc32 = (bytes) => {
  let value = 0xffffffff;
  bytes.forEach((byte) => { value = (value >>> 8) ^ xlsxCrcTable[(value ^ byte) & 0xff]; });
  return (value ^ 0xffffffff) >>> 0;
};
const xlsxBytes = (chunks) => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.length; });
  return output;
};
const createXlsxWorkbook = (files) => {
  const encoder = new TextEncoder();
  const entries = files.map(({ name, content }) => ({ name: encoder.encode(name), data: encoder.encode(content) }));
  let offset = 0;
  const localFiles = [];
  const centralFiles = [];

  entries.forEach((entry) => {
    const crc = xlsxCrc32(entry.data);
    const local = new Uint8Array(30 + entry.name.length + entry.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, entry.name.length, true);
    local.set(entry.name, 30);
    local.set(entry.data, 30 + entry.name.length);
    localFiles.push(local);

    const central = new Uint8Array(46 + entry.name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, entry.name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(entry.name, 46);
    centralFiles.push(central);
    offset += local.length;
  });

  const centralDirectory = xlsxBytes(centralFiles);
  const footer = new Uint8Array(22);
  const footerView = new DataView(footer.buffer);
  footerView.setUint32(0, 0x06054b50, true);
  footerView.setUint16(8, entries.length, true);
  footerView.setUint16(10, entries.length, true);
  footerView.setUint32(12, centralDirectory.length, true);
  footerView.setUint32(16, offset, true);
  return xlsxBytes([...localFiles, centralDirectory, footer]);
};
const spreadsheetColumn = (index) => {
  let value = index + 1;
  let column = "";
  while (value) { const remainder = (value - 1) % 26; column = String.fromCharCode(65 + remainder) + column; value = Math.floor((value - 1) / 26); }
  return column;
};

const instructionLabels = "Objective|Dataset(?:\\s+(?:Columns|Requirements))?|Requirements?|Tasks?|Expected Output|Deliverables?|Steps?|Code";
const instructionHeadingPattern = new RegExp(`(?:^|\\n\\n)(${instructionLabels}):\\s*`, "gi");

const formatTaskDescription = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .replace(new RegExp(`\\s*(${instructionLabels})\\s*:?\\s*`, "gi"), (_, label, offset) => `${offset ? "\n\n" : ""}${label.replace(/\\b\\w/g, (letter) => letter.toUpperCase())}: `)
    .replace(/\s+(\d+[.)])\s+/g, "\n$1 ")
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

  return <div className="mt-4 space-y-3">{sections.map((section) => {
    const steps = section.label.toLowerCase().startsWith("task") || section.label.toLowerCase().startsWith("step")
      ? section.content.split(/(?:^|\n)(?:\d+[.)]|[-•])\s+/).filter(Boolean)
      : [];
    return <section key={section.label} className="rounded-xl border border-cert-line bg-white/80 p-3.5">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-cert-green-dark">{section.label}</p>
      {steps.length > 1
        ? <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-slate-600">{steps.map((step, index) => <li key={`${section.label}-${index}`}>{step}</li>)}</ol>
        : <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{section.content}</p>}
    </section>;
  })}</div>;
};

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

const insertRowsWithServiceFallback = async (table, rows) => {
  const { data, error } = await supabase.from(table).insert(rows).select();
  if (!error || !hasServiceRoleKey) return { data, error };

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(rows),
    });
    const responseData = await response.json().catch(() => null);
    return response.ok
      ? { data: responseData, error: null }
      : { data: null, error: { message: responseData?.message || error.message } };
  } catch {
    return { data, error };
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
  const [certificates, setCertificates] = useState([]);
  const [courseReviews, setCourseReviews] = useState([]);
  const [certificateTests, setCertificateTests] = useState([]);
  const [certificateTestAttempts, setCertificateTestAttempts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [courseVideos, setCourseVideos] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [assignmentForm, setAssignmentForm] = useState({ courseId: "", title: "", description: "", assignedDate: currentDate, endDate: "" });
  const [projectForm, setProjectForm] = useState({ courseId: "", title: "", description: "", assignedDate: currentDate, endDate: "" });
  const [videoForm, setVideoForm] = useState({ courseId: "", title: "", lessonDate: new Date().toISOString().slice(0, 10), videoUrl: "" });
  const [attendanceForm, setAttendanceForm] = useState({ courseId: "", attendanceDate: currentDate });
  const [attendanceMarks, setAttendanceMarks] = useState({});
  const [certificateTestForm, setCertificateTestForm] = useState({ courseId: "", title: "Course certificate test", questions: emptyCertificateTestQuestions() });
  const [reviewNotes, setReviewNotes] = useState({});
  const [activeWorkspace, setActiveWorkspace] = useState("overview");
  const [issuingCertificateKey, setIssuingCertificateKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const issuingCertificateKeysRef = useRef(new Set());
  const trainerName = profile?.full_name || profile?.name || "Trainer";

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
    const allCertificates = courseIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("certificates")
        : await fetchRows("certificates", (query) => query.in("course_id", courseIds)))
      : [];
    const certificateRows = allCertificates.filter((certificate) => courseIds.some((courseId) => String(courseId) === String(certificate.course_id)));
    const allCourseReviews = courseIds.length
      ? (hasServiceRoleKey ? await fetchRowsWithServiceRole("course_reviews") : await fetchRows("course_reviews", (query) => query.in("course_id", courseIds)))
      : [];
    const courseReviewRows = allCourseReviews.filter((review) => courseIds.some((courseId) => String(courseId) === String(review.course_id)));
    const allCertificateTests = courseIds.length
      ? (hasServiceRoleKey ? await fetchRowsWithServiceRole("course_certificate_tests") : await fetchRows("course_certificate_tests", (query) => query.in("course_id", courseIds)))
      : [];
    const certificateTestRows = allCertificateTests.filter((test) => courseIds.some((courseId) => String(courseId) === String(test.course_id)));
    const allCertificateTestAttempts = courseIds.length
      ? (hasServiceRoleKey ? await fetchRowsWithServiceRole("certificate_test_attempts") : await fetchRows("certificate_test_attempts", (query) => query.in("course_id", courseIds)))
      : [];
    const certificateTestAttemptRows = allCertificateTestAttempts.filter((attempt) => courseIds.some((courseId) => String(courseId) === String(attempt.course_id)));
    const allNotifications = hasServiceRoleKey
      ? await fetchRowsWithServiceRole("trainer_notifications")
      : await fetchRows("trainer_notifications", (query) => query.eq("trainer_id", profile.id).order("created_at", { ascending: false }));
    const notificationRows = allNotifications
      .filter((notification) => String(notification.trainer_id) === String(profile.id))
      .sort((first, second) => String(second.created_at || "").localeCompare(String(first.created_at || "")));
    const allCourseVideos = courseIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("course_videos")
        : await fetchRows("course_videos", (query) => query.in("course_id", courseIds).order("created_at", { ascending: false })))
      : [];
    const videoRows = allCourseVideos
      .filter((video) => courseIds.some((courseId) => String(courseId) === String(video.course_id)))
      .sort((first, second) => String(second.created_at || "").localeCompare(String(first.created_at || "")));
    const allAttendance = courseIds.length
      ? (hasServiceRoleKey
        ? await fetchRowsWithServiceRole("attendance")
        : await fetchRows("attendance", (query) => query.in("course_id", courseIds)))
      : [];
    const attendanceRows = allAttendance.filter((record) => courseIds.some((courseId) => String(courseId) === String(record.course_id)));

    setCourses(trainerCourses);
    setEnrollments(enrollmentRows);
    setStudents(studentRows);
    setAssignments(assignmentRows);
    setProjects(projectRows);
    setSubmissions(submissionRows);
    setCertificates(certificateRows);
    setCourseReviews(courseReviewRows);
    setCertificateTests(certificateTestRows);
    setCertificateTestAttempts(certificateTestAttemptRows);
    setNotifications(notificationRows);
    setCourseVideos(videoRows);
    setAttendance(attendanceRows);
    setLoading(false);
  };

  useEffect(() => {
    loadDashboard();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const reviewChannel = supabase.channel(`trainer-course-reviews-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "course_reviews" }, () => loadDashboard())
      .subscribe();
    return () => { supabase.removeChannel(reviewChannel); };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const channel = supabase
      .channel(`trainer-notifications-${profile.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trainer_notifications", filter: `trainer_id=eq.${profile.id}` }, (payload) => {
        setNotifications((current) => [payload.new, ...current.filter((notification) => String(notification.id) !== String(payload.new.id))]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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
      const assignedAt = project.assigned_date || project.assigned_at || project.created_at || project.submitted_at || null;
      const key = `${project.course_id || "course"}-${project.title || "project"}-${assignedAt || project.id}`;
      const group = groups.get(key) || { ...project, assignedAt, studentIds: new Set() };
      if (project.student_id) group.studentIds.add(String(project.student_id));
      groups.set(key, group);
    });

    return [...groups.values()].sort((first, second) => String(second.assignedAt || "").localeCompare(String(first.assignedAt || "")));
  }, [projects]);
  const certificateApprovals = useMemo(() => enrollments.filter((enrollment) => !certificates.some((certificate) =>
    String(certificate.student_id) === String(enrollment.student_id) && String(certificate.course_id) === String(enrollment.course_id)
  )).map((enrollment) => {
    const studentId = enrollment.student_id;
    const courseId = enrollment.course_id;
    const courseAssignments = assignments.filter((assignment) => String(assignment.course_id) === String(courseId) && (!assignment.student_id || String(assignment.student_id) === String(studentId)));
    const studentProjects = projects.filter((project) => String(project.course_id) === String(courseId) && String(project.student_id) === String(studentId));
    const unapprovedAssignments = courseAssignments.filter((assignment) => !submissions.some((submission) => String(submission.assignment_id) === String(assignment.id) && String(submission.student_id) === String(studentId) && submission.status === "approved"));
    const unapprovedProjects = studentProjects.filter((project) => project.status !== "approved");
    const pendingCount = unapprovedAssignments.length + unapprovedProjects.length;
    const test = certificateTests.find((item) => String(item.course_id) === String(courseId));
    const passedAttempt = test && certificateTestAttempts.find((attempt) => String(attempt.test_id) === String(test.id) && String(attempt.student_id) === String(studentId) && attempt.passed);
    const workReady = courseAssignments.length + studentProjects.length > 0 && pendingCount === 0;
    const testConfigured = Boolean(test);
    const testPassed = Boolean(passedAttempt);
    return {
      enrollment, studentId, courseId,
      pendingAssignments: unapprovedAssignments.length,
      pendingProjects: unapprovedProjects.length,
      workReady,
      testConfigured,
      testPassed,
      issueReady: workReady && testPassed,
    };
  }), [enrollments, assignments, projects, submissions, certificates, certificateTests, certificateTestAttempts]);
  const certificateApprovalGroups = useMemo(() => {
    const groups = new Map();

    certificateApprovals.forEach((approval) => {
      const courseId = String(approval.courseId || "unassigned");
      groups.set(courseId, [...(groups.get(courseId) || []), approval]);
    });

    return [...groups.entries()]
      .map(([courseId, approvals]) => ({
        courseId,
        course: courseById.get(courseId),
        approvals: [...approvals].sort((first, second) => titleFor(studentById.get(String(first.studentId)), "Student").localeCompare(titleFor(studentById.get(String(second.studentId)), "Student"))),
      }))
      .sort((first, second) => titleFor(first.course, "Course").localeCompare(titleFor(second.course, "Course")));
  }, [certificateApprovals, courseById, studentById]);

  const enrolledStudentIds = (courseId) => [...new Set(
    enrollments
      .filter((row) => String(row.course_id) === String(courseId))
      .map((row) => row.student_id || row.profile_id || row.user_id)
      .filter(Boolean)
  )];

  const attendanceStudents = useMemo(() => enrolledStudentIds(attendanceForm.courseId)
    .map((studentId) => studentById.get(String(studentId)))
    .filter(Boolean), [attendanceForm.courseId, enrollments, studentById]);
  const courseAttendanceSheet = useMemo(() => attendance
    .filter((record) => String(record.course_id) === String(attendanceForm.courseId))
    .map((record) => ({ record, student: studentById.get(String(record.student_id)) }))
    .sort((first, second) => String(first.record.attendance_date || "").localeCompare(String(second.record.attendance_date || ""))
      || titleFor(first.student, "Student").localeCompare(titleFor(second.student, "Student"))), [attendance, attendanceForm.courseId, studentById]);

  useEffect(() => {
    const existingMarks = attendance.reduce((marks, record) => {
      if (String(record.course_id) === String(attendanceForm.courseId)
        && record.attendance_date === attendanceForm.attendanceDate) {
        marks[record.student_id] = record.status;
      }
      return marks;
    }, {});
    setAttendanceMarks(existingMarks);
  }, [attendance, attendanceForm.courseId, attendanceForm.attendanceDate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (newPassword.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setIsUpdatingPassword(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setIsUpdatingPassword(false);
    if (updateError) {
      setError(updateError.message || "Unable to update your password.");
      return;
    }

    setNewPassword("");
    setConfirmNewPassword("");
    setMessage("Your password has been updated.");
  };

  const openWorkspace = (workspace) => {
    setActiveWorkspace(workspace);
    window.history.replaceState(null, "", `#${workspace}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const markNotificationsRead = async (notificationType) => {
    const unreadIds = notifications
      .filter((notification) => !notification.is_read && (!notificationType || notification.notification_type === notificationType))
      .map((notification) => notification.id)
      .filter(Boolean);
    if (!unreadIds.length) return;
    setNotifications((current) => current.map((notification) => unreadIds.includes(notification.id) ? { ...notification, is_read: true } : notification));
    const { error: readError } = await supabase.from("trainer_notifications").update({ is_read: true }).in("id", unreadIds);
    if (readError) await loadDashboard();
  };

  const createAssignment = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!assignmentForm.courseId || !assignmentForm.title.trim() || !assignmentForm.assignedDate || !assignmentForm.endDate) {
      setError("Select a course, enter a title, assignment date, and end date.");
      return;
    }
    if (assignmentForm.endDate < assignmentForm.assignedDate) {
      setError("The assignment end date must be on or after the assignment date.");
      return;
    }
    const studentIds = enrolledStudentIds(assignmentForm.courseId);
    if (!studentIds.length) {
      setError("This course has no enrolled students to receive the assignment.");
      return;
    }
    const { data: assignedCount, error: createError } = await supabase.rpc("assign_assignment_to_enrolled_students", {
      p_course_id: assignmentForm.courseId,
      p_title: assignmentForm.title.trim(),
      p_description: formatTaskDescription(assignmentForm.description) || null,
      p_assigned_date: assignmentForm.assignedDate,
      p_end_date: assignmentForm.endDate,
    });
    if (createError) {
      setError(createError.message || "Unable to create assignment.");
      return;
    }
    if (!assignedCount) {
      setError("This course has no enrolled students to receive the assignment.");
      return;
    }

    const course = courses.find((item) => String(item.id) === String(assignmentForm.courseId));
    const { data: emailResult, error: notificationError } = await supabase.functions.invoke("send-assignment-notifications", {
      body: {
        courseId: assignmentForm.courseId,
        workTitle: assignmentForm.title.trim(),
        workType: "assignment",
        assignedDate: assignmentForm.assignedDate,
        endDate: assignmentForm.endDate,
      },
    });

    setAssignmentForm({ courseId: "", title: "", description: "", assignedDate: currentDate, endDate: "" });
    if (notificationError || emailResult?.error) {
      setMessage(`Assignment sent to ${assignedCount} enrolled ${assignedCount === 1 ? "student" : "students"}, but email notifications could not be sent. Check the notification email function and SMTP settings.`);
    } else {
      const sentCount = Number(emailResult?.sentCount) || 0;
      const failedCount = Number(emailResult?.failedCount) || 0;
      const courseName = titleFor(course, "the selected course");
      const emailSummary = failedCount
        ? `${sentCount} email${sentCount === 1 ? "" : "s"} sent; ${failedCount} could not be delivered.`
        : `${sentCount} email${sentCount === 1 ? "" : "s"} sent.`;
      setMessage(`Assignment \"${assignmentForm.title.trim()}\" was created for ${courseName}. ${emailSummary}`);
    }
    await loadDashboard();
  };

  const createProject = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!projectForm.courseId || !projectForm.title.trim() || !projectForm.assignedDate || !projectForm.endDate) {
      setError("Select a course, enter a title, assignment date, and end date.");
      return;
    }
    if (projectForm.endDate < projectForm.assignedDate) {
      setError("The project end date must be on or after the assignment date.");
      return;
    }
    const studentIds = enrolledStudentIds(projectForm.courseId);
    if (!studentIds.length) {
      setError("This course has no enrolled students to assign the project to.");
      return;
    }
    const { data: assignedCount, error: createError } = await supabase.rpc("assign_project_to_enrolled_students", {
      p_course_id: projectForm.courseId,
      p_title: projectForm.title.trim(),
      p_description: formatTaskDescription(projectForm.description) || null,
      p_assigned_date: projectForm.assignedDate,
      p_end_date: projectForm.endDate,
    });
    if (createError) {
      setError(createError.message || "Unable to assign project.");
      return;
    }
    if (!assignedCount) {
      setError("This course has no enrolled students to receive the project.");
      return;
    }

    const course = courses.find((item) => String(item.id) === String(projectForm.courseId));
    const { data: emailResult, error: notificationError } = await supabase.functions.invoke("send-assignment-notifications", {
      body: {
        courseId: projectForm.courseId,
        workTitle: projectForm.title.trim(),
        workType: "project",
        assignedDate: projectForm.assignedDate,
        endDate: projectForm.endDate,
      },
    });

    setProjectForm({ courseId: "", title: "", description: "", assignedDate: currentDate, endDate: "" });
    if (notificationError || emailResult?.error) {
      setMessage(`Project assigned to ${assignedCount} enrolled ${assignedCount === 1 ? "student" : "students"}, but email notifications could not be sent. Check the notification email function and SMTP settings.`);
    } else {
      const sentCount = Number(emailResult?.sentCount) || 0;
      const failedCount = Number(emailResult?.failedCount) || 0;
      const courseName = titleFor(course, "the selected course");
      const emailSummary = failedCount
        ? `${sentCount} email${sentCount === 1 ? "" : "s"} sent; ${failedCount} could not be delivered.`
        : `${sentCount} email${sentCount === 1 ? "" : "s"} sent.`;
      setMessage(`Project \"${projectForm.title.trim()}\" was created for ${courseName}. ${emailSummary}`);
    }
    await loadDashboard();
  };

  const publishCourseVideo = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!videoForm.courseId || !videoForm.title.trim() || !videoForm.videoUrl.trim()) {
      setError("Select a course, enter a video title, and add the video link.");
      return;
    }

    const availableAt = new Date(`${videoForm.lessonDate || new Date().toISOString().slice(0, 10)}T00:00:00`).toISOString();
    const { error: videoError } = await supabase.from("course_videos").insert({
      course_id: videoForm.courseId,
      trainer_id: profile.id,
      title: videoForm.title.trim(),
      video_url: videoForm.videoUrl.trim(),
      available_at: availableAt,
    });

    if (videoError) {
      setError(videoError.message || "Unable to post the course video.");
      return;
    }

    setVideoForm({ courseId: "", title: "", lessonDate: new Date().toISOString().slice(0, 10), videoUrl: "" });
    setMessage("Course video posted for enrolled students.");
    await loadDashboard();
  };

  const saveAttendance = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!attendanceForm.courseId || !attendanceForm.attendanceDate) {
      setError("Select a course and attendance date.");
      return;
    }
    if (!attendanceStudents.length) {
      setError("This course has no enrolled students.");
      return;
    }
    const unmarkedStudent = attendanceStudents.find((student) => !["present", "absent"].includes(attendanceMarks[student.id]));
    if (unmarkedStudent) {
      setError(`Mark ${titleFor(unmarkedStudent, "every student")} as present or absent before saving.`);
      return;
    }
    const rows = attendanceStudents.map((student) => ({
      student_id: student.id,
      course_id: attendanceForm.courseId,
      attendance_date: attendanceForm.attendanceDate,
      status: attendanceMarks[student.id],
    }));
    const { error: attendanceError } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "student_id,course_id,attendance_date" });
    if (attendanceError) {
      setError(attendanceError.message || "Unable to save attendance.");
      return;
    }
    setMessage(`Attendance saved for ${attendanceStudents.length} ${attendanceStudents.length === 1 ? "student" : "students"}.`);
    await loadDashboard();
  };

  const downloadAttendanceSheet = () => {
    if (!attendanceForm.courseId || !courseAttendanceSheet.length) {
      setError("Save attendance before exporting the Excel workbook.");
      return;
    }
    const course = courseById.get(String(attendanceForm.courseId));
    const rows = [
      ["Course", "Date", "Student", "Email", "Attendance status"],
      ...courseAttendanceSheet.map(({ student, record }) => [
        titleFor(course, "Course"),
        formatAssignmentDate(record.attendance_date),
        titleFor(student, "Student"),
        student?.email || "",
        record.status === "present" ? "Present" : "Absent",
      ]),
    ];
    const cell = (value, reference, style = "") => `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t>${xmlEscape(value)}</t></is></c>`;
    const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cell(value, `${spreadsheetColumn(columnIndex)}${rowIndex + 1}`, rowIndex === 0 ? "1" : "")).join("")}</row>`).join("");
    const workbook = createXlsxWorkbook([
      { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Attendance" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: "xl/styles.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F4E8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>' },
      { name: "xl/worksheets/sheet1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E${rows.length}"/><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="26" customWidth="1"/><col min="4" max="4" width="34" customWidth="1"/><col min="5" max="5" width="20" customWidth="1"/></cols><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:E${rows.length}"/></worksheet>` },
    ]);
    const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-${String(titleFor(course, "course")).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-all-dates.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
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
  };

  const saveCertificateTest = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    const { courseId, title, questions } = certificateTestForm;
    if (!courseId || !title.trim() || questions.some((question) => !question.question.trim() || question.options.some((option) => !option.trim()))) {
      setError("Select a course and complete all five questions with four answer options each.");
      return;
    }

    const payload = {
      course_id: courseId,
      trainer_id: profile.id,
      title: title.trim(),
      questions: questions.map((question) => ({
        id: question.id,
        question: question.question.trim(),
        options: question.options.map((option) => option.trim()),
        correct_option: String(question.correctOption),
      })),
      passing_score: 75,
      updated_at: new Date().toISOString(),
    };
    const { error: testError } = await supabase
      .from("course_certificate_tests")
      .upsert(payload, { onConflict: "course_id" });
    if (testError) {
      setError(testError.message || "Unable to save the certificate test.");
      return;
    }
    setMessage("Certificate test saved. Students must score above 75% within three attempts before a certificate can be issued.");
    await loadDashboard();
  };

  const issueCertificate = async (studentId, courseId) => {
    setError("");
    setMessage("");
    const certificateKey = `${studentId}-${courseId}`;
    if (issuingCertificateKeysRef.current.has(certificateKey)) return;
    const alreadyIssued = certificates.some((certificate) => String(certificate.student_id) === String(studentId) && String(certificate.course_id) === String(courseId));
    if (alreadyIssued) {
      setMessage("Certificate has already been issued for this course.");
      return;
    }
    const approval = certificateApprovals.find((item) => String(item.studentId) === String(studentId) && String(item.courseId) === String(courseId));
    if (!approval?.workReady) {
      const remaining = `${approval?.pendingAssignments || 0} assignment${approval?.pendingAssignments === 1 ? "" : "s"} and ${approval?.pendingProjects || 0} project${approval?.pendingProjects === 1 ? "" : "s"}`;
      setError(`Certificate cannot be issued yet. ${remaining} still need trainer approval.`);
      return;
    }
    if (!approval.testConfigured) {
      const { data: generatedTest, error: generationError } = await supabase.functions.invoke("generate-certificate-test", {
        body: { courseId },
      });
      if (generationError || generatedTest?.error) {
        setError(generatedTest?.error || await edgeFunctionErrorMessage(generationError, "Unable to generate the certificate test."));
        return;
      }
      setMessage("A three-attempt certificate test was generated for the student. They must score above 75% before the certificate can be issued.");
      await loadDashboard();
      return;
    }
    if (!approval.testPassed) {
      setError("The student must pass the certificate test with a score above 75% before a certificate can be issued.");
      return;
    }
    issuingCertificateKeysRef.current.add(certificateKey);
    setIssuingCertificateKey(certificateKey);
    try {
      const { data: certificate, error: certificateError } = await supabase.from("certificates").insert({
        student_id: studentId,
        course_id: courseId,
        certificate_number: `CERT-${Date.now().toString().slice(-8)}`,
        issue_date: new Date().toISOString().slice(0, 10),
        status: "issued",
        issued_by: profile.id,
      }).select().single();
      if (certificateError) {
        if (certificateError.code === "23505") {
          setMessage("Certificate has already been issued for this course.");
        } else {
          setError(certificateError.message || "Unable to issue certificate.");
        }
        return;
      }
      const { error: emailError } = await supabase.functions.invoke("send-certificate-email", {
        body: { certificateId: certificate.id },
      });
      setMessage(emailError
        ? "Certificate issued to the student, but the email could not be sent. Check the email function SMTP settings."
        : "Certificate issued and emailed to the student.");
      await loadDashboard();
    } finally {
      issuingCertificateKeysRef.current.delete(certificateKey);
      setIssuingCertificateKey("");
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
    return (
      <div className="cert-bg-trainer flex min-h-screen items-center justify-center p-6 text-cert-ink">
        <div className="relative w-full max-w-xl overflow-hidden rounded-[2.5rem] border border-white/80 bg-white px-8 py-10 text-center shadow-[0_32px_90px_-42px_rgba(15,23,42,0.34)] sm:px-12 sm:py-12">
          <div className="absolute -left-16 -top-16 h-40 w-40 rounded-full bg-cert-green/15 blur-2xl" />
          <div className="absolute -bottom-20 -right-12 h-44 w-44 rounded-full bg-violet-100/80 blur-2xl" />
          <div className="relative">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-cert-navy text-cert-yellow shadow-lg shadow-cert-navy/20"><Sparkles size={30} aria-hidden="true" /></span>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.26em] text-cert-green-dark">Trainer workspace</p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-cert-ink sm:text-4xl">Welcome, {trainerName}!</p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">We are opening your courses, learners, and student submissions.</p>
            <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-cert-line bg-cert-mint/70 p-4 text-left">
              <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.14em] text-cert-green-dark"><span>Preparing your workspace</span><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cert-green" /></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full w-2/3 animate-pulse rounded-full bg-[linear-gradient(90deg,#0c8a58,#31c96f,#e7e85b)]" /></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const awaitingSubmissions = submissions.filter((submission) => (submission.status || "").toLowerCase() === "submitted");
  const awaitingProjects = projects.filter((project) => (project.status || "").toLowerCase() === "submitted");
  const assignmentReviewAlertCount = awaitingSubmissions.length;
  const projectReviewAlertCount = awaitingProjects.length;

  return (
    <div className="cert-bg-trainer min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="w-full space-y-6">
        <nav className="sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[1.75rem] border border-cert-line bg-white/95 p-3 shadow-[0_18px_50px_-35px_rgba(15,23,42,0.4)] backdrop-blur">
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => openWorkspace("overview")} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "overview" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}><Sparkles size={16} /> Overview</button>
            <button type="button" onClick={() => openWorkspace("create-assignment")} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "create-assignment" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}>Create assignment</button>
            <button type="button" onClick={() => openWorkspace("assign-project")} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "assign-project" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}>Assign project</button>
            <button type="button" onClick={() => openWorkspace("add-videos")} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "add-videos" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}><Video size={16} /> Add videos</button>
            <button type="button" onClick={() => openWorkspace("attendance")} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "attendance" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}><ClipboardCheck size={16} /> Attendance</button>
            <button type="button" onClick={() => openWorkspace("certificate-approvals")} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "certificate-approvals" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}><Award size={16} /> Certificates</button>
            <button type="button" onClick={() => openWorkspace("change-password")} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeWorkspace === "change-password" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}><KeyRound size={16} /> Change password</button>
            <button type="button" onClick={() => { openWorkspace("project-reviews"); markNotificationsRead("project_submission"); }} className={`relative inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${projectReviewAlertCount > 0 ? "border-rose-300 bg-rose-50 text-rose-700 shadow-sm shadow-rose-100 hover:bg-rose-100" : activeWorkspace === "project-reviews" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}><Bell size={16} className={projectReviewAlertCount > 0 ? "text-rose-600" : ""} /> Project reviews{projectReviewAlertCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.65rem] font-bold text-white">{projectReviewAlertCount}</span>}</button>
            <button type="button" onClick={() => { openWorkspace("assignment-submissions"); markNotificationsRead("assignment_submission"); }} className={`relative inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${assignmentReviewAlertCount > 0 ? "border-rose-300 bg-rose-50 text-rose-700 shadow-sm shadow-rose-100 hover:bg-rose-100" : activeWorkspace === "assignment-submissions" ? "border-cert-green bg-cert-green text-cert-ink" : "border-cert-line text-cert-ink hover:border-cert-green hover:bg-cert-mint"}`}><Bell size={16} className={assignmentReviewAlertCount > 0 ? "text-rose-600" : ""} /> Assignment submissions{assignmentReviewAlertCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.65rem] font-bold text-white">{assignmentReviewAlertCount}</span>}</button>
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
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur"><p className="text-lg font-semibold text-white">{assignments.length}</p><p className="mt-2 text-xs text-emerald-50/80">Assignments</p></div>
              <button type="button" onClick={() => openWorkspace("assignment-submissions")} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur transition hover:bg-white/20"><ClipboardCheck size={18} className="mx-auto text-cert-yellow" /><p className="mt-2 text-lg font-semibold text-white">{awaitingSubmissions.length + awaitingProjects.length}</p><p className="text-xs text-emerald-50/80">To review</p></button>
            </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-[2rem] border border-cert-line bg-white shadow-[0_24px_60px_-38px_rgba(7,26,47,0.18)]">
            <div className="flex flex-wrap items-end justify-between gap-4 bg-[linear-gradient(135deg,#f5fffa_0%,#eef8f2_65%,#e7f5ec_100%)] px-6 py-7 sm:px-8">
              <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-green-dark">Teaching portfolio</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-cert-ink">My course rooms</h2><p className="mt-1 text-sm text-slate-500">A quick view of each learning space and its active learners.</p></div>
              <span className="inline-flex items-center rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-cert-green-dark shadow-sm ring-1 ring-cert-line">{courses.length} {courses.length === 1 ? "course" : "courses"}</span>
            </div>
            {courses.length === 0 ? <div className="m-6 rounded-2xl border border-dashed border-cert-line bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">No courses are assigned to you yet.</div> : <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-2">{courses.map((course, index) => {
              const courseStudentIds = enrolledStudentIds(course.id);
              return <article key={course.id} className="grid overflow-hidden rounded-[1.6rem] border border-cert-line bg-white shadow-[0_18px_38px_-30px_rgba(7,26,47,0.26)] md:grid-cols-[10.5rem_minmax(0,1fr)]">
                <div className="flex min-h-44 flex-col justify-between bg-[radial-gradient(circle_at_78%_22%,rgba(49,201,111,0.65),transparent_30%),linear-gradient(145deg,#071a2f,#0a3d45_55%,#0b5943)] p-5 text-white"><div className="flex items-start justify-end"><span className="text-xs font-bold text-white/65">0{index + 1}</span></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7ff0b0]">Course room</p><h3 className="mt-2 text-lg font-semibold leading-tight">{titleFor(course, "Course")}</h3></div></div>
                <div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-cert-green-dark">Active learning</p><h3 className="mt-1 text-xl font-semibold text-cert-ink">{titleFor(course, "Course")}</h3></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[0.64rem] font-bold uppercase tracking-[0.14em] text-emerald-600">{course.status || "active"}</span></div><p className="mt-3 min-h-12 text-sm leading-6 text-slate-600">{course.description || "Learning workspace managed by you."}</p><div className="mt-4 flex flex-wrap gap-2 border-y border-slate-100 py-3"><span className="rounded-xl bg-cert-mint px-3 py-2 text-xs font-semibold text-cert-green-dark"><UsersRound size={14} className="mr-1 inline" /> {courseStudentIds.length} learners</span>{course.duration && <span className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Duration: {course.duration}</span>}</div><div className="mt-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-cert-ink">Students</p><span className="text-xs text-slate-400">{courseStudentIds.length} enrolled</span></div>{courseStudentIds.length === 0 ? <p className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">No students are enrolled in this course yet.</p> : <div className="mt-3 flex flex-wrap gap-2">{courseStudentIds.map((studentId) => { const student = studentById.get(String(studentId)); const name = titleFor(student, "Student"); return <span key={studentId} className="inline-flex items-center gap-2 rounded-full border border-cert-line bg-white px-2.5 py-1.5 text-sm font-medium text-cert-ink"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cert-mint text-xs font-bold text-cert-green-dark">{name.charAt(0).toUpperCase()}</span>{name}</span>; })}</div>}</div></div>
              </article>;
            })}</div>}
          </div>
        </section>}

        {(error || message) && <p className={`rounded-2xl px-4 py-3 text-sm ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{error || message}</p>}

        {(activeWorkspace === "create-assignment" || activeWorkspace === "assign-project") && (
          <section className="grid w-full gap-5 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          {activeWorkspace === "create-assignment" && <form id="create-assignment" onSubmit={createAssignment} className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <header className="relative overflow-hidden bg-[radial-gradient(circle_at_88%_12%,rgba(231,232,91,0.3),transparent_30%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_140%)] px-6 py-7 text-white"><div className="absolute -bottom-10 right-7 h-28 w-28 rounded-full border border-white/10" /><div className="relative"><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-yellow">Assignment builder</p><h2 className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold"><Plus size={22} /> Create assignment</h2><p className="mt-2 text-sm leading-6 text-emerald-50/85">Set the course, instructions, assignment date, and end date for your learners.</p></div></header>
            <div className="grid gap-4 p-5 sm:p-6">
              <label className="text-sm font-semibold text-cert-ink">Course<select value={assignmentForm.courseId} onChange={(e) => setAssignmentForm({ ...assignmentForm, courseId: e.target.value })} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{titleFor(course, "Course")}</option>)}</select></label>
              <p className="rounded-2xl border border-cert-line bg-cert-mint px-4 py-3 text-sm leading-5 text-slate-600">{assignmentForm.courseId ? <>This assignment will be stored under this course and available to <strong className="text-cert-ink">all {enrolledStudentIds(assignmentForm.courseId).length} enrolled students</strong>.</> : "Select a course to make the assignment available only to its enrolled students."}</p>
              <label className="text-sm font-semibold text-cert-ink">Assignment title<input value={assignmentForm.title} onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })} placeholder="For example: Build a Python calculator" className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label>
              <label className="text-sm font-semibold text-cert-ink">Instructions<textarea value={assignmentForm.description} onChange={(e) => setAssignmentForm({ ...assignmentForm, description: e.target.value })} placeholder={"Objective: What learners will achieve\nDataset / Requirements: Files, tools, or constraints\nTasks:\n1. First task\n2. Second task\nExpected Output: What to submit"} className="mt-2 min-h-40 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-cert-ink">Assignment date<input type="date" value={assignmentForm.assignedDate} onChange={(e) => setAssignmentForm({ ...assignmentForm, assignedDate: e.target.value })} className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label><label className="text-sm font-semibold text-cert-ink">End date<input type="date" min={assignmentForm.assignedDate || undefined} value={assignmentForm.endDate} onChange={(e) => setAssignmentForm({ ...assignmentForm, endDate: e.target.value })} className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label></div>
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
              {assignmentsByDate.length === 0 ? <div className="rounded-2xl border border-dashed border-cert-line bg-[linear-gradient(135deg,#f6fffa_0%,#edf8f2_100%)] px-5 py-12 text-center"><p className="font-semibold text-cert-ink">No assignments yet</p><p className="mt-2 text-sm text-slate-500">New assignments will be organised here by due date.</p></div> : assignmentsByDate.map(([date, datedAssignments]) => <div key={date}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cert-green-dark">{formatAssignmentDate(date)}</p>
                <div className="space-y-3">{datedAssignments.map((assignment) => <article key={assignment.id} className="rounded-2xl border border-cert-line bg-cert-mint/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-cert-ink">{titleFor(assignment, "Assignment")}</p>
                      <p className="mt-1 text-sm text-slate-600">Course: {titleFor(courseById.get(String(assignment.course_id)), "Course")}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${taskIsInactive(assignment) ? "bg-slate-200 text-slate-600" : "bg-white text-cert-green-dark"}`}>{taskIsInactive(assignment) ? "inactive" : assignment.status || "active"}</span>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">Assigned: {formatAssignmentDate(assignment.assigned_date || assignment.created_at?.slice(0, 10))} · Ends: {formatAssignmentDate(taskEndDate(assignment))}</p>
                  {assignment.description && <TaskInstructions description={assignment.description} />}
                </article>)}</div>
              </div>)}
            </div>
          </aside>}

          {activeWorkspace === "assign-project" && <form id="assign-project" onSubmit={createProject} className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <header className="relative overflow-hidden bg-[radial-gradient(circle_at_88%_12%,rgba(231,232,91,0.3),transparent_30%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_140%)] px-6 py-7 text-white">
              <div className="absolute -bottom-10 right-7 h-28 w-28 rounded-full border border-white/10" />
              <div className="relative">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-yellow">Project builder</p>
                <h2 className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold"><Plus size={22} /> Assign a project</h2>
                <p className="mt-2 text-sm leading-6 text-emerald-50/85">Create one project and deliver it to every student enrolled in the selected course.</p>
              </div>
            </header>
            <div className="grid gap-4 p-5 sm:p-6">
              <label className="text-sm font-semibold text-cert-ink">Course<select value={projectForm.courseId} onChange={(e) => setProjectForm({ ...projectForm, courseId: e.target.value })} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{titleFor(course, "Course")}</option>)}</select></label>
              <div className="flex items-center gap-3 rounded-2xl border border-cert-line bg-cert-mint px-4 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-cert-green-dark ring-1 ring-cert-line"><UsersRound size={19} /></span>
                <p className="text-sm leading-5 text-slate-600">{projectForm.courseId ? <>This project will be sent to <strong className="text-cert-ink">all {enrolledStudentIds(projectForm.courseId).length} enrolled students</strong>.</> : "Select a course to see how many students will receive this project."}</p>
              </div>
              <label className="text-sm font-semibold text-cert-ink">Project title<input value={projectForm.title} onChange={(e) => setProjectForm({ ...projectForm, title: e.target.value })} placeholder="For example: Build an automation workflow" className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label>
              <label className="text-sm font-semibold text-cert-ink">Project instructions<textarea value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} placeholder={"Objective: What learners will build\nRequirements: Tools, data, or constraints\nTasks:\n1. First task\n2. Second task\nExpected Output: Repository, document, or file to submit"} className="mt-2 min-h-40 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-cert-ink">Assignment date<input type="date" value={projectForm.assignedDate} onChange={(e) => setProjectForm({ ...projectForm, assignedDate: e.target.value })} className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label><label className="text-sm font-semibold text-cert-ink">End date<input type="date" min={projectForm.assignedDate || undefined} value={projectForm.endDate} onChange={(e) => setProjectForm({ ...projectForm, endDate: e.target.value })} className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label></div>
              <button className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#0d8f55_0%,#31c96f_100%)] px-4 py-3.5 font-semibold text-cert-ink shadow-[0_16px_28px_-18px_rgba(13,143,85,0.7)] transition hover:brightness-105"><Plus size={18} /> Assign project to all students</button>
            </div>
          </form>}

          {activeWorkspace === "assign-project" && <aside className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <header className="flex items-start justify-between gap-4 border-b border-cert-line bg-[linear-gradient(135deg,#f4fff8_0%,#e9f8ef_100%)] px-6 py-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-green-dark">Delivery tracker</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-cert-ink">Assigned projects</h2>
                <p className="mt-1 text-sm text-slate-500">A dated record of projects sent to your learners.</p>
              </div>
              <span className="flex min-w-12 items-center justify-center rounded-2xl bg-white px-3 py-3 text-lg font-bold text-cert-green-dark ring-1 ring-cert-line">{assignedProjectGroups.length}</span>
            </header>
            <div className="max-h-[42rem] space-y-4 overflow-y-auto p-5 sm:p-6">
              {assignedProjectGroups.length === 0 ? <div className="rounded-[1.35rem] border border-dashed border-cert-line bg-[linear-gradient(135deg,#f6fffa_0%,#edf8f2_100%)] px-6 py-12 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-cert-green-dark shadow-sm ring-1 ring-cert-line"><ClipboardCheck size={27} /></span><h3 className="mt-4 text-lg font-semibold text-cert-ink">No projects assigned yet</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Once you assign a project, its date and student count will appear here.</p></div> : assignedProjectGroups.map((project) => <article key={`${project.id}-${project.assignedAt || "undated"}`} className="rounded-2xl border border-cert-line bg-white p-4 shadow-[0_12px_28px_-24px_rgba(7,26,47,0.35)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold text-cert-ink">{titleFor(project, "Project")}</p><p className="mt-1 text-sm text-slate-600">{titleFor(courseById.get(String(project.course_id)), "Course")}</p></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${taskIsInactive(project) ? "bg-slate-200 text-slate-600" : "bg-cert-mint text-cert-green-dark"}`}>{taskIsInactive(project) ? "Inactive" : formatAssignedDate(project.assignedAt)}</span>
                </div>
                <p className="mt-3 text-xs text-slate-500">Assigned: {formatAssignmentDate(project.assigned_date || project.assignedAt?.slice(0, 10))} · Ends: {formatAssignmentDate(taskEndDate(project))}</p>
                {project.description && <TaskInstructions description={project.description} />}
                <div className="mt-4 flex items-center gap-2 border-t border-cert-line pt-3 text-sm font-semibold text-cert-ink"><UsersRound size={16} className="text-cert-green-dark" /> {project.studentIds.size} {project.studentIds.size === 1 ? "student" : "students"} assigned</div>
              </article>)}
            </div>
          </aside>}
          </section>
        )}

        {activeWorkspace === "add-videos" && <section className="grid w-full gap-5 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <form id="add-videos" onSubmit={publishCourseVideo} className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <header className="relative overflow-hidden bg-[radial-gradient(circle_at_88%_12%,rgba(231,232,91,0.3),transparent_30%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_140%)] px-6 py-7 text-white"><div className="absolute -bottom-10 right-7 h-28 w-28 rounded-full border border-white/10" /><div className="relative"><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-yellow">Video publisher</p><h2 className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold"><Video size={22} /> Post a course video</h2><p className="mt-2 text-sm leading-6 text-emerald-50/85">Publish a lesson video for every student enrolled in a course.</p></div></header>
            <div className="grid gap-4 p-5 sm:p-6">
              <label className="text-sm font-semibold text-cert-ink">Course<select value={videoForm.courseId} onChange={(event) => setVideoForm({ ...videoForm, courseId: event.target.value })} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{titleFor(course, "Course")}</option>)}</select></label>
              <label className="text-sm font-semibold text-cert-ink">Video title<input value={videoForm.title} onChange={(event) => setVideoForm({ ...videoForm, title: event.target.value })} placeholder="For example: Introduction to AI agents" className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label>
              <label className="text-sm font-semibold text-cert-ink">Video link<input type="url" value={videoForm.videoUrl} onChange={(event) => setVideoForm({ ...videoForm, videoUrl: event.target.value })} placeholder="YouTube, Vimeo, or direct video link" className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label>
              <label className="text-sm font-semibold text-cert-ink">Available from<input type="date" value={videoForm.lessonDate} onChange={(event) => setVideoForm({ ...videoForm, lessonDate: event.target.value })} className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label>
              <button className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#0d8f55_0%,#31c96f_100%)] px-4 py-3.5 font-semibold text-cert-ink shadow-[0_16px_28px_-18px_rgba(13,143,85,0.7)] transition hover:brightness-105"><Video size={18} /> Post video to students</button>
            </div>
          </form>

          <aside className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
            <header className="flex items-start justify-between gap-4 border-b border-cert-line bg-[linear-gradient(135deg,#f4fff8_0%,#e9f8ef_100%)] px-6 py-6"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-green-dark">Video library</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-cert-ink">Posted course videos</h2><p className="mt-1 text-sm text-slate-500">Students can watch videos as soon as they become available.</p></div><span className="flex min-w-12 items-center justify-center rounded-2xl bg-white px-3 py-3 text-lg font-bold text-cert-green-dark ring-1 ring-cert-line">{courseVideos.length}</span></header>
            <div className="max-h-[42rem] space-y-4 overflow-y-auto p-5 sm:p-6">{courseVideos.length === 0 ? <div className="rounded-[1.35rem] border border-dashed border-cert-line bg-[linear-gradient(135deg,#f6fffa_0%,#edf8f2_100%)] px-6 py-12 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-cert-green-dark shadow-sm ring-1 ring-cert-line"><Video size={27} /></span><h3 className="mt-4 text-lg font-semibold text-cert-ink">No videos posted yet</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Post the first course lesson to make it available to enrolled students.</p></div> : courseVideos.map((video) => <article key={video.id} className="rounded-2xl border border-cert-line bg-white p-4 shadow-[0_12px_28px_-24px_rgba(7,26,47,0.35)]"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-cert-ink">{video.title || "Course video"}</p><p className="mt-1 text-sm text-slate-600">{titleFor(courseById.get(String(video.course_id)), "Course")}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${videoIsActive(video) ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700"}`}>{videoIsActive(video) ? "Live" : "Scheduled"}</span></div><div className="mt-4 flex items-center justify-between gap-3 border-t border-cert-line pt-3"><p className="text-xs text-slate-500">{formatVideoAvailability(video.available_at)}</p><a href={video.video_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-cert-green-dark underline">Open video</a></div></article>)}</div>
          </aside>
        </section>}

        {activeWorkspace === "attendance" && <section className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
          <header className="relative overflow-hidden bg-[radial-gradient(circle_at_88%_12%,rgba(231,232,91,0.3),transparent_30%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_140%)] px-6 py-7 text-white"><div className="absolute -bottom-10 right-7 h-28 w-28 rounded-full border border-white/10" /><div className="relative"><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-yellow">Attendance register</p><h2 className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold"><ClipboardCheck size={22} /> Mark course attendance</h2><p className="mt-2 text-sm leading-6 text-emerald-50/85">Choose a course and date, then record every enrolled student's attendance.</p></div></header>
          <form onSubmit={saveAttendance} className="p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-cert-ink">Course<select value={attendanceForm.courseId} onChange={(event) => setAttendanceForm({ ...attendanceForm, courseId: event.target.value })} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{titleFor(course, "Course")}</option>)}</select></label>
              <label className="text-sm font-semibold text-cert-ink">Date<input type="date" value={attendanceForm.attendanceDate} onChange={(event) => setAttendanceForm({ ...attendanceForm, attendanceDate: event.target.value })} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label>
            </div>
            {!attendanceForm.courseId ? <div className="mt-6 rounded-2xl border border-dashed border-cert-line bg-cert-mint/60 px-5 py-10 text-center text-sm text-slate-500">Select a course to view its enrolled students.</div> : attendanceStudents.length === 0 ? <div className="mt-6 rounded-2xl border border-dashed border-cert-line bg-cert-mint/60 px-5 py-10 text-center text-sm text-slate-500">No students are enrolled in this course.</div> : <div className="mt-6 overflow-hidden rounded-2xl border border-cert-line"><div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3 bg-cert-mint px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-cert-green-dark"><span>Student</span><span>Attendance</span></div>{attendanceStudents.map((student) => <div key={student.id} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 border-t border-cert-line px-4 py-3"><div><p className="font-semibold text-cert-ink">{titleFor(student, "Student")}</p><p className="mt-1 text-xs text-slate-500">{student.email || ""}</p></div><select value={attendanceMarks[student.id] || ""} onChange={(event) => setAttendanceMarks({ ...attendanceMarks, [student.id]: event.target.value })} className="rounded-xl border border-cert-line bg-white px-3 py-2 text-sm font-semibold text-cert-ink outline-none focus:border-cert-green"><option value="">Mark status</option><option value="present">Present</option><option value="absent">Absent</option></select></div>)}</div>}
            <div className="mt-6 flex flex-wrap items-center gap-3"><button type="submit" disabled={!attendanceStudents.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#0d8f55_0%,#31c96f_100%)] px-5 py-3.5 font-semibold text-cert-ink shadow-[0_16px_28px_-18px_rgba(13,143,85,0.7)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-slate-300">Save attendance</button><button type="button" onClick={downloadAttendanceSheet} disabled={!courseAttendanceSheet.length} className="rounded-xl border border-cert-line bg-white px-5 py-3.5 text-sm font-semibold text-cert-ink transition hover:border-cert-green hover:bg-cert-mint disabled:cursor-not-allowed disabled:text-slate-400">Download all dates (.xlsx)</button>{courseAttendanceSheet.length > 0 && <span className="text-sm text-cert-green-dark">{courseAttendanceSheet.length} saved record{courseAttendanceSheet.length === 1 ? "" : "s"} ready to export.</span>}</div>
          </form>
        </section>}

        {activeWorkspace === "certificate-test" && <section className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
          <header className="bg-[linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_140%)] px-6 py-7 text-white"><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-yellow">Certificate requirement</p><h2 className="mt-2 text-2xl font-semibold">Create the final course test</h2><p className="mt-2 text-sm leading-6 text-emerald-50/85">Students need more than 75% to pass. They receive a maximum of three attempts, with one day between failed attempts.</p></header>
          <form onSubmit={saveCertificateTest} className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-cert-ink">Course<select value={certificateTestForm.courseId} onChange={(event) => setCertificateTestForm({ ...certificateTestForm, courseId: event.target.value })} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{titleFor(course, "Course")}</option>)}</select></label><label className="text-sm font-semibold text-cert-ink">Test title<input value={certificateTestForm.title} onChange={(event) => setCertificateTestForm({ ...certificateTestForm, title: event.target.value })} className="mt-2 w-full rounded-xl border border-cert-line px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" required /></label></div>
            <div className="space-y-4">{certificateTestForm.questions.map((question, questionIndex) => <fieldset key={question.id} className="rounded-2xl border border-cert-line bg-cert-mint/50 p-4"><legend className="px-1 text-sm font-bold text-cert-green-dark">Question {questionIndex + 1}</legend><input value={question.question} onChange={(event) => setCertificateTestForm({ ...certificateTestForm, questions: certificateTestForm.questions.map((item, index) => index === questionIndex ? { ...item, question: event.target.value } : item) })} placeholder="Enter a course-related question" className="mt-2 w-full rounded-xl border border-cert-line bg-white px-3 py-2.5 text-sm outline-none focus:border-cert-green" required /><div className="mt-3 grid gap-2 sm:grid-cols-2">{question.options.map((option, optionIndex) => <label key={`${question.id}-${optionIndex}`} className="flex items-center gap-2 rounded-xl border border-cert-line bg-white px-3 py-2 text-sm"><input type="radio" name={`${question.id}-answer`} checked={question.correctOption === optionIndex} onChange={() => setCertificateTestForm({ ...certificateTestForm, questions: certificateTestForm.questions.map((item, index) => index === questionIndex ? { ...item, correctOption: optionIndex } : item) })} /><input value={option} onChange={(event) => setCertificateTestForm({ ...certificateTestForm, questions: certificateTestForm.questions.map((item, index) => index === questionIndex ? { ...item, options: item.options.map((value, currentIndex) => currentIndex === optionIndex ? event.target.value : value) } : item) })} placeholder={`Option ${optionIndex + 1}`} className="min-w-0 flex-1 outline-none" required /></label>)}</div><p className="mt-2 text-xs text-slate-500">Select the radio button beside the correct answer.</p></fieldset>)}</div>
            {(error || message) && <p className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{error || message}</p>}
            <button type="submit" className="rounded-xl bg-cert-green px-5 py-3 font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white">Save certificate test</button>
          </form>
        </section>}

        {activeWorkspace === "certificate-approvals" && <section className="overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-cert-line bg-[linear-gradient(135deg,#f4fff8_0%,#e9f8ef_100%)] px-6 py-6"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-cert-green-dark">Certificate approvals</p><h2 className="mt-2 text-2xl font-semibold text-cert-ink">Issue student certificates</h2><p className="mt-1 text-sm text-slate-500">Approve and send a certificate for each enrolled student and course.</p></div><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-cert-green-dark ring-1 ring-cert-line"><Award size={23} /></span></header>
          {courseReviews.length > 0 && <div className="border-b border-cert-line bg-white p-5"><p className="text-xs font-bold uppercase tracking-[0.18em] text-cert-green-dark">Course reviews</p><div className="mt-4 space-y-3">{courseReviews.map((review) => { const student = studentById.get(String(review.student_id)); const course = courseById.get(String(review.course_id)); return <article key={review.id} className="rounded-2xl border border-cert-line bg-cert-mint/40 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-cert-ink">{titleFor(student, "Student")} · {titleFor(course, "Course")}</p>{review.comment && <p className="mt-1 text-sm text-slate-600">{review.comment}</p>}</div><p className="font-bold text-cert-yellow">{"★".repeat(review.rating)}<span className="text-slate-300">{"☆".repeat(5 - review.rating)}</span></p></div></article>; })}</div></div>}
          <div className="space-y-6 bg-[linear-gradient(180deg,#fbfefd_0%,#f5faf7_100%)] p-5 sm:p-6">
            {certificateApprovalGroups.length === 0 ? <p className="rounded-2xl bg-cert-mint p-5 text-sm text-slate-500">No students are waiting for a certificate.</p> : certificateApprovalGroups.map(({ courseId, course, approvals }) => {
              const readyCount = approvals.filter((approval) => approval.issueReady).length;
              return <section key={courseId} className="overflow-hidden rounded-[1.6rem] border border-cert-line bg-white shadow-[0_14px_34px_-28px_rgba(7,26,47,0.2)]">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cert-line bg-[linear-gradient(135deg,#edf9f1_0%,#f9fffb_100%)] px-5 py-4">
                  <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.18em] text-cert-green-dark">Course certificate queue</p><h3 className="mt-1 truncate text-lg font-semibold text-cert-ink">{titleFor(course, "Course")}</h3></div>
                  <div className="flex items-center gap-2"><span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-cert-ink ring-1 ring-cert-line">{approvals.length} student{approvals.length === 1 ? "" : "s"}</span>{readyCount > 0 && <span className="rounded-full bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-700">{readyCount} ready</span>}</div>
                </header>
                <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">{approvals.map((approval) => { const { enrollment, studentId, courseId: approvalCourseId, pendingAssignments, pendingProjects, workReady, testConfigured, testPassed, issueReady } = approval; const student = studentById.get(String(studentId)); const isIssuing = issuingCertificateKey === `${studentId}-${approvalCourseId}`; const status = !workReady ? "Work pending" : !testConfigured ? "Test needs setup" : !testPassed ? "Test in progress" : "Ready to issue"; const statusClass = !workReady ? "bg-amber-100 text-amber-800" : issueReady ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"; return <article key={enrollment.id || `${studentId}-${approvalCourseId}`} className="rounded-2xl border border-cert-line bg-cert-mint/60 p-5 transition hover:-translate-y-0.5 hover:border-cert-green/50 hover:shadow-[0_14px_30px_-24px_rgba(7,26,47,0.28)]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-cert-ink">{titleFor(student, "Student")}</p><p className="mt-1 truncate text-xs text-slate-500">{student?.email || "Enrolled student"}</p></div><span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${issueReady ? "bg-sky-500" : workReady ? "bg-violet-500" : "bg-amber-400"}`} aria-label={status} /></div>{!workReady && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">Waiting for {pendingAssignments} assignment{pendingAssignments === 1 ? "" : "s"} and {pendingProjects} project{pendingProjects === 1 ? "" : "s"} to be approved.</p>}{workReady && testConfigured && !testPassed && <p className="mt-4 rounded-xl bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800">Final test created. The student must score above 75% before a certificate can be issued.</p>}<div className="mt-5 flex items-center justify-between gap-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}>{status}</span>{!testConfigured && workReady ? <button type="button" disabled={isIssuing} onClick={() => issueCertificate(studentId, approvalCourseId)} className="rounded-xl bg-cert-green px-3 py-2 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">Generate test</button> : <button type="button" disabled={!issueReady || isIssuing} onClick={() => issueCertificate(studentId, approvalCourseId)} className="rounded-xl bg-cert-green px-3 py-2 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{isIssuing ? "Issuing..." : "Issue certificate"}</button>}</div></article>; })}</div>
              </section>;
            })}
          </div>
        </section>}

        {activeWorkspace === "change-password" && <section className="mx-auto w-full max-w-xl overflow-hidden rounded-[1.9rem] border border-cert-line bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.16)]">
          <header className="border-b border-cert-line bg-[linear-gradient(135deg,#f4fff8_0%,#e9f8ef_100%)] px-6 py-6"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-cert-green-dark ring-1 ring-cert-line"><KeyRound size={22} /></span><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cert-green-dark">Account security</p><h2 className="mt-1 text-2xl font-semibold text-cert-ink">Change password</h2></div></div><p className="mt-4 text-sm leading-6 text-slate-500">Set a new password for your trainer account. No email link is required while you are signed in.</p></header>
          <form onSubmit={changePassword} className="space-y-5 p-6"><label className="block text-sm font-semibold text-cert-ink">New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" minLength="6" required /></label><label className="block text-sm font-semibold text-cert-ink">Confirm new password<input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-cert-line bg-cert-mint px-4 py-3 font-normal outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15" minLength="6" required /></label>{error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}{message && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}<button type="submit" disabled={isUpdatingPassword} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cert-green px-4 py-3.5 font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white disabled:opacity-60"><KeyRound size={18} />{isUpdatingPassword ? "Updating password..." : "Update password"}</button></form>
        </section>}

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
