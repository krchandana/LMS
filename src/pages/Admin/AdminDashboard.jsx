import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Award,
  ChartNoAxesColumn,
  ClipboardList,
  Clock3,
  GraduationCap,
  Link2,
  LogOut,
  ShieldCheck,
  UserCheck,
  UsersRound,
  Video,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { supabase } from "../../lib/supabaseClient";

const tabs = [
  { key: "overview", label: "Overview", path: "/admin", icon: ShieldCheck },
  { key: "requests", label: "Requests", path: "/admin/requests", icon: ClipboardList },
  { key: "trainers", label: "Trainers", path: "/admin/trainers", icon: UsersRound },
  { key: "students", label: "Students", path: "/admin/students", icon: GraduationCap },
  { key: "courses", label: "Courses", path: "/admin/courses" },
  { key: "mapping", label: "Mapping", path: "/admin/mapping", icon: Link2 },
  { key: "certificates", label: "Certificates", path: "/admin/certificates", icon: Award },
  { key: "analytics", label: "Analytics", path: "/admin/analytics", icon: ChartNoAxesColumn },
];

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const hasServiceRoleKey = Boolean(supabaseUrl && serviceRoleKey);

const missingTable = (error) => {
  const message = (error?.message || "").toLowerCase();
  return (
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
};

const removeMissingColumn = (payload, error) => {
  const message = error?.message || "";
  const match = message.match(/column \"([^\"]+)\"/i) || message.match(/'([^']+)' column/i);
  if (!match) return null;
  const key = match[1];
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return null;
  const next = { ...payload };
  delete next[key];
  return next;
};

const getDbErrorMessage = (error, fallbackMessage) => {
  const message = (error?.message || "").toLowerCase();
  const details = (error?.details || "").toLowerCase();
  const hint = (error?.hint || "").toLowerCase();

  if (error?.code === "42501" || message.includes("row-level security")) {
    return "Permission denied by Supabase RLS. Add an INSERT policy for authenticated users on courses.";
  }

  if (message.includes("stack depth limit exceeded") || details.includes("stack depth limit exceeded")) {
    return "Supabase policy recursion detected (stack depth limit exceeded). Check RLS policies/triggers for recursive rules.";
  }

  if (message.includes("could not find the table") || message.includes("relation") && message.includes("does not exist")) {
    return "Required table is missing in Supabase.";
  }

  if (hint) return error?.message || fallbackMessage;
  return error?.message || fallbackMessage;
};

const isStackDepthError = (error) => {
  const message = (error?.message || "").toLowerCase();
  const details = (error?.details || "").toLowerCase();
  return message.includes("stack depth limit exceeded") || details.includes("stack depth limit exceeded");
};

const safeInsert = async (table, payload) => {
  let nextPayload = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(nextPayload).select().single();
    if (!error) return { data };
    if (missingTable(error)) return { skipped: true };
    const stripped = removeMissingColumn(nextPayload, error);
    if (!stripped) return { error };
    nextPayload = stripped;
  }
  return { error: { message: "Unable to save record." } };
};

const safeUpsert = async (table, payload, onConflict = "id") => {
  let nextPayload = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from(table).upsert(nextPayload, { onConflict }).select().single();
    if (!error) return { data };
    if (missingTable(error)) return { skipped: true };
    const stripped = removeMissingColumn(nextPayload, error);
    if (!stripped) return { error };
    nextPayload = stripped;
  }
  return { error: { message: "Unable to save record." } };
};

const safeUpdate = async (table, id, payload) => {
  let nextPayload = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from(table).update(nextPayload).eq("id", id).select().single();
    if (!error) return { data };
    if (missingTable(error)) return { skipped: true };
    const stripped = removeMissingColumn(nextPayload, error);
    if (!stripped) return { error };
    nextPayload = stripped;
  }
  return { error: { message: "Unable to update record." } };
};

const missingColumn = (error) => {
  const message = (error?.message || "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
};

const safeDelete = async (table, column, value) => {
  const { data, error } = await supabase.from(table).delete().eq(column, value).select("id");
  if (!error) {
    const deleted = Array.isArray(data) ? data.length : (data ? 1 : 0);
    if (deleted > 0 || !hasServiceRoleKey) return { data, deleted };
    // If RLS prevented deletion, try service role delete when available.
    const serviceResult = await serviceRoleDelete(table, column, value);
    if (!serviceResult.error) {
      return { data: serviceResult.data, deleted: serviceResult.deleted };
    }
    return { data, deleted };
  }
  if (missingTable(error) || missingColumn(error)) return { skipped: true };
  return { error };
};

const serviceRoleAuthRequest = async (path, method, body) => {
  if (!hasServiceRoleKey) return { error: { message: "Service role key is not configured." } };

  const response = await fetch(`${supabaseUrl}/auth/v1/admin${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return response.ok ? { data } : { error: data };
};

const getAuthErrorMessage = (error, fallback = "Unable to create trainer login account.") => {
  const code = (error?.error_code || error?.code || "").toString().toLowerCase();
  const message = (error?.msg || error?.message || error?.error_description || "").toString();
  const lowered = message.toLowerCase();

  if (code === "email_exists" || lowered.includes("already been registered") || lowered.includes("already registered")) {
    return "This email is already registered in Supabase Auth. Use a different email for trainer creation.";
  }

  if (code === "weak_password" || lowered.includes("password")) {
    return message || "Password does not meet Supabase Auth requirements.";
  }

  return message || fallback;
};

const createTrainerAuthUser = async ({ email, password, fullName, status, trainerReferenceId }) => {
  if (hasServiceRoleKey) {
    const createResult = await serviceRoleAuthRequest("/users", "POST", {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: "trainer",
        status,
        trainer_reference_id: trainerReferenceId,
      },
    });

    if (!createResult.error) {
      const nextUser = createResult.data?.user || createResult.data;
      return { data: nextUser };
    }

    // Never reuse an existing Auth account here. Reusing it can convert a
    // student or the first trainer into the new trainer by mistake.
    return { error: createResult.error || { message: "Unable to create trainer auth user." } };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: "trainer",
        status,
        trainer_reference_id: trainerReferenceId,
      },
    },
  });

  if (error) return { error };
  if (!data?.user?.id) return { error: { message: "Auth user was not created. Check Supabase auth settings." } };
  return { data: data.user };
};

const sendTrainerCredentialsEmail = async ({ email, name, password, trainerId, loginUrl }) => {
  const safeEmail = (email || "").trim();
  if (!safeEmail || safeEmail.endsWith("@trainer.local")) return { skipped: true };

  const { error } = await supabase.functions.invoke("send-trainer-email", {
    body: {
      email: safeEmail,
      name,
      password,
      trainerId,
      loginUrl,
    },
  });

  if (error) return { error };
  return { ok: true };
};

const normalizeStudentId = (studentId) => {
  const id = String(studentId || "").trim().toUpperCase();
  if (!id) return "";
  return id.startsWith("STU") ? id : `STU${id}`;
};

const studentAuthEmailFor = (studentId) => `${normalizeStudentId(studentId).toLowerCase()}@student.local`;
const nextStudentLoginId = async () => {
  const { data, error } = await supabase.rpc("next_student_login_id");
  if (error || typeof data !== "string" || !data.trim()) {
    throw error || new Error("Unable to generate the next student ID.");
  }
  return data.trim();
};

const generateStudentPassword = () => `Stud@${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 90)}`;

const generateTrainerPassword = () => {
  const words = [
    "bright",
    "calm",
    "clear",
    "daily",
    "dawn",
    "fresh",
    "gentle",
    "green",
    "happy",
    "jolly",
    "light",
    "mellow",
    "neat",
    "noble",
    "open",
    "quiet",
    "silver",
    "smart",
    "steady",
    "sunny",
    "tiger",
    "warm",
    "wise",
    "young",
  ];

  const picked = [];
  while (picked.length < 7) {
    const word = words[Math.floor(Math.random() * words.length)];
    if (!picked.includes(word)) picked.push(word);
  }

  return picked.join(" ");
};

const nextTrainerReferenceId = async () => {
  const { data, error } = await supabase.rpc("next_trainer_reference_id");
  if (error || typeof data !== "string" || !data.trim()) {
    throw error || new Error("Unable to generate the next trainer ID.");
  }
  return data.trim();
};

const sendStudentApprovalEmail = async ({ email, name, studentId, password }) => {
  const safeEmail = (email || "").trim();
  if (!safeEmail) return { error: { message: "Student email is missing." } };

  const { error } = await supabase.functions.invoke("send-email", {
    body: {
      email: safeEmail,
      name,
      studentId,
      password,
    },
  });

  if (error) return { error };
  return { ok: true };
};

const findProfileByEmail = async (email) => {
  const safeEmail = (email || "").trim();
  if (!safeEmail) return { data: null };

  if (hasServiceRoleKey) {
    const result = await serviceRoleTableRequest(
      "profiles",
      `?select=*&email=eq.${encodeURIComponent(safeEmail)}&limit=1`,
      "GET"
    );

    if (result.error) return result;
    return { data: Array.isArray(result.data) ? (result.data[0] || null) : result.data };
  }

  const { data, error } = await supabase.from("profiles").select("*").eq("email", safeEmail).maybeSingle();
  if (error) return { error };
  return { data: data || null };
};

const serviceRoleTableRequest = async (table, path, method, body, extraHeaders = {}) => {
  if (!hasServiceRoleKey) return { error: { message: "Service role key is not configured." } };

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return response.ok ? { data } : { error: data };
};

const serviceRoleDelete = async (table, column, value) => {
  if (!hasServiceRoleKey) return { skipped: true };
  const path = `?${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`;
  const result = await serviceRoleTableRequest(table, path, "DELETE");
  if (result.error) return { error: result.error };
  const deleted = Array.isArray(result.data) ? result.data.length : 0;
  return { data: result.data, deleted };
};

const serviceRoleInsert = async (table, payload) => {
  if (!hasServiceRoleKey) return { skipped: true };
  const result = await serviceRoleTableRequest(table, "?select=*", "POST", payload);
  if (result.error) return { error: result.error };
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  return { data };
};

const serviceRoleUpsert = async (table, payload, onConflict = "id") => {
  if (!hasServiceRoleKey) return { skipped: true };
  const path = `?on_conflict=${encodeURIComponent(onConflict)}&select=*`;
  const result = await serviceRoleTableRequest(table, path, "POST", payload);
  if (result.error) return { error: result.error };
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  return { data };
};

const insertWithServiceFallback = async (table, payload) => {
  let result = await safeInsert(table, payload);
  if ((result.skipped || result.error) && hasServiceRoleKey) {
    const serviceResult = await serviceRoleInsert(table, payload);
    if (!serviceResult.error) return serviceResult;
    if (result.skipped) return serviceResult;
  }
  return result;
};

const upsertWithServiceFallback = async (table, payload, onConflict = "id") => {
  let result = await safeUpsert(table, payload, onConflict);
  if ((result.skipped || result.error) && hasServiceRoleKey) {
    const serviceResult = await serviceRoleUpsert(table, payload, onConflict);
    if (!serviceResult.error) return serviceResult;
    if (result.skipped) return serviceResult;
  }
  return result;
};

const queryTableForStudent = async (table, studentId) => {
  const candidateColumns = ["profile_id", "student_id", "user_id", "id"];

  for (const column of candidateColumns) {
    try {
      const { data, error } = await supabase.from(table).select("id").eq(column, studentId).limit(1);
      if (!error && Array.isArray(data) && data.length > 0) {
        return true;
      }
      if (error) {
        if (missingTable(error)) return false;
        if (missingColumn(error)) continue;
        throw error;
      }
    } catch (error) {
      throw error;
    }
  }

  return false;
};

const queryTableForId = async (table, returnedId) => {
  try {
    const { data, error } = await supabase.from(table).select("id").eq("id", returnedId).limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      return true;
    }
    if (error) {
      if (missingTable(error)) return false;
      if (missingColumn(error)) return false;
      throw error;
    }
  } catch (error) {
    throw error;
  }

  return false;
};

const verifyMapping = async (studentId, returnedId = null) => {
  const mappingTables = ["enrollments", "student_courses", "students"];

  if (returnedId) {
    for (const table of mappingTables) {
      const exists = await queryTableForId(table, returnedId);
      if (exists) return true;
    }
  }

  for (const table of mappingTables) {
    const exists = await queryTableForStudent(table, studentId);
    if (exists) return true;
  }

  return false;
};

const fmtDate = (value) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString();
};

const courseDurationComplete = (course) => {
  const endDate = course?.end_date;
  if (!endDate) return false;
  const end = new Date(`${endDate}T23:59:59`);
  return !Number.isNaN(end.getTime()) && end.getTime() < Date.now();
};

const firstValue = (...values) => values.find((value) => value !== null && value !== undefined && value !== "");

export default function AdminDashboard() {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [approvalCredentials, setApprovalCredentials] = useState(null);

  const [requests, setRequests] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [studentRecords, setStudentRecords] = useState([]);
  const [studentCourseRows, setStudentCourseRows] = useState([]);
  const [enrollmentRows, setEnrollmentRows] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [courseVideos, setCourseVideos] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);

  const [trainerName, setTrainerName] = useState("");
  const [trainerEmail, setTrainerEmail] = useState("");
  const [trainerPassword, setTrainerPassword] = useState(generateTrainerPassword());
  const [trainerStatus, setTrainerStatus] = useState("active");
  const [trainerTable, setTrainerTable] = useState("profiles");

  const [courseTitle, setCourseTitle] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [courseDuration, setCourseDuration] = useState("");
  const [courseEndDate, setCourseEndDate] = useState("");
  const [courseStatus, setCourseStatus] = useState("active");
  const [insightQuery, setInsightQuery] = useState("");
  const [insightAnswer, setInsightAnswer] = useState("");

  const [mapStudentIds, setMapStudentIds] = useState([]);
  const [showStudentPicker, setShowStudentPicker] = useState(false);
  const [mapTrainerId, setMapTrainerId] = useState("");
  const [mapCourseId, setMapCourseId] = useState("");
  const [editingStudent, setEditingStudent] = useState(null);
  const [editStudentName, setEditStudentName] = useState("");
  const [editStudentStatus, setEditStudentStatus] = useState("active");

  const activeTab = location.pathname.endsWith("/requests")
    ? "requests"
    : location.pathname.endsWith("/trainers")
      ? "trainers"
      : location.pathname.endsWith("/students")
        ? "students"
        : location.pathname.endsWith("/courses")
          ? "courses"
          : location.pathname.endsWith("/mapping")
            ? "mapping"
    : location.pathname.endsWith("/certificates")
              ? "certificates"
              : location.pathname.endsWith("/insights")
                ? "insights"
            : location.pathname.endsWith("/analytics")
              ? "analytics"
              : location.pathname.endsWith("/admin")
                ? "overview"
                : "overview";

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      // Load data with individual error handling
      const requestsRes = await supabase
        .from("access_requests")
        .select("*")
        .eq("status", "pending")
        .limit(50);

      const profilePendingRes = requestsRes.error && missingTable(requestsRes.error)
        ? await supabase
            .from("profiles")
            .select("*")
            .eq("role", "student")
            .eq("status", "pending")
            .limit(50)
        : { data: [], error: null };

      const profilePendingServiceRes = requestsRes.error && missingTable(requestsRes.error) && hasServiceRoleKey
        ? await serviceRoleTableRequest(
            "profiles",
            "?select=*&role=eq.student&status=eq.pending&limit=50",
            "GET"
          )
        : { data: [], error: null };

      const authPendingRes = requestsRes.error && missingTable(requestsRes.error) && hasServiceRoleKey
        ? await serviceRoleAuthRequest("/users?page=1&per_page=1000", "GET")
        : { data: { users: [] }, error: null };

      const trainersRes = await supabase
        .from("profiles")
        .select("*")
        .eq("role", "trainer")
        .limit(200);

      // A restrictive profiles RLS policy can return only the current profile
      // without an error. Use the admin service query for this admin-only list
      // so every trainer remains available for mapping and management.
      const trainersServiceRes = hasServiceRoleKey
        ? await serviceRoleTableRequest(
            "profiles",
            "?select=*&role=eq.trainer&limit=200",
            "GET"
          )
        : { data: [], error: null };

      const studentsRes = await supabase
        .from("profiles")
        .select("*")
        .eq("role", "student")
        .limit(500);

      const studentsServiceRes = hasServiceRoleKey
        ? await serviceRoleTableRequest(
            "profiles",
            "?select=*&role=eq.student&limit=500",
            "GET"
          )
        : { data: [], error: null };

      const coursesRes = await supabase
        .from("courses")
        .select("*")
        .limit(300);

      const coursesServiceRes = hasServiceRoleKey
        ? await serviceRoleTableRequest("courses", "?select=*&limit=300", "GET")
        : { data: [], error: null };

      const assignmentsRes = await supabase
        .from("assignments")
        .select("*")
        .limit(2000);

      const assignmentsServiceRes = hasServiceRoleKey
        ? await serviceRoleTableRequest("assignments", "?select=*&limit=2000", "GET")
        : { data: [], error: null };

      const courseVideosRes = await supabase
        .from("course_videos")
        .select("*")
        .limit(2000);

      const courseVideosServiceRes = hasServiceRoleKey
        ? await serviceRoleTableRequest("course_videos", "?select=*&limit=2000", "GET")
        : { data: [], error: null };

      // Attendance is optional in older LMS databases. A missing table simply
      // leaves the attendance insight unavailable rather than breaking admin.
      const attendanceRes = await supabase
        .from("attendance")
        .select("*")
        .limit(5000);

      const attendanceServiceRes = hasServiceRoleKey
        ? await serviceRoleTableRequest("attendance", "?select=*&limit=5000", "GET")
        : { data: [], error: null };

      const studentRes = await supabase
        .from("students")
        .select("*")
        .limit(1000);

      const enrollmentRes = await supabase
        .from("enrollments")
        .select("*")
        .limit(1000);

      const enrollmentServiceRes = hasServiceRoleKey
        ? await serviceRoleTableRequest("enrollments", "?select=*&limit=1000", "GET")
        : { data: [], error: null };

      const studentCourseRes = await supabase
        .from("student_courses")
        .select("*")
        .limit(1000);

      const certificatesRes = await supabase
        .from("certificates")
        .select("*")
        .order("issue_date", { ascending: false })
        .limit(1000);

      const certificatesServiceRes = (hasServiceRoleKey && (certificatesRes.error || !(certificatesRes.data || []).length))
        ? await serviceRoleTableRequest("certificates", "?select=*&order=issue_date.desc&limit=1000", "GET")
        : { data: [], error: null };

      let nextRequests = (requestsRes.data || []).map((item) => ({ ...item, source: "access_requests" }));

      if (requestsRes.error && missingTable(requestsRes.error)) {
        const pendingProfiles = profilePendingRes.error
          ? []
          : (profilePendingRes.data || []);

        const pendingProfilesService = profilePendingServiceRes.error
          ? []
          : (Array.isArray(profilePendingServiceRes.data) ? profilePendingServiceRes.data : []);

        const pendingAuthUsers = authPendingRes.error
          ? []
          : (authPendingRes.data?.users || [])
              .filter((user) => {
                const role = (user?.user_metadata?.role || "").toLowerCase();
                const status = (user?.user_metadata?.status || "").toLowerCase();
                return role === "student" && status === "pending";
              })
              .map((user) => ({
                id: user.id,
                profile_id: user.id,
                user_id: user.id,
                full_name: user?.user_metadata?.full_name,
                name: user?.user_metadata?.full_name,
                email: user?.user_metadata?.registered_email || user.email,
                auth_email: user.email,
                student_id: user?.user_metadata?.student_id,
                student_login_id: user?.user_metadata?.student_id,
                role: "student",
                status: "pending",
                created_at: user?.created_at,
                source: "auth_pending",
              }));

        const merged = new Map();
        [...pendingProfiles, ...pendingProfilesService].forEach((item) => {
          const key = item.id || item.profile_id || item.user_id || item.email;
          if (!key) return;
          merged.set(key, { ...item, source: "profiles_pending" });
        });
        pendingAuthUsers.forEach((item) => {
          const key = item.id || item.profile_id || item.user_id || item.email;
          if (!key || merged.has(key)) return;
          merged.set(key, item);
        });

        nextRequests = Array.from(merged.values());
      }
      let nextTrainers = trainersRes.error ? [] : (trainersRes.data || []);
      let nextTrainerTable = "profiles";

      if (hasServiceRoleKey && !trainersServiceRes.error) {
        nextTrainers = Array.isArray(trainersServiceRes.data) ? trainersServiceRes.data : [];
        nextTrainerTable = "profiles";
      }

      if (trainersRes.error && missingTable(trainersRes.error)) {
        const fallbackTrainersRes = await supabase.from("trainers").select("*").limit(200);
        nextTrainers = fallbackTrainersRes.error ? [] : (fallbackTrainersRes.data || []);
        if (!fallbackTrainersRes.error) nextTrainerTable = "trainers";
      }
      const nextStudents = hasServiceRoleKey && !studentsServiceRes.error
        ? (Array.isArray(studentsServiceRes.data) ? studentsServiceRes.data : [])
        : studentsRes.error
        ? (studentsServiceRes.error ? [] : (Array.isArray(studentsServiceRes.data) ? studentsServiceRes.data : []))
        : ((studentsRes.data || []).length
        ? (studentsRes.data || [])
        : (studentsServiceRes.error ? [] : (Array.isArray(studentsServiceRes.data) ? studentsServiceRes.data : [])));
      const nextCourses = hasServiceRoleKey && !coursesServiceRes.error
        ? (Array.isArray(coursesServiceRes.data) ? coursesServiceRes.data : [])
        : (coursesRes.error ? [] : (coursesRes.data || []));
      const nextAssignments = hasServiceRoleKey && !assignmentsServiceRes.error
        ? (Array.isArray(assignmentsServiceRes.data) ? assignmentsServiceRes.data : [])
        : (assignmentsRes.error ? [] : (assignmentsRes.data || []));
      const nextCourseVideos = hasServiceRoleKey && !courseVideosServiceRes.error
        ? (Array.isArray(courseVideosServiceRes.data) ? courseVideosServiceRes.data : [])
        : (courseVideosRes.error ? [] : (courseVideosRes.data || []));
      const nextAttendanceRecords = hasServiceRoleKey && !attendanceServiceRes.error
        ? (Array.isArray(attendanceServiceRes.data) ? attendanceServiceRes.data : [])
        : (attendanceRes.error ? [] : (attendanceRes.data || []));
      const nextStudentRecords = studentRes.error ? [] : (studentRes.data || []);
      const nextEnrollmentRows = hasServiceRoleKey && !enrollmentServiceRes.error
        ? (Array.isArray(enrollmentServiceRes.data) ? enrollmentServiceRes.data : [])
        : enrollmentRes.error
        ? (enrollmentServiceRes.error ? [] : (Array.isArray(enrollmentServiceRes.data) ? enrollmentServiceRes.data : []))
        : ((enrollmentRes.data || []).length
          ? (enrollmentRes.data || [])
          : (enrollmentServiceRes.error ? [] : (Array.isArray(enrollmentServiceRes.data) ? enrollmentServiceRes.data : [])));
      const nextStudentCourseRows = nextEnrollmentRows.length ? nextEnrollmentRows : (studentCourseRes.error ? [] : (studentCourseRes.data || []));
      const nextCertificates = certificatesRes.error
        ? (certificatesServiceRes.error ? [] : (Array.isArray(certificatesServiceRes.data) ? certificatesServiceRes.data : []))
        : ((certificatesRes.data || []).length
          ? (certificatesRes.data || [])
          : (certificatesServiceRes.error ? [] : (Array.isArray(certificatesServiceRes.data) ? certificatesServiceRes.data : [])));

      setRequests(nextRequests);
      setTrainers(nextTrainers);
      setTrainerTable(nextTrainerTable);
      setStudents(nextStudents);
      setCourses(nextCourses);
      setStudentRecords(nextStudentRecords);
      setEnrollmentRows(nextEnrollmentRows);
      setStudentCourseRows(nextStudentCourseRows);
      setCertificates(nextCertificates);
      setAssignments(nextAssignments);
      setCourseVideos(nextCourseVideos);
      setAttendanceRecords(nextAttendanceRecords);
    } catch (err) {
      console.error("Data load error:", err);
      setError("Error loading data. Some tables may not exist.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // A student registration is created by an Edge Function, so this admin
    // page needs its own refresh signal rather than waiting for a navigation
    // or a manual browser reload. The interval is a fallback for projects
    // where the realtime publication has not been enabled yet.
    const refreshRequests = () => { loadData(); };
    const channel = supabase
      .channel("admin-access-request-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "access_requests" }, refreshRequests)
      .subscribe();
    const refreshTimer = window.setInterval(refreshRequests, 30000);

    return () => {
      window.clearInterval(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  const courseNameById = useMemo(
    () => new Map(courses.map((course) => [String(course.id), firstValue(course.title, course.name, course.course_name, "Untitled course")])),
    [courses]
  );

  const courseById = useMemo(
    () => new Map(courses.map((course) => [String(course.id), course])),
    [courses]
  );

  const trainerNameById = useMemo(
    () => new Map(trainers.map((trainer) => [String(trainer.id), firstValue(trainer.full_name, trainer.name, trainer.email, "Unknown trainer")])),
    [trainers]
  );

  const studentNameById = useMemo(() => {
    const names = new Map();
    [...students, ...studentRecords].forEach((student) => {
      const name = firstValue(student.full_name, student.name, student.email, "Student");
      [student.id, student.profile_id, student.user_id, student.student_id].filter(Boolean).forEach((id) => names.set(String(id), name));
    });
    return names;
  }, [students, studentRecords]);

  const studentRecordByProfile = useMemo(() => {
    const map = new Map();
    studentRecords.forEach((record) => {
      if (record.profile_id) map.set(String(record.profile_id), record);
      if (record.user_id) map.set(String(record.user_id), record);
      if (record.id) map.set(String(record.id), record);
    });
    return map;
  }, [studentRecords]);

  // A student can have more than one enrollment. Keep one record per
  // student-course pair instead of overwriting earlier courses in a Map.
  const enrollmentRecords = useMemo(() => {
    const recordsByPair = new Map();
    [...studentCourseRows, ...enrollmentRows].forEach((record) => {
      const studentId = firstValue(record.student_id, record.profile_id, record.user_id);
      const courseId = firstValue(record.course_id, record.course);
      if (!studentId || !courseId) return;
      recordsByPair.set(`${String(studentId)}::${String(courseId)}`, record);
    });
    return Array.from(recordsByPair.values());
  }, [studentCourseRows, enrollmentRows]);

  const enrollmentsByStudent = useMemo(() => {
    const map = new Map();
    enrollmentRecords.forEach((record) => {
      [record.student_id, record.profile_id, record.user_id]
        .filter(Boolean)
        .forEach((studentId) => {
          const key = String(studentId);
          const current = map.get(key) || [];
          if (!current.includes(record)) map.set(key, [...current, record]);
        });
    });
    return map;
  }, [enrollmentRecords]);

  const courseEnrollmentById = useMemo(() => {
    const map = new Map();
    const mappingRows = enrollmentRecords.length ? enrollmentRecords : studentRecords;
    mappingRows.forEach((record) => {
      if (record.course_id) map.set(String(record.course_id), (map.get(String(record.course_id)) || 0) + 1);
    });
    return map;
  }, [enrollmentRecords, studentRecords]);

  const trainerAssignmentsById = useMemo(() => {
    const map = new Map();
    const ensureTrainer = (trainerId) => {
      const key = String(trainerId);
      if (!map.has(key)) map.set(key, { courses: [], studentIds: new Set() });
      return map.get(key);
    };
    const courseByTrainer = new Map();

    courses.forEach((course) => {
      if (!course.trainer_id || !course.id) return;
      const trainerAssignment = ensureTrainer(course.trainer_id);
      trainerAssignment.courses.push(course);
      courseByTrainer.set(String(course.id), String(course.trainer_id));
    });

    [studentRecords, enrollmentRecords].forEach((records) => {
      records.forEach((record) => {
        const trainerId = record.trainer_id || courseByTrainer.get(String(record.course_id));
        const studentId = record.student_id || record.profile_id || record.user_id || record.id;
        if (trainerId && studentId) ensureTrainer(trainerId).studentIds.add(String(studentId));
      });
    });

    return map;
  }, [courses, studentRecords, enrollmentRecords]);

  const enrichedStudents = useMemo(
    () =>
      students.map((student) => {
        const studentIdentifiers = [student.id, student.profile_id, student.user_id, student.student_id, student.student_login_id]
          .filter(Boolean)
          .map(String);
        const matchingEnrollments = Array.from(
          new Map(
            studentIdentifiers
              .flatMap((studentId) => enrollmentsByStudent.get(studentId) || [])
              .map((record) => [
                `${String(firstValue(record.student_id, record.profile_id, record.user_id))}::${String(firstValue(record.course_id, record.course))}`,
                record,
              ])
          ).values()
        );
        const studentRecord = studentRecordByProfile.get(String(student.id));
        const courseIds = [...new Set([
          ...matchingEnrollments.map((record) => firstValue(record.course_id, record.course)),
          student.course_id,
          studentRecord?.course_id,
        ].filter(Boolean).map(String))];
        const enrolledCourses = courseIds.map((courseId) => {
          const enrollmentRecord = matchingEnrollments.find(
            (record) => String(firstValue(record.course_id, record.course)) === courseId
          );
          const course = courseById.get(courseId);
          const trainerId = firstValue(enrollmentRecord?.trainer_id, course?.trainer_id, student.trainer_id, studentRecord?.trainer_id);
          return {
            course_id: courseId,
            course_name: firstValue(
              enrollmentRecord?.course_name,
              course?.title,
              course?.name,
              course?.course_name,
              student.course_name,
              studentRecord?.course_name,
              "Untitled course"
            ),
            trainer_id: trainerId,
            trainer_name: firstValue(
              enrollmentRecord?.trainer_name,
              course?.trainer_name,
              trainerNameById.get(String(trainerId)),
              student.trainer_name,
              studentRecord?.trainer_name,
              "Unassigned"
            ),
          };
        });
        const primaryEnrollment = matchingEnrollments[0] || studentRecord;
        const primaryCourse = enrolledCourses[0];
        const courseId = primaryCourse?.course_id;
        const trainerId = primaryCourse?.trainer_id;
        const progress = Number(
          firstValue(primaryEnrollment?.completion_percent, primaryEnrollment?.progress_percent, studentRecord?.completion_percent, studentRecord?.progress_percent, student.completion_percent, 0)
        ) || 0;

        return {
          ...student,
          course_id: courseId,
          trainer_id: trainerId,
          student_id: firstValue(student.student_id, student.student_login_id, primaryEnrollment?.student_id, primaryEnrollment?.student_login_id, studentRecord?.student_id, studentRecord?.student_login_id),
          enrolled_courses: enrolledCourses,
          enrolled_course: enrolledCourses.length ? enrolledCourses.map((course) => course.course_name).join(", ") : "Unassigned",
          trainer_name: enrolledCourses.length ? [...new Set(enrolledCourses.map((course) => course.trainer_name))].join(", ") : "Unassigned",
          progress,
          certificate_ready: Boolean(
            student.certificate_ready ||
              primaryEnrollment?.certificate_ready ||
              studentRecord?.certificate_ready ||
              progress >= 100
          ),
        };
      }),
    [students, studentRecordByProfile, enrollmentsByStudent, courseById, trainerNameById]
  );

  const courseAssignments = useMemo(
    () =>
      courses.map((course) => ({
        ...course,
        course_name: firstValue(course.title, course.name, course.course_name, "Untitled course"),
        trainer_name: trainerNameById.get(String(course.trainer_id)) || "Unassigned",
        assigned_students: enrichedStudents.filter((student) =>
          student.enrolled_courses?.some((enrollment) => String(enrollment.course_id) === String(course.id))
        ),
      })),
    [courses, enrichedStudents, trainerNameById]
  );

  const unassignedStudentCount = useMemo(
    () => enrichedStudents.filter((student) => !student.enrolled_courses?.length).length,
    [enrichedStudents]
  );

  const metrics = useMemo(() => {
    const activeCourses = courses.filter((course) => (course.status || "active").toLowerCase() === "active").length;
    const mappedStudents = enrichedStudents.filter((student) =>
      student.enrolled_courses?.some((enrollment) => enrollment.trainer_name !== "Unassigned")
    ).length;
    const certificateReady = enrichedStudents.filter((student) => student.certificate_ready).length;
    const totalProgress = enrichedStudents.reduce((sum, student) => sum + (student.progress || 0), 0);
    const avgProgress = enrichedStudents.length ? Math.round(totalProgress / enrichedStudents.length) : 0;

    return {
      totalStudents: enrichedStudents.length,
      pendingApprovals: requests.length,
      activeCourses,
      totalTrainers: trainers.length,
      mappedStudents,
      certificateReady,
      avgProgress,
    };
  }, [courses, enrichedStudents, requests.length, trainers.length]);

  const monitoringInsights = useMemo(() => {
    const now = new Date();
    const activeStudents = enrichedStudents.filter((student) => (student.status || "active").toLowerCase() === "active");
    const overdueAssignments = assignments.filter((assignment) => {
      const dueValue = String(assignment.due_date || "");
      const dueDate = dueValue ? new Date(dueValue.includes("T") ? dueValue : `${dueValue}T23:59:59`) : null;
      const status = (assignment.status || "").toLowerCase();
      return dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < now && !["approved", "completed", "cancelled"].includes(status);
    });

    const attendanceByStudent = new Map();
    attendanceRecords.forEach((record) => {
      const studentId = firstValue(record.student_id, record.profile_id, record.user_id);
      if (!studentId) return;
      const key = String(studentId);
      const entry = attendanceByStudent.get(key) || { percentages: [], present: 0, total: 0 };
      const rawPercentage = firstValue(record.attendance_percent, record.attendance_percentage, record.percentage, record.percent);
      const percentage = typeof rawPercentage === "number" ? rawPercentage : Number.parseFloat(rawPercentage);
      if (Number.isFinite(percentage)) {
        entry.percentages.push(percentage);
      } else {
        const status = String(firstValue(record.status, record.attendance_status, "")).toLowerCase();
        entry.total += 1;
        if (["present", "late"].includes(status)) entry.present += 1;
      }
      attendanceByStudent.set(key, entry);
    });

    const studentAttendance = enrichedStudents.map((student) => {
      const entry = attendanceByStudent.get(String(student.id));
      if (!entry) return { student, percentage: null };
      const percentage = entry.percentages.length
        ? Math.round(entry.percentages.reduce((total, value) => total + value, 0) / entry.percentages.length)
        : entry.total ? Math.round((entry.present / entry.total) * 100) : null;
      return { student, percentage };
    });
    const lowAttendanceStudents = studentAttendance.filter(({ percentage }) => percentage !== null && percentage < 75);

    const completionByCourse = courses.map((course) => {
      const enrolledStudents = enrichedStudents.filter((student) =>
        student.enrolled_courses?.some((enrollment) => String(enrollment.course_id) === String(course.id))
      );
      const completionRate = enrolledStudents.length
        ? Math.round(enrolledStudents.reduce((total, student) => total + (student.progress || 0), 0) / enrolledStudents.length)
        : null;
      return {
        id: course.id,
        name: firstValue(course.title, course.name, course.course_name, "Untitled course"),
        completionRate,
        enrolled: enrolledStudents.length,
      };
    });
    const measuredCourses = completionByCourse.filter((course) => course.completionRate !== null);
    const lowestCompletionCourse = measuredCourses.length
      ? [...measuredCourses].sort((first, second) => first.completionRate - second.completionRate)[0]
      : null;
    const lowCompletionCourses = measuredCourses.filter((course) => course.completionRate < 50);

    const videosByCourse = new Set(courseVideos.map((video) => String(video.course_id)).filter(Boolean));
    const trainerCourses = new Map();
    courses.forEach((course) => {
      if (!course.trainer_id) return;
      const trainerId = String(course.trainer_id);
      trainerCourses.set(trainerId, [...(trainerCourses.get(trainerId) || []), course]);
    });
    const trainersWithoutContent = Array.from(trainerCourses.entries())
      .filter(([, trainerCourses]) => trainerCourses.every((course) => !videosByCourse.has(String(course.id))))
      .map(([trainerId, trainerCourses]) => ({
        id: trainerId,
        name: trainerNameById.get(trainerId) || "Unknown trainer",
        courses: trainerCourses.map((course) => firstValue(course.title, course.name, course.course_name, "Untitled course")),
      }));

    const lowProgressStudents = enrichedStudents.filter((student) => student.progress < 50);
    const studentsNeedingAttention = new Map();
    [...lowProgressStudents, ...lowAttendanceStudents.map(({ student }) => student)].forEach((student) => studentsNeedingAttention.set(String(student.id), student));
    const inactiveTrainers = trainers.filter((trainer) => (trainer.status || "active").toLowerCase() === "inactive");

    return {
      activeStudents,
      overdueAssignments,
      lowAttendanceStudents,
      completionByCourse,
      lowestCompletionCourse,
      lowCompletionCourses,
      trainersWithoutContent,
      studentsNeedingAttention: Array.from(studentsNeedingAttention.values()),
      inactiveTrainers,
      attendanceAvailable: attendanceByStudent.size > 0,
    };
  }, [assignments, attendanceRecords, courseVideos, courses, enrichedStudents, trainerNameById, trainers]);

  const heroHighlights = [];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const approveRequest = async (request) => {
    setSaving(true);
    setError("");
    setSuccess("");
    setApprovalCredentials(null);

    const rawStudentLoginId = firstValue(request.student_id, request.student_login_id);
    const studentLoginId = normalizeStudentId(rawStudentLoginId);
    const studentName = firstValue(request.full_name, request.name, request.email, "Student");
    const studentEmail = (request.email || "").trim();

    if (!studentEmail) {
      setSaving(false);
      setError("Student email is missing from this request.");
      return;
    }

    try {
      const { data, error: approvalError } = await supabase.functions.invoke("approve-student-registration", {
        body: {
          requestId: request.id,
          requestSource: request.source,
          profileId: firstValue(request.profile_id, request.user_id),
          studentId: studentLoginId,
          name: studentName,
          email: studentEmail,
          authEmail: request.auth_email,
        },
      });

      if (approvalError || data?.error) {
        setError(data?.error || approvalError?.message || "Unable to approve the student.");
      } else {
        // The edge function activates the account. Update the request here as
        // well so an older deployed function (or a schema without updated_at)
        // cannot leave an already-approved student in the pending list.
        let requestUpdate = { data: null };
        if (request.source === "access_requests") {
          requestUpdate = await safeUpdate("access_requests", request.id, {
            status: "approved",
            updated_at: new Date().toISOString(),
          });

          if (requestUpdate.error && hasServiceRoleKey) {
            requestUpdate = await serviceRoleTableRequest(
              "access_requests",
              `?id=eq.${encodeURIComponent(request.id)}&select=*`,
              "PATCH",
              { status: "approved", updated_at: new Date().toISOString() }
            );
          }
        }

        if (requestUpdate.error) {
          setError(requestUpdate.error.message || "The student account was approved, but the request could not be marked as approved.");
        } else {
          setRequests((current) => current.filter((item) => !(item.source === request.source && String(item.id) === String(request.id))));
          if (data?.emailError) {
            setSuccess("Student request approved, but email delivery failed. Share the temporary credentials below with the student.");
            setApprovalCredentials({
              name: studentName,
              studentId: data.studentId || studentLoginId,
              temporaryPassword: data.temporaryPassword || "Unavailable",
              emailError: data.emailError,
            });
          } else {
            setSuccess(data?.message || "Student request approved and credentials sent to student email.");
          }
        }
      }
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "Unable to contact the approval service. Please try again.");
    } finally {
      setSaving(false);
      await loadData();
    }
  };

  const rejectRequest = async (request) => {
    setSaving(true);
    setError("");
    setSuccess("");

    // An access request can exist without a profile record (for example from
    // an older registration flow). Its request ID must never be used as a
    // profile ID, otherwise an upsert attempts to create an incomplete profile.
    const profileId = firstValue(request.profile_id, request.user_id);

    try {
      // The request decision is the primary action. Complete it before the
      // optional auth/profile metadata sync so an RLS restriction on profiles
      // cannot leave a rejected request visible as pending.
      if (request.source === "access_requests") {
        let result = await safeUpdate("access_requests", request.id, {
          status: "rejected",
          updated_at: new Date().toISOString(),
        });

        if (result.error && hasServiceRoleKey) {
          result = await serviceRoleTableRequest(
            "access_requests",
            `?id=eq.${encodeURIComponent(request.id)}&select=*`,
            "PATCH",
            { status: "rejected", updated_at: new Date().toISOString() }
          );
        }

        if (result.error) {
          setError(result.error.message || "Unable to reject request.");
          return;
        }
      }

      setRequests((current) => current.filter((item) => !(item.source === request.source && String(item.id) === String(request.id))));

      // These updates keep the rejected state consistent for future sign-ins,
      // but the already-completed request decision must not be rolled back if
      // an older database does not permit one of them.
      if (profileId) {
        let profileResult = await safeUpdate("profiles", profileId, { role: "student", status: "rejected" });
        if (profileResult.error && hasServiceRoleKey) {
          profileResult = await serviceRoleTableRequest(
            "profiles",
            `?id=eq.${encodeURIComponent(profileId)}&select=*`,
            "PATCH",
            { role: "student", status: "rejected" }
          );
        }
        if (profileResult.error && !isStackDepthError(profileResult.error)) {
          console.warn("Rejected request profile sync failed:", profileResult.error);
        }
      }

      if (hasServiceRoleKey && profileId) {
        const authRejectResult = await serviceRoleAuthRequest(`/users/${profileId}`, "PUT", {
          user_metadata: {
            full_name: firstValue(request.full_name, request.name),
            registered_email: request.email,
            student_id: firstValue(request.student_id, request.student_login_id),
            role: "student",
            status: "rejected",
          },
        });
        if (authRejectResult.error) console.warn("Rejected request auth sync failed:", authRejectResult.error);
      }

      setSuccess("Student request rejected.");
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Unable to reject request.");
    } finally {
      setSaving(false);
      await loadData();
    }
  };

  const createTrainer = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    if (!trainerName.trim()) {
      setSaving(false);
      setError("Trainer name is required.");
      return;
    }

    const nextPassword = trainerPassword.trim() || generateTrainerPassword();
    const nextPasswordValue = nextPassword.trim();
    try {
      const nextTrainerId = await nextTrainerReferenceId();
      const nextTrainerEmail = (trainerEmail.trim() || `trainer-${Date.now()}@trainer.local`).toLowerCase();

      // Check the profile first so a second trainer is added as a new account,
      // while an accidentally reused email gets a useful message.
      const existingProfileResult = await findProfileByEmail(nextTrainerEmail);
      if (existingProfileResult.error) {
        setSaving(false);
        setError(getDbErrorMessage(existingProfileResult.error, "Unable to check whether this trainer email is available."));
        return;
      }

      if (existingProfileResult.data?.id) {
        setSaving(false);
        setError("This email is already linked to an account. Enter a different email for the new trainer.");
        return;
      }

      const authResult = await createTrainerAuthUser({
        email: nextTrainerEmail,
        password: nextPasswordValue,
        fullName: trainerName.trim(),
        status: trainerStatus,
        trainerReferenceId: nextTrainerId,
      });

      if (authResult.error) {
        setSaving(false);
        setError(getAuthErrorMessage(authResult.error, "Unable to create trainer login account."));
        return;
      }

      const trainerId = authResult.data?.id;
      if (!trainerId) {
        setSaving(false);
        setError("Unable to create trainer: missing auth user id.");
        return;
      }

      const payload = {
        id: trainerId,
        full_name: trainerName.trim(),
        email: nextTrainerEmail,
        role: "trainer",
        status: trainerStatus,
      };

      console.log("Creating trainer with payload:", payload);
      let result = hasServiceRoleKey
        ? await serviceRoleTableRequest("profiles", "?on_conflict=id&select=*", "POST", payload, {
            Prefer: "return=representation,resolution=merge-duplicates",
          })
        : await safeUpsert("profiles", payload, "id");

      if (!result.error && Array.isArray(result.data)) {
        result = { data: result.data[0] || null };
      }

      const duplicateEmail = (result.error?.message || "").includes("profiles_email_key");
      if (duplicateEmail) {
        const existingProfileResult = await findProfileByEmail(nextTrainerEmail);
        if (existingProfileResult.error) {
          result = { error: existingProfileResult.error };
        } else if (existingProfileResult.data?.id === trainerId) {
          const nextPayload = {
            ...payload,
            id: existingProfileResult.data.id,
          };

          result = hasServiceRoleKey
            ? await serviceRoleTableRequest("profiles", "?on_conflict=id&select=*", "POST", nextPayload, {
                Prefer: "return=representation,resolution=merge-duplicates",
              })
            : await safeUpsert("profiles", nextPayload, "id");

          if (!result.error && Array.isArray(result.data)) {
            result = { data: result.data[0] || null };
          }
        } else {
          result = { error: { message: "This email is already linked to another account. Use a different email for the new trainer." } };
        }
      }

      if (result.skipped) {
        result = await safeInsert("trainers", {
          id: trainerId,
          full_name: trainerName.trim(),
          email: nextTrainerEmail,
          status: trainerStatus,
        });
      }
      console.log("Trainer creation result:", result);

      setSaving(false);

      if (result.error) {
        console.error("Trainer creation error:", result.error);
        setError(getDbErrorMessage(result.error, "Unable to create trainer. Please check if trainer already exists."));
        return;
      }

      if (result.skipped) {
        setError("Unable to create trainer because no trainer table is available in the database.");
        return;
      }

      setSuccess("Trainer added successfully.");

      const emailResult = await sendTrainerCredentialsEmail({
        email: nextTrainerEmail,
        name: trainerName.trim(),
        password: nextPasswordValue,
        trainerId: nextTrainerId,
        loginUrl: `${window.location.origin}/trainer-login`,
      });

      if (emailResult?.error) {
        setSuccess("Trainer added successfully, but email delivery failed. Check SMTP settings and function deployment.");
      }

      setTrainerName("");
      setTrainerPassword(generateTrainerPassword());
      setTrainerEmail("");
      setTrainerStatus("active");
      await loadData();
    } catch (err) {
      console.error("Trainer creation exception:", err);
      setSaving(false);
      setError(err.message || "An unexpected error occurred.");
    }
  };

  const removeTrainer = async (trainer) => {
    if (!trainer?.id) return;
    if (!window.confirm(`Remove trainer \"${firstValue(trainer.full_name, trainer.name, trainer.email, "selected trainer")}?`)) return;

    setSaving(true);
    setError("");
    setSuccess("");

    let deleteError = null;

    if (hasServiceRoleKey && trainerTable === "profiles") {
      const deleteResult = await serviceRoleTableRequest(
        "profiles",
        `?id=eq.${encodeURIComponent(trainer.id)}&select=*`,
        "DELETE"
      );

      if (deleteResult.error) {
        deleteError = deleteResult.error;
      } else {
        const authDeleteResult = await serviceRoleAuthRequest(`/users/${trainer.id}`, "DELETE");
        if (authDeleteResult.error) {
          console.error("Trainer auth delete error:", authDeleteResult.error);
          setSaving(false);
          setSuccess("Trainer profile removed, but auth user cleanup failed.");
          await loadData();
          return;
        }
      }
    } else {
      const result = await supabase.from(trainerTable).delete().eq("id", trainer.id);
      deleteError = result.error;
    }

    setSaving(false);

    if (deleteError) {
      setError(getDbErrorMessage(deleteError, "Unable to remove trainer."));
      return;
    }

    setSuccess("Trainer removed.");
    await loadData();
  };

  const toggleTrainerStatus = async (trainer) => {
    setSaving(true);
    setError("");
    setSuccess("");

    const nextStatus = (trainer.status || "active").toLowerCase() === "active" ? "inactive" : "active";
    const result = await safeUpdate(trainerTable, trainer.id, { status: nextStatus });
    setSaving(false);

    if (result.error) {
      setError(result.error.message || "Unable to update trainer status.");
      return;
    }

    setSuccess("Trainer status updated.");
    await loadData();
  };

  const createCourse = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    if (!courseTitle.trim()) {
      setSaving(false);
      setError("Course title is required.");
      return;
    }

    if (!courseDescription.trim()) {
      setSaving(false);
      setError("Course description is required.");
      return;
    }

    if (!courseDuration.trim()) {
      setSaving(false);
      setError("Course duration is required.");
      return;
    }

    if (!courseEndDate) {
      setSaving(false);
      setError("Course end date is required.");
      return;
    }

    const payload = {
      title: courseTitle.trim(),
      name: courseTitle.trim(),
      course_name: courseTitle.trim(),
      description: courseDescription.trim() || null,
      course_description: courseDescription.trim() || null,
      duration: courseDuration.trim() || null,
      end_date: courseEndDate,
      status: courseStatus,
    };

    try {
      const result = await safeInsert("courses", payload);
      setSaving(false);

      if (result.error) {
        setError(getDbErrorMessage(result.error, "Unable to create course."));
        return;
      }

      if (result.skipped) {
        setError("Unable to create course because the courses table is not available.");
        return;
      }

      setSuccess("Course created successfully.");

      setCourseTitle("");
      setCourseDescription("");
      setCourseDuration("");
      setCourseEndDate("");
      setCourseStatus("active");
      await loadData();
    } catch (err) {
      console.error("Course creation error:", err);
      setSaving(false);
      setError(getDbErrorMessage(err, "An error occurred while creating the course."));
    }
  };

  const startEditStudent = (student) => {
    setEditingStudent(student);
    setEditStudentName(firstValue(student.full_name, student.name, student.email, ""));
    setEditStudentStatus(student.status || "active");
    setError("");
    setSuccess("");
  };

  const cancelEditStudent = () => {
    setEditingStudent(null);
    setEditStudentName("");
    setEditStudentStatus("active");
    setError("");
    setSuccess("");
  };

  const saveStudentEdit = async (event) => {
    event.preventDefault();
    if (!editingStudent) return;
    if (!editStudentName.trim()) {
      setError("Student name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    const result = await safeUpdate("profiles", editingStudent.id, {
      full_name: editStudentName.trim(),
      name: editStudentName.trim(),
      status: editStudentStatus,
    });

    setSaving(false);
    if (result.error) {
      setError(result.error.message || "Unable to update student.");
      return;
    }

    setSuccess("Student details updated.");
    cancelEditStudent();
    await loadData();
  };

  const removeStudent = async (student) => {
    if (!student?.id) return;
    if (!window.confirm(`Remove student "${firstValue(student.full_name, student.name, student.email, "selected student")}"?`)) return;

    setSaving(true);
    setError("");
    setSuccess("");

    const identifiers = [
      student.id,
      student.profile_id,
      student.user_id,
      student.student_id,
      student.student_login_id,
    ]
      .filter((value) => value !== null && value !== undefined && value !== "")
      .map(String);

    const emailIdentifiers = [student.email, student.auth_email]
      .filter((value) => value !== null && value !== undefined && value !== "")
      .map(String);

    if (!identifiers.length && !emailIdentifiers.length) {
      setSaving(false);
      setError("Unable to identify the student record to remove.");
      return;
    }

    const deleteTargets = [
      ...identifiers.flatMap((value) => [
        { table: "profiles", column: "id", value },
        { table: "profiles", column: "profile_id", value },
        { table: "profiles", column: "user_id", value },
        { table: "profiles", column: "student_id", value },
        { table: "profiles", column: "student_login_id", value },
        { table: "profiles", column: "email", value },
        { table: "profiles", column: "auth_email", value },
        { table: "students", column: "id", value },
        { table: "students", column: "profile_id", value },
        { table: "students", column: "user_id", value },
        { table: "students", column: "student_id", value },
        { table: "students", column: "student_login_id", value },
        { table: "students", column: "email", value },
        { table: "students", column: "student_email", value },
        { table: "enrollments", column: "profile_id", value },
        { table: "enrollments", column: "student_id", value },
        { table: "enrollments", column: "student_login_id", value },
        { table: "enrollments", column: "user_id", value },
        { table: "enrollments", column: "student_email", value },
        { table: "student_courses", column: "profile_id", value },
        { table: "student_courses", column: "student_id", value },
        { table: "student_courses", column: "student_login_id", value },
        { table: "student_courses", column: "user_id", value },
        { table: "student_courses", column: "student_email", value },
      ]),
      ...emailIdentifiers.flatMap((value) => [
        { table: "profiles", column: "email", value },
        { table: "profiles", column: "auth_email", value },
        { table: "students", column: "email", value },
        { table: "students", column: "student_email", value },
        { table: "enrollments", column: "student_email", value },
        { table: "student_courses", column: "student_email", value },
      ]),
    ];

    const uniqueTargets = Array.from(
      new Map(deleteTargets.map((target) => [`${target.table}.${target.column}.${target.value}`, target]))
        .values()
    );

    const results = await Promise.all(
      uniqueTargets.map(({ table, column, value }) => safeDelete(table, column, value))
    );

    setSaving(false);

    const deleteError = results.find((result) => result.error);
    if (deleteError) {
      setError(deleteError.error.message || "Unable to remove student.");
      return;
    }

    const deletedCount = results.reduce(
      (count, result) => count + (typeof result.deleted === "number" ? result.deleted : 0),
      0
    );

    if (!deletedCount) {
      const debugParts = uniqueTargets.map(({ table, column, value }, index) => {
        const result = results[index];
        if (result.skipped) return `${table}.${column}=${value}:skipped`;
        if (typeof result.deleted === "number") return `${table}.${column}=${value}:deleted:${result.deleted}`;
        return `${table}.${column}=${value}:failed`;
      });
      setError(`No student rows were removed. Debug: ${debugParts.join(", ")}`);
      return;
    }

    setSuccess("Student removed.");
    if (editingStudent?.id === student.id) cancelEditStudent();
    await loadData();
  };

  const removeCourse = async (course) => {
    if (!course?.id) return;
    if (!window.confirm(`Remove course \"${firstValue(course.title, course.name, course.course_name, "selected course")}\"?`)) return;

    setSaving(true);
    setError("");
    setSuccess("");

    const { error: deleteError } = await supabase.from("courses").delete().eq("id", course.id);
    setSaving(false);

    if (deleteError) {
      setError(deleteError.message || "Unable to remove course.");
      return;
    }

    setSuccess("Course removed.");
    await loadData();
  };

  const setCourseStatusByAdmin = async (course, nextStatus) => {
    if (!course?.id) return;
    const courseName = firstValue(course.title, course.name, course.course_name, "this course");
    const permissionMessage = nextStatus === "inactive"
      ? `Approve setting "${courseName}" to inactive? Students and trainers will no longer see it as an active course.`
      : `Reactivate "${courseName}"?`;
    if (!window.confirm(permissionMessage)) return;

    setSaving(true);
    setError("");
    setSuccess("");

    const result = await safeUpdate("courses", course.id, { status: nextStatus });
    setSaving(false);

    if (result.error) {
      setError(result.error.message || "Unable to update course status.");
      return;
    }

    setSuccess(nextStatus === "inactive" ? "Course set to inactive with admin approval." : "Course reactivated.");
    await loadData();
  };


  const saveMapping = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    if (!mapStudentIds.length || !mapTrainerId || !mapCourseId) {
      setSaving(false);
      setError("Please select at least one student, a trainer, and a course.");
      return;
    }

    const { data, error: mappingError } = await supabase.functions.invoke("save-student-mapping", {
      body: { studentIds: mapStudentIds, trainerId: mapTrainerId, courseId: mapCourseId },
    });
    setMapStudentIds([]);
    setShowStudentPicker(false);
    setMapTrainerId("");
    setMapCourseId("");
    setSaving(false);
    if (mappingError || data?.error) {
      setError(data?.error || mappingError?.message || "Unable to save the mapping.");
    } else {
      const failedCount = data?.failedStudentIds?.length || 0;
      const message = `${data?.mappedCount || 0} student${data?.mappedCount === 1 ? "" : "s"}, course, and trainer mapping saved.`;
      failedCount ? setError(`${message} ${failedCount} student${failedCount === 1 ? "" : "s"} could not be enrolled.`) : setSuccess(message);
    }
    await loadData();
  };

  const statCards = [
    { label: "Total Students", value: metrics.totalStudents, hint: "Registered student profiles", icon: GraduationCap, tone: "bg-sky-50 text-sky-700 ring-sky-100", accent: "from-sky-400 via-cyan-400 to-emerald-400" },
    { label: "Pending Approvals", value: metrics.pendingApprovals, hint: "Requests waiting action", icon: ClipboardList, tone: "bg-amber-50 text-amber-700 ring-amber-100", accent: "from-amber-400 via-yellow-400 to-lime-400" },
    { label: "Active Courses", value: metrics.activeCourses, hint: "Courses available now", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100", accent: "from-emerald-400 via-green-400 to-lime-400" },
    { label: "Trainers", value: metrics.totalTrainers, hint: "Trainer profiles", icon: UsersRound, tone: "bg-violet-50 text-violet-700 ring-violet-100", accent: "from-violet-400 via-fuchsia-400 to-pink-400" },
    { label: "Mapped Students", value: metrics.mappedStudents, hint: "Assigned to both trainer and course", icon: Link2, tone: "bg-teal-50 text-teal-700 ring-teal-100", accent: "from-teal-400 via-emerald-400 to-lime-400" },
  ];

  const askMonitoringAgent = (question = insightQuery) => {
    const normalized = question.trim().toLowerCase();
    if (!normalized) return;

    let answer;
    if (normalized.includes("active") && normalized.includes("student")) {
      answer = `${monitoringInsights.activeStudents.length} students currently have an active account.`;
    } else if (normalized.includes("lowest") && normalized.includes("completion")) {
      const course = monitoringInsights.lowestCompletionCourse;
      answer = course
        ? `${course.name} has the lowest completion rate at ${course.completionRate}% across ${course.enrolled} enrolled student${course.enrolled === 1 ? "" : "s"}.`
        : "There is not enough enrolled-student progress data to calculate a course completion rate yet.";
    } else if ((normalized.includes("trainer") && normalized.includes("content")) || normalized.includes("uploaded")) {
      answer = monitoringInsights.trainersWithoutContent.length
        ? `${monitoringInsights.trainersWithoutContent.map((trainer) => `${trainer.name} (${trainer.courses.join(", ")})`).join("; ")} ${monitoringInsights.trainersWithoutContent.length === 1 ? "has" : "have"} not uploaded course content.`
        : "Every trainer with an assigned course has uploaded course content.";
    } else if (normalized.includes("attendance")) {
      answer = !monitoringInsights.attendanceAvailable
        ? "Attendance data is not available yet. Add attendance records to enable this insight."
        : monitoringInsights.lowAttendanceStudents.length
          ? `${monitoringInsights.lowAttendanceStudents.map(({ student, percentage }) => `${firstValue(student.full_name, student.name, student.email, "Student")} (${percentage}%)`).join(", ")} have attendance below 75%.`
          : "No students currently have attendance below 75%.";
    } else if (normalized.includes("overdue") && normalized.includes("assignment")) {
      answer = `${monitoringInsights.overdueAssignments.length} assignment${monitoringInsights.overdueAssignments.length === 1 ? " is" : "s are"} overdue.`;
    } else if (normalized.includes("summary") || normalized.includes("today")) {
      answer = `Today’s LMS summary: ${monitoringInsights.activeStudents.length} active students, ${metrics.activeCourses} active courses, ${monitoringInsights.overdueAssignments.length} overdue assignments, ${monitoringInsights.lowCompletionCourses.length} courses below 50% completion, and ${monitoringInsights.trainersWithoutContent.length} trainer${monitoringInsights.trainersWithoutContent.length === 1 ? "" : "s"} with no uploaded course content.`;
    } else {
      answer = "Try asking about active students, course completion, trainer content, attendance, overdue assignments, or today’s LMS summary.";
    }

    setInsightQuery(question);
    setInsightAnswer(answer);
  };

  const renderInsights = () => {
    const cards = [
      { label: "Students needing attention", value: monitoringInsights.studentsNeedingAttention.length, hint: "Low progress or attendance", icon: UserCheck, tone: "bg-amber-50 text-amber-800 ring-amber-100" },
      { label: "Overdue assignments", value: monitoringInsights.overdueAssignments.length, hint: "Past their due date", icon: Clock3, tone: "bg-rose-50 text-rose-700 ring-rose-100" },
      { label: "Courses with low completion", value: monitoringInsights.lowCompletionCourses.length, hint: "Below 50% average progress", icon: ChartNoAxesColumn, tone: "bg-violet-50 text-violet-700 ring-violet-100" },
      { label: "Inactive trainers", value: monitoringInsights.inactiveTrainers.length, hint: "Trainer accounts marked inactive", icon: UsersRound, tone: "bg-slate-100 text-slate-700 ring-slate-200" },
    ];
    const prompts = [
      "How many active students are there?",
      "Which course has the lowest completion rate?",
      "Which trainer has not uploaded course content?",
      "Show students with low attendance.",
      "How many assignments are overdue?",
      "Give me today's LMS summary.",
    ];

    return (
      <section className="space-y-6">
        <header className="overflow-hidden rounded-[2rem] bg-[radial-gradient(circle_at_88%_20%,rgba(231,232,91,0.34),transparent_25%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_130%)] p-6 text-white shadow-[0_24px_60px_-35px_rgba(7,26,47,0.4)] sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-cert-yellow"><Sparkles size={14} /> Admin Monitoring Agent</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">AI Insights</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50/85">Ask questions about student activity, course completion, trainer content, attendance, and overdue work. Results use live LMS records.</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-right backdrop-blur"><p className="text-2xl font-semibold">{monitoringInsights.activeStudents.length}</p><p className="mt-1 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-50/80">Active students</p></div>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ label, value, hint, icon: Icon, tone }) => <article key={label} className={`rounded-2xl bg-white p-5 shadow-[0_18px_45px_-34px_rgba(7,26,47,0.3)] ring-1 ${tone.split(" ").at(-1)}`}><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone.split(" ").slice(0, 2).join(" ")}`}><Icon size={20} /></span><p className="mt-5 text-3xl font-semibold text-cert-ink">{value}</p><p className="mt-1 font-semibold text-cert-ink">{label}</p><p className="mt-1 text-xs text-slate-500">{hint}</p></article>)}
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(21rem,0.9fr)]">
          <div className="rounded-[1.75rem] border border-cert-line bg-white p-5 shadow-[0_20px_50px_-36px_rgba(7,26,47,0.25)] sm:p-6">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cert-mint text-cert-green-dark"><Sparkles size={21} /></span><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cert-green-dark">Ask the agent</p><h3 className="mt-1 text-xl font-semibold text-cert-ink">LMS operations assistant</h3></div></div>
            <form className="mt-5" onSubmit={(event) => { event.preventDefault(); askMonitoringAgent(); }}>
              <div className="flex flex-col gap-3 sm:flex-row"><input value={insightQuery} onChange={(event) => setInsightQuery(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" placeholder="Ask about your LMS..." /><button type="submit" className="rounded-xl bg-cert-navy px-5 py-3 text-sm font-semibold text-white hover:bg-cert-ink">Ask</button></div>
            </form>
            <div className="mt-4 flex flex-wrap gap-2">{prompts.map((prompt) => <button key={prompt} type="button" onClick={() => askMonitoringAgent(prompt)} className="rounded-full border border-cert-line bg-cert-mint px-3 py-2 text-left text-xs font-semibold text-cert-green-dark hover:bg-cert-green hover:text-cert-ink">{prompt}</button>)}</div>
            <div className="mt-5 min-h-24 rounded-2xl border border-cert-green/25 bg-[linear-gradient(135deg,#f5fff8_0%,#eef8f3_100%)] p-4 text-sm leading-6 text-cert-ink"><p className="font-semibold text-cert-green-dark">{insightAnswer ? "Monitoring result" : "Ready when you are"}</p><p className="mt-1">{insightAnswer || "Choose a suggested question or type your own to get a live LMS answer."}</p></div>
          </div>

          <div className="rounded-[1.75rem] border border-cert-line bg-white p-5 shadow-[0_20px_50px_-36px_rgba(7,26,47,0.25)] sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cert-green-dark">Completion chart</p><h3 className="mt-1 text-xl font-semibold text-cert-ink">Course progress</h3></div><ChartNoAxesColumn className="text-cert-green-dark" size={24} /></div><div className="mt-6 space-y-4">{monitoringInsights.completionByCourse.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No course progress data yet.</p> : monitoringInsights.completionByCourse.map((course) => <div key={course.id}><div className="flex items-center justify-between gap-3 text-sm"><span className="truncate font-medium text-cert-ink">{course.name}</span><span className="shrink-0 font-semibold text-cert-green-dark">{course.completionRate === null ? "No data" : `${course.completionRate}%`}</span></div><div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${course.completionRate !== null && course.completionRate < 50 ? "bg-amber-400" : "bg-cert-green"}`} style={{ width: `${course.completionRate || 0}%` }} /></div><p className="mt-1 text-xs text-slate-500">{course.enrolled} enrolled student{course.enrolled === 1 ? "" : "s"}</p></div>)}</div></div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2"><article className="rounded-[1.5rem] border border-cert-line bg-white p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><UserCheck size={19} /></span><div><p className="font-semibold text-cert-ink">Students needing attention</p><p className="text-sm text-slate-500">Low progress or attendance below 75%</p></div></div><div className="mt-4 space-y-2">{monitoringInsights.studentsNeedingAttention.length ? monitoringInsights.studentsNeedingAttention.slice(0, 8).map((student) => <p key={student.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-cert-ink">{firstValue(student.full_name, student.name, student.email, "Student")} <span className="text-slate-500">— {student.progress}% progress</span></p>) : <p className="rounded-xl bg-cert-mint px-3 py-3 text-sm text-cert-green-dark">No students currently need attention.</p>}</div></article><article className="rounded-[1.5rem] border border-cert-line bg-white p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Video size={19} /></span><div><p className="font-semibold text-cert-ink">Trainer content watchlist</p><p className="text-sm text-slate-500">Assigned trainers with no uploaded course content</p></div></div><div className="mt-4 space-y-2">{monitoringInsights.trainersWithoutContent.length ? monitoringInsights.trainersWithoutContent.map((trainer) => <p key={trainer.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-cert-ink">{trainer.name}<span className="block pt-1 text-xs text-slate-500">{trainer.courses.join(", ")}</span></p>) : <p className="rounded-xl bg-cert-mint px-3 py-3 text-sm text-cert-green-dark">All assigned trainers have course content.</p>}</div></article></div>
      </section>
    );
  };

  const renderAnalytics = () => {
    return (
      <section className="space-y-6">
        <div className="grid gap-5 lg:grid-cols-2">
          {courseAssignments.length === 0 && (
            <p className="rounded-[1.75rem] border border-cert-line bg-white px-5 py-4 text-sm text-slate-500">No courses have been created yet.</p>
          )}
          {courseAssignments.map((course) => (
            <article key={course.id} className="group overflow-hidden rounded-[1.75rem] border border-cert-line bg-white shadow-[0_24px_60px_-38px_rgba(7,26,47,0.2)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_65px_-34px_rgba(7,26,47,0.28)]">
              <header className="relative overflow-hidden bg-[radial-gradient(circle_at_88%_12%,rgba(231,232,91,0.32),transparent_30%),linear-gradient(135deg,#062239_0%,#08415a_56%,#0c8a58_128%)] p-5 text-white sm:p-6">
                <div className="absolute -bottom-12 -right-8 h-36 w-36 rounded-full border border-white/10" />
                <div className="relative flex items-start justify-between gap-4">
                  <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-50/75">Course workspace</p><h3 className="mt-1 truncate text-2xl font-semibold tracking-tight">{course.course_name}</h3></div>
                  <span className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-cert-yellow backdrop-blur">{course.status || "active"}</span>
                </div>
                <p className="relative mt-5 text-sm text-emerald-50/80">Trainer and student enrollment overview</p>
              </header>

              <div className="p-5 sm:p-6">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-cert-mint p-4 ring-1 ring-cert-line">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-cert-green-dark ring-1 ring-cert-line"><UsersRound size={19} aria-hidden="true" /></span>
                    <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Assigned trainer</p><p className="mt-1 truncate font-semibold text-cert-ink">{course.trainer_name || "Unassigned"}</p></div>
                  </div>
                  <div className="flex min-w-[7rem] items-center justify-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-center ring-1 ring-cert-line sm:flex-col sm:gap-0">
                    <span className="text-2xl font-bold text-cert-ink">{course.assigned_students.length}</span><span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-500">Students</span>
                  </div>
                </div>

                <div className="mt-5 border-t border-cert-line pt-4">
                  <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-cert-ink">Enrolled learners</p><span className="rounded-full bg-cert-green/15 px-2.5 py-1 text-xs font-bold text-cert-green-dark">{course.assigned_students.length} mapped</span></div>
                  {course.assigned_students.length === 0 ? (
                    <div className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-cert-line bg-slate-50 p-4 text-sm text-slate-500"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-400 ring-1 ring-cert-line"><GraduationCap size={18} aria-hidden="true" /></span><span>No students are enrolled in this course yet.</span></div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">{course.assigned_students.map((student) => {
                      const studentName = firstValue(student.full_name, student.name, student.email, "Student");
                      return <span key={student.id} className="inline-flex items-center gap-2 rounded-full border border-cert-line bg-white px-2.5 py-1.5 text-sm font-medium text-cert-ink"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cert-mint text-[0.65rem] font-bold text-cert-green-dark">{studentName.charAt(0).toUpperCase()}</span>{studentName}</span>;
                    })}</div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  };

  if (loading) {
    return (
      <div className="cert-bg-admin flex min-h-screen items-center justify-center px-4 py-8">
        <div className="cert-glass-panel w-full max-w-md rounded-[2rem] p-8 text-center shadow-[0_28px_80px_-45px_rgba(7,26,47,0.38)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cert-navy text-cert-yellow shadow-lg shadow-cert-navy/25">
            <ShieldCheck size={28} aria-hidden="true" />
          </div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-cert-green-dark">Admin workspace</p>
          <p className="mt-3 text-2xl font-semibold text-cert-ink">Loading dashboard...</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">Preparing requests, users, courses, mapping, and analytics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cert-bg-admin min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="cert-glass-panel rounded-[1.6rem] p-3 shadow-[0_18px_45px_-32px_rgba(7,26,47,0.18)]">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 flex-wrap gap-2">
              {tabs.map(({ key, label, path, icon: Icon }) => {
                const active = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => navigate(path)}
                    className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                      active
                        ? "bg-[linear-gradient(135deg,#06324f_0%,#149b55_100%)] text-white shadow-[0_18px_32px_-22px_rgba(6,50,79,0.65)]"
                        : "bg-white text-cert-ink ring-1 ring-cert-line hover:bg-cert-mint"
                    }`}
                  >
                    {Icon && <Icon size={16} aria-hidden="true" />}
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              {requests.length > 0 && (
                <button
                  type="button"
                  onClick={() => navigate("/admin/requests")}
                  className="relative inline-flex shrink-0 items-center justify-center rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                >
                  <Bell size={16} aria-hidden="true" />
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">
                    {requests.length}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-cert-navy px-4 py-3 text-sm font-semibold text-white hover:bg-cert-ink"
              >
                <LogOut size={16} aria-hidden="true" />
                Logout
              </button>
            </div>
          </div>
        </section>

        {activeTab === "overview" && <section className="cert-glass-panel overflow-hidden rounded-[2.5rem] shadow-[0_28px_85px_-48px_rgba(7,26,47,0.38)]">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative overflow-hidden bg-[linear-gradient(180deg,#061e33_0%,#06324f_56%,#10945a_100%)] p-6 text-white sm:p-8 lg:p-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(231,232,91,0.18),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(49,201,111,0.2),transparent_36%)]" />
              <div className="relative flex h-full min-h-[22rem] flex-col justify-between gap-5">
                <div className="inline-flex w-fit items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_16px_36px_-24px_rgba(0,0,0,0.75)]">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cert-ink text-cert-green">
                    <ShieldCheck size={28} strokeWidth={2.75} aria-hidden="true" />
                  </span>
                  <span className="text-2xl font-black tracking-tight text-cert-ink sm:text-3xl">CERTISURED</span>
                </div>
                <img
                  src="/images/certisured-growth.png"
                  alt="A learner climbing toward achievement on growing course progress bars"
                  className="mx-auto w-full max-w-[36rem] object-contain object-bottom"
                />
              </div>
            </div>

            <div className="min-h-[16rem] bg-[radial-gradient(circle_at_90%_0%,rgba(231,232,91,0.14),transparent_32%),linear-gradient(180deg,#f8fcf8_0%,#eef9f1_100%)] p-4 sm:p-6 lg:p-8">
              <div className="grid h-full grid-cols-2 gap-3">
                {statCards.map((card, index) => {
                  const Icon = card.icon;
                  return (
                    <article key={card.label} className={`group relative min-h-40 overflow-hidden rounded-2xl border border-cert-line bg-white p-4 shadow-[0_20px_48px_-36px_rgba(7,26,47,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_52px_-32px_rgba(7,26,47,0.26)] sm:p-5 ${index === statCards.length - 1 ? "col-span-2" : ""}`}>
                      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${card.accent}`} />
                      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-slate-50 transition duration-200 group-hover:scale-110" />
                      <div className="relative flex h-full flex-col justify-between">
                        <div className="flex items-start justify-between gap-3">
                          <p className="max-w-[9rem] text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500 sm:text-xs">{card.label}</p>
                          {Icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${card.tone}`}><Icon size={19} aria-hidden="true" /></span>}
                        </div>
                        <div className="mt-4">
                          <p className="text-4xl font-bold tracking-tight text-cert-ink sm:text-5xl">{card.value}</p>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <p className="text-xs leading-5 text-slate-500 sm:text-sm">{card.hint}</p>
                            <span className="shrink-0 rounded-full bg-slate-50 px-2 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-slate-500">Live</span>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>}

        {(error || success) && (
          <section className="space-y-3">
            {error && <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
            {success && <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>}
            {approvalCredentials && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p className="font-semibold">Email was not delivered to {approvalCredentials.name}.</p><p className="mt-1">Student ID: <span className="font-bold">{approvalCredentials.studentId}</span></p><p>Temporary password: <span className="font-bold">{approvalCredentials.temporaryPassword}</span></p><p className="mt-2 text-amber-800">Email error: {approvalCredentials.emailError}</p></div>}
          </section>
        )}

        {activeTab === "requests" && (
          <section className="overflow-hidden rounded-[2rem] border border-cert-line bg-white shadow-[0_24px_60px_-38px_rgba(7,26,47,0.22)]">
            <header className="relative overflow-hidden bg-[radial-gradient(circle_at_92%_20%,rgba(231,232,91,0.3),transparent_28%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_130%)] px-6 py-7 text-white sm:px-8">
              <div className="absolute -bottom-12 right-10 h-36 w-36 rounded-full border border-white/10" />
              <div className="relative flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-cert-yellow">Account access</p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight">Access Requests</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-emerald-50/85">Review new student registrations and decide who can join the learning platform.</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 text-center backdrop-blur">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-50/75">Awaiting review</p>
                  <p className="mt-1 text-3xl font-bold">{requests.length}</p>
                </div>
              </div>
            </header>
            <div className="p-5 sm:p-7">
              {requests.length === 0 && (
                <div className="flex min-h-56 items-center justify-center rounded-[1.5rem] border border-dashed border-cert-line bg-[radial-gradient(circle_at_50%_0%,rgba(49,201,111,0.12),transparent_45%),#f8fcf9] p-6 text-center">
                  <div className="max-w-sm">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cert-green/15 text-cert-green-dark ring-1 ring-cert-green/20"><UserCheck size={28} aria-hidden="true" /></span>
                    <h3 className="mt-4 text-xl font-semibold text-cert-ink">All caught up</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">There are no student access requests waiting for your review right now.</p>
                    <span className="mt-4 inline-flex rounded-full bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-cert-green-dark ring-1 ring-cert-line">0 pending requests</span>
                  </div>
                </div>
              )}
              {requests.length > 0 && <div className="space-y-4">
              {requests.map((request) => (
                <article key={`${request.source}-${request.id}`} className="rounded-[1.5rem] border border-cert-line bg-slate-50/70 p-5 transition hover:border-cert-green/40 hover:bg-white hover:shadow-[0_18px_40px_-32px_rgba(7,26,47,0.28)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cert-mint text-cert-green-dark ring-1 ring-cert-line"><GraduationCap size={21} aria-hidden="true" /></span>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold text-cert-ink">{firstValue(request.full_name, request.name, request.email, "Student request")}</p>
                        {request.email && <p className="mt-1 truncate text-sm text-slate-600">{request.email}</p>}
                        {request.message && <p className="mt-2 text-sm leading-6 text-slate-600">{request.message}</p>}
                        <p className="mt-3 inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-cert-line">Requested {fmtDate(request.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => approveRequest(request)}
                        className="rounded-xl bg-cert-green px-4 py-2.5 text-sm font-semibold text-cert-ink transition hover:bg-cert-green-dark hover:text-white disabled:opacity-70"
                      >
                        {saving ? "Approving..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => rejectRequest(request)}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 disabled:opacity-70"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              </div>}
            </div>
          </section>
        )}

        {activeTab === "trainers" && (
          <section className="mx-auto grid w-full max-w-7xl gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
              <div className="space-y-3">
                {trainers.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No trainers found.</p>}
                {trainers.map((trainer) => {
                  const assignment = trainerAssignmentsById.get(String(trainer.id));
                  const assignedCourses = assignment?.courses || [];
                  const assignedStudentCount = assignment?.studentIds.size || 0;

                  return (
                  <article key={trainer.id} className="overflow-hidden rounded-2xl border border-cert-line bg-slate-50 shadow-[0_16px_35px_-30px_rgba(7,26,47,0.38)]">
                    <div className="grid md:grid-cols-[12rem_minmax(0,1fr)]">
                      <div className="relative flex min-h-44 overflow-hidden bg-[radial-gradient(circle_at_82%_78%,rgba(49,201,111,0.55),transparent_24%),linear-gradient(145deg,#061e33_0%,#082d48_65%,#0b7650_100%)] p-5 text-white">
                        <div className="inline-flex h-fit items-center gap-2 rounded-xl bg-white px-2.5 py-2 shadow-[0_10px_24px_-16px_rgba(0,0,0,0.9)]">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cert-ink text-cert-green"><ShieldCheck size={18} strokeWidth={2.8} aria-hidden="true" /></span>
                          <span className="text-xs font-black tracking-tight text-cert-ink">CERTISURED</span>
                        </div>
                        <div className="absolute bottom-5 left-5 right-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cert-green">Trainer profile</p>
                          <p className="mt-2 truncate text-xl font-semibold">{firstValue(trainer.full_name, trainer.name, trainer.email, "Trainer")}</p>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col p-5 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-2xl font-semibold text-cert-ink">{firstValue(trainer.full_name, trainer.name, trainer.email, "Unnamed trainer")}</h3>
                            <p className="mt-2 text-sm text-slate-600">{trainer.email || "Email unavailable"}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${(trainer.status || "active").toLowerCase() === "active" ? "bg-cert-green/15 text-cert-green-dark" : "bg-slate-200 text-slate-600"}`}>{trainer.status || "active"}</span>
                        </div>
                        <div className="mt-5 border-t border-cert-line pt-4">
                          <p className="text-sm font-medium text-slate-600">Assigned courses: <span className="font-semibold text-cert-ink">{assignedCourses.length}</span></p>
                          {assignedCourses.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{assignedCourses.map((course) => <span key={course.id} className="rounded-full bg-cert-green/15 px-3 py-1 text-xs font-semibold text-cert-green-dark">{firstValue(course.title, course.name, course.course_name, "Course")}</span>)}</div> : <p className="mt-2 text-sm text-slate-500">No courses assigned yet.</p>}
                        </div>
                        <p className="mt-5 inline-flex items-center gap-2 border-t border-cert-line pt-4 text-sm font-medium text-slate-600"><UsersRound size={17} className="text-cert-green-dark" aria-hidden="true" /> {assignedStudentCount} students assigned</p>
                      </div>
                    </div>
                  </article>
                  );
                })}
              </div>
            <form onSubmit={createTrainer} className="h-fit rounded-[1.75rem] border border-cert-line bg-white p-6 xl:sticky xl:top-28">
              <h2 className="text-xl font-semibold text-cert-ink">Add Trainer</h2>
              <p className="mt-2 text-sm text-slate-500">Create a trainer profile for course assignments.</p>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Full name</label>
                  <input value={trainerName} onChange={(event) => setTrainerName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" placeholder="Trainer name" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Email</label>
                  <input value={trainerEmail} onChange={(event) => setTrainerEmail(event.target.value)} type="email" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" placeholder="trainer@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Temporary password</label>
                  <input value={trainerPassword} onChange={(event) => setTrainerPassword(event.target.value)} type="text" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" placeholder="Seven-word password" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Status</label>
                  <select value={trainerStatus} onChange={(event) => setTrainerStatus(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <button type="submit" disabled={saving} className="w-full rounded-xl bg-cert-navy px-4 py-3 text-sm font-semibold text-white transition hover:bg-cert-ink disabled:opacity-70">
                  {saving ? "Saving..." : "Add trainer"}
                </button>
              </div>
            </form>
          </section>
        )}

        {activeTab === "students" && (
          <section className="rounded-[1.75rem] border border-cert-line bg-white p-6">
            <h2 className="text-2xl font-semibold text-cert-ink">Student List</h2>
            <p className="mt-2 text-sm text-slate-500">View student details, account status, enrolled courses, and assigned trainers.</p>
            {editingStudent && (
              <form onSubmit={saveStudentEdit} className="mb-6 rounded-[1.75rem] border border-cert-line bg-slate-50 p-5">
                <h3 className="text-xl font-semibold text-cert-ink">Edit Student</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Full name</label>
                    <input
                      value={editStudentName}
                      onChange={(event) => setEditStudentName(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15"
                      placeholder="Student name"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Status</label>
                    <select
                      value={editStudentStatus}
                      onChange={(event) => setEditStudentStatus(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-cert-navy px-4 py-3 text-sm font-semibold text-white hover:bg-cert-ink disabled:opacity-70"
                  >
                    Save changes
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditStudent}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              {enrichedStudents.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No students found.</p>}
              {enrichedStudents.map((student) => (
                <article key={student.id} className="relative overflow-hidden rounded-[1.5rem] border border-cert-line bg-white p-5 shadow-[0_20px_46px_-34px_rgba(7,26,47,0.3)]">
                  <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#06324f_0%,#31c96f_55%,#e7e85b_100%)]" />
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cert-ink text-lg font-bold text-cert-green shadow-lg shadow-cert-ink/15">
                        {firstValue(student.full_name, student.name, student.email, "S").charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-cert-ink">{firstValue(student.full_name, student.name, student.email, "Student")}</h3>
                        <p className="mt-1 truncate text-xs text-slate-500">ID: {student.student_id || "Not assigned"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEditStudent(student)}
                        className="rounded-xl border border-cert-line bg-white px-3 py-2 text-sm font-semibold text-cert-ink transition hover:border-cert-green hover:bg-cert-mint"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStudent(student)}
                        className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 border-y border-cert-line py-4 sm:grid-cols-2">
                    <div className="rounded-xl bg-cert-mint p-3">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Course</p>
                      <p className="mt-1 truncate text-sm font-semibold text-cert-ink">{student.enrolled_course}</p>
                    </div>
                    <div className="rounded-xl bg-cert-mint p-3">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Trainer</p>
                      <p className="mt-1 truncate text-sm font-semibold text-cert-ink">{student.trainer_name}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${(student.status || "").toLowerCase() === "active" ? "bg-cert-green/15 text-cert-green-dark" : "bg-slate-100 text-slate-600"}`}>{student.status || "N/A"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500"><span>Progress</span><span className="text-cert-ink">{student.progress || 0}%</span></div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[linear-gradient(90deg,#149b55,#31c96f)]" style={{ width: `${Math.min(100, Math.max(0, Number(student.progress) || 0))}%` }} /></div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "courses" && (
          <section className="mx-auto grid w-full max-w-7xl gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
              <div className="space-y-5">
                {courses.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No courses available.</p>}
                {courses.map((course) => {
                  const durationComplete = courseDurationComplete(course);
                  const isActive = (course.status || "active").toLowerCase() === "active";

                  return (
                  <article key={course.id} className="overflow-hidden rounded-2xl border border-cert-line bg-slate-50 shadow-[0_16px_35px_-30px_rgba(7,26,47,0.38)]">
                    <div className="grid md:grid-cols-[13rem_minmax(0,1fr)]">
                      {course.thumbnail_url ? (
                        <img src={course.thumbnail_url} alt={`${firstValue(course.title, course.name, "Course")} course cover`} className="h-52 w-full object-cover md:h-full" />
                      ) : (
                        <div className="relative flex min-h-52 overflow-hidden bg-[radial-gradient(circle_at_82%_76%,rgba(49,201,111,0.55),transparent_24%),linear-gradient(145deg,#061e33_0%,#082d48_65%,#0b7650_100%)] p-5 text-white">
                          <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-xl bg-white px-2.5 py-2 shadow-[0_10px_24px_-16px_rgba(0,0,0,0.9)]">
                            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cert-ink text-cert-green">
                              <ShieldCheck size={18} strokeWidth={2.8} aria-hidden="true" />
                            </span>
                            <span className="text-xs font-black tracking-tight text-cert-ink">CERTISURED</span>
                          </div>
                          <div className="mt-auto">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cert-green">Online learning</p>
                            <p className="mt-2 text-xl font-semibold leading-tight">{firstValue(course.title, course.name, course.course_name, "Course")}</p>
                            <span className="mt-4 inline-block rounded-md bg-cert-green px-2.5 py-1 text-xs font-bold text-cert-ink">{firstValue(course.duration, "Flexible duration")}</span>
                          </div>
                        </div>
                      )}

                      <div className="flex min-w-0 flex-col p-5 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-2xl font-semibold text-cert-ink">{firstValue(course.title, course.name, course.course_name, "Untitled course")}</h3>
                            <p className="mt-2 text-sm font-medium text-cert-ink">{firstValue(course.duration, "Duration unavailable")} | Ends {course.end_date ? fmtDate(course.end_date) : "not scheduled"} | Online</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${(course.status || "active").toLowerCase() === "active" ? "bg-cert-green/15 text-cert-green-dark" : "bg-slate-200 text-slate-600"}`}>
                            {course.status || "active"}
                          </span>
                        </div>
                        <p className="mt-4 text-sm leading-6 text-slate-600">{firstValue(course.description, course.course_description, "Course description will be added soon.")}</p>
                        {durationComplete && isActive && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Course duration has ended. Admin approval is required to set this course inactive.</p>}
                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-cert-line pt-4">
                          <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-600"><UsersRound size={17} className="text-cert-green-dark" aria-hidden="true" /> {courseEnrollmentById.get(String(course.id)) || 0} students enrolled</p>
                          <button type="button" disabled={saving} onClick={() => setCourseStatusByAdmin(course, isActive ? "inactive" : "active")} className={`rounded-xl px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${isActive ? "bg-slate-900 text-white hover:bg-cert-ink" : "bg-cert-green text-cert-ink hover:bg-cert-green-dark hover:text-white"}`}>
                            {isActive ? (durationComplete ? "Approve & set inactive" : "Set inactive") : "Reactivate"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                  );
                })}
              </div>
            <form onSubmit={createCourse} className="h-fit rounded-[1.75rem] border border-cert-line bg-white p-6 xl:sticky xl:top-28">
              <h2 className="text-xl font-semibold text-cert-ink">Create Course</h2>
              <p className="mt-2 text-sm text-slate-500">Add a course for student enrollment and trainer mapping.</p>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Course name</label>
                  <input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" placeholder="Full Stack Development" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Description</label>
                  <input value={courseDescription} onChange={(event) => setCourseDescription(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" placeholder="Course description" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Duration</label>
                  <input value={courseDuration} onChange={(event) => setCourseDuration(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" placeholder="16 weeks" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Course end date</label>
                  <input type="date" value={courseEndDate} onChange={(event) => setCourseEndDate(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15" required />
                  <p className="mt-1 text-xs text-slate-500">When this date passes, only an admin can approve setting the course inactive.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Status</label>
                  <select value={courseStatus} onChange={(event) => setCourseStatus(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <button type="submit" disabled={saving} className="w-full rounded-xl bg-cert-navy px-4 py-3 text-sm font-semibold text-white transition hover:bg-cert-ink disabled:opacity-70">
                  {saving ? "Saving..." : "Create course"}
                </button>
              </div>
            </form>
          </section>
        )}

        {activeTab === "mapping" && (
          <section className="mx-auto w-full max-w-4xl">
            <form onSubmit={saveMapping} className="overflow-hidden rounded-[2rem] border border-cert-line bg-white shadow-[0_24px_60px_-38px_rgba(7,26,47,0.22)]">
              <div className="relative overflow-hidden bg-[radial-gradient(circle_at_90%_16%,rgba(231,232,91,0.3),transparent_28%),linear-gradient(135deg,#062239_0%,#08415a_58%,#0c8a58_130%)] px-6 py-7 text-white sm:px-8">
                <div className="absolute -bottom-10 right-8 h-28 w-28 rounded-full border border-white/10" />
                <div className="relative flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-cert-yellow">Enrollment workflow</p>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight">Map learning access</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-emerald-50/85">Choose students, then connect them to the right trainer and course.</p>
                  </div>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-cert-yellow backdrop-blur"><Link2 size={23} aria-hidden="true" /></span>
                </div>
              </div>
              <div className="space-y-5 p-5 sm:p-7">
                <div className="rounded-2xl border border-cert-line bg-slate-50/70 p-4">
                  <label className="flex items-center gap-3 text-sm font-semibold text-cert-ink"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-cert-green text-sm font-bold text-cert-ink">1</span><span>Choose students <small className="ml-1 font-normal text-slate-500">Select one or more</small></span></label>
                  <button
                    type="button"
                    onClick={() => setShowStudentPicker((open) => !open)}
                    aria-expanded={showStudentPicker}
                    className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-cert-ink outline-none transition hover:border-cert-green focus:border-cert-green focus:ring-4 focus:ring-cert-green/15"
                  >
                    <span>{mapStudentIds.length ? `${mapStudentIds.length} student${mapStudentIds.length === 1 ? "" : "s"} selected` : `Select students${unassignedStudentCount ? ` (${unassignedStudentCount} unassigned)` : ""}`}</span>
                    <span className="text-lg leading-none text-slate-500" aria-hidden="true">{showStudentPicker ? "⌃" : "⌄"}</span>
                  </button>
                  {showStudentPicker && <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3 border-b border-cert-line px-2 pb-2">
                      <p className="text-xs text-slate-500">Choose one or more students. {unassignedStudentCount} currently have no course.</p>
                      <button
                        type="button"
                        onClick={() => setMapStudentIds(mapStudentIds.length === enrichedStudents.length ? [] : enrichedStudents.map((student) => String(student.id)))}
                        className="text-xs font-semibold text-cert-green-dark hover:underline"
                      >
                        {mapStudentIds.length === enrichedStudents.length ? "Clear all" : "Select all"}
                      </button>
                    </div>
                    {enrichedStudents.length === 0 ? (
                      <p className="px-2 py-1 text-sm text-slate-500">No students available.</p>
                    ) : enrichedStudents.map((student) => {
                      const studentId = String(student.id);
                      const selected = mapStudentIds.includes(studentId);
                      return (
                        <label key={student.id} className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${selected ? "bg-cert-green/15 text-cert-ink" : "hover:bg-white"}`}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => setMapStudentIds((current) => selected ? current.filter((id) => id !== studentId) : [...current, studentId])}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          {firstValue(student.full_name, student.name, student.email, student.id)}
                        </label>
                      );
                    })}
                  </div>}
                </div>

                <div className="rounded-2xl border border-cert-line bg-slate-50/70 p-4">
                  <label className="flex items-center gap-3 text-sm font-semibold text-cert-ink"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-cert-green text-sm font-bold text-cert-ink">2</span><span>Choose trainer <small className="ml-1 font-normal text-slate-500">Set the learning owner</small></span></label>
                  <select
                    value={mapTrainerId}
                    onChange={(event) => setMapTrainerId(event.target.value)}
                    className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15"
                    required
                  >
                    <option value="">Select trainer</option>
                    {trainers.map((trainer) => (
                      <option key={trainer.id} value={trainer.id}>
                        {firstValue(trainer.full_name, trainer.name, trainer.email, trainer.id)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-2xl border border-cert-line bg-slate-50/70 p-4">
                  <label className="flex items-center gap-3 text-sm font-semibold text-cert-ink"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-cert-green text-sm font-bold text-cert-ink">3</span><span>Choose course <small className="ml-1 font-normal text-slate-500">Enroll selected students</small></span></label>
                  <select
                    value={mapCourseId}
                    onChange={(event) => setMapCourseId(event.target.value)}
                    className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cert-green focus:ring-4 focus:ring-cert-green/15"
                    required
                  >
                    <option value="">Select course</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {firstValue(course.title, course.name, course.course_name, course.id)}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#06324f_0%,#0d8f55_100%)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_18px_30px_-20px_rgba(6,50,79,0.65)] transition hover:brightness-110 disabled:opacity-70"
                >
                  <Link2 size={17} aria-hidden="true" />{saving ? "Saving mapping..." : "Save mapping"}
                </button>
              </div>
            </form>
          </section>
        )}

        {activeTab === "certificates" && (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
            <div className="rounded-[1.75rem] border border-cert-line bg-white p-6 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.12)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cert-green-dark">Certificate records</p>
                  <h2 className="mt-2 text-2xl font-semibold text-cert-ink">Issued certificates</h2>
                  <p className="mt-2 text-sm text-slate-500">Certificates are created automatically after a trainer approves every required assignment and project.</p>
                </div>
                <span className="rounded-full bg-cert-mint px-3 py-1.5 text-sm font-semibold text-cert-green-dark">{certificates.length}</span>
              </div>
              <div className="mt-6 space-y-3">
                {certificates.length === 0 ? (
                  <p className="rounded-2xl bg-cert-mint px-4 py-5 text-sm text-slate-500">No certificates have been issued yet.</p>
                ) : certificates.map((certificate) => (
                  <article key={certificate.id || `${certificate.student_id}-${certificate.course_id}`} className="flex flex-col gap-4 rounded-2xl border border-cert-line bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cert-ink text-cert-green"><Award size={21} aria-hidden="true" /></span>
                      <div>
                        <p className="font-semibold text-cert-ink">{studentNameById.get(String(certificate.student_id || certificate.profile_id)) || "Student"}</p>
                        <p className="mt-1 text-sm text-slate-500">{courseNameById.get(String(certificate.course_id)) || "Course"}</p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-semibold text-cert-ink">{certificate.certificate_number || "Certificate issued"}</p>
                      <p className="mt-1 text-xs text-slate-500">Issued {fmtDate(certificate.issue_date || certificate.created_at)}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <aside className="overflow-hidden rounded-[1.75rem] border border-cert-green/35 bg-[linear-gradient(135deg,#ffffff_0%,#f1fbf4_100%)] p-2 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.14)]">
              <div className="h-full rounded-[1.35rem] border-[3px] border-cert-ink p-6 text-center">
                <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-cert-ink px-3 py-2 text-xs font-bold tracking-[0.18em] text-white"><ShieldCheck size={15} className="text-cert-green" aria-hidden="true" /> CERTISURED</div>
                <p className="mt-6 text-[0.65rem] font-bold uppercase tracking-[0.24em] text-cert-green-dark">Stored certificate format</p>
                <h3 className="mt-3 font-serif text-2xl font-semibold text-cert-ink">Certificate of Completion</h3>
                <p className="mt-6 text-sm text-slate-500">This is the completion certificate format students receive when their course work is fully approved.</p>
                <div className="mt-6 border-t border-cert-line pt-4 text-left text-xs text-slate-500"><p className="font-semibold text-cert-ink">Includes</p><p className="mt-2">Student name, course name, certificate number, issue date, and Certisured branding.</p></div>
              </div>
            </aside>
          </section>
        )}

        {activeTab === "insights" && renderInsights()}
        {activeTab === "analytics" && renderAnalytics()}
      </div>
    </div>
  );
}
