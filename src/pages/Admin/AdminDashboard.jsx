import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BookOpenCheck,
  ChartNoAxesColumn,
  ClipboardList,
  GraduationCap,
  Link2,
  LogOut,
  ShieldCheck,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { supabase } from "../../lib/supabaseClient";

const tabs = [
  { key: "overview", label: "Overview", path: "/admin", icon: ShieldCheck },
  { key: "requests", label: "Requests", path: "/admin/requests", icon: ClipboardList },
  { key: "trainers", label: "Trainers", path: "/admin/trainers", icon: UsersRound },
  { key: "students", label: "Students", path: "/admin/students", icon: GraduationCap },
  { key: "courses", label: "Courses", path: "/admin/courses", icon: BookOpenCheck },
  { key: "mapping", label: "Mapping", path: "/admin/mapping", icon: Link2 },
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

const createTrainerAuthUser = async ({ email, password, fullName, status }) => {
  if (hasServiceRoleKey) {
    const createResult = await serviceRoleAuthRequest("/users", "POST", {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: "trainer",
        status,
      },
    });

    if (!createResult.error) {
      const nextUser = createResult.data?.user || createResult.data;
      return { data: nextUser };
    }

    const code = (createResult.error?.error_code || createResult.error?.code || "").toString().toLowerCase();
    const msg = (createResult.error?.msg || createResult.error?.message || "").toString().toLowerCase();
    const emailExists = code === "email_exists" || msg.includes("already been registered") || msg.includes("already registered");

    if (!emailExists) {
      return { error: createResult.error || { message: "Unable to create trainer auth user." } };
    }

    const listResult = await serviceRoleAuthRequest("/users?page=1&per_page=1000", "GET");
    if (listResult.error) return { error: listResult.error };

    const users = listResult.data?.users || [];
    const existingUser = users.find((user) => (user?.email || "").toLowerCase() === email.toLowerCase());
    if (!existingUser?.id) {
      return { error: { message: "Email already exists in auth, but existing user could not be loaded." } };
    }

    const updateResult = await serviceRoleAuthRequest(`/users/${existingUser.id}`, "PUT", {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata || {}),
        full_name: fullName,
        role: "trainer",
        status,
      },
    });

    if (updateResult.error) return { error: updateResult.error };

    const updatedUser = updateResult.data?.user || updateResult.data || existingUser;
    return { data: updatedUser };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: "trainer",
        status,
      },
    },
  });

  if (error) return { error };
  if (!data?.user?.id) return { error: { message: "Auth user was not created. Check Supabase auth settings." } };
  return { data: data.user };
};

const sendTrainerCredentialsEmail = async ({ email, name, password, trainerId }) => {
  const safeEmail = (email || "").trim();
  if (!safeEmail || safeEmail.endsWith("@trainer.local")) return { skipped: true };

  const { error } = await supabase.functions.invoke("send-trainer-email", {
    body: {
      email: safeEmail,
      name,
      password,
      trainerId,
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

const generateStudentPassword = () => `Stud@${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 90)}`;

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

const fmtDate = (value) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString();
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

  const [requests, setRequests] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [studentRecords, setStudentRecords] = useState([]);
  const [studentCourseRows, setStudentCourseRows] = useState([]);
  const [enrollmentRows, setEnrollmentRows] = useState([]);

  const [trainerName, setTrainerName] = useState("");
  const [trainerEmail, setTrainerEmail] = useState("");
  const [trainerPassword, setTrainerPassword] = useState("");
  const [trainerStatus, setTrainerStatus] = useState("active");
  const [trainerTable, setTrainerTable] = useState("profiles");

  const [courseTitle, setCourseTitle] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [courseDuration, setCourseDuration] = useState("");
  const [courseStatus, setCourseStatus] = useState("active");

  const [mapStudentId, setMapStudentId] = useState("");
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

      const studentsRes = await supabase
        .from("profiles")
        .select("*")
        .eq("role", "student")
        .limit(500);

      const studentsServiceRes = (hasServiceRoleKey && (studentsRes.error || !(studentsRes.data || []).length))
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

      const studentRes = await supabase
        .from("students")
        .select("*")
        .limit(1000);

      const enrollmentRes = await supabase
        .from("enrollments")
        .select("*")
        .limit(1000);

      const studentCourseRes = await supabase
        .from("student_courses")
        .select("*")
        .limit(1000);

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

      if (trainersRes.error && hasServiceRoleKey) {
        const trainerList = await serviceRoleTableRequest(
          "profiles",
          "?select=*&role=eq.trainer&limit=200",
          "GET"
        );
        if (!trainerList.error) {
          nextTrainers = Array.isArray(trainerList.data) ? trainerList.data : [];
          nextTrainerTable = "profiles";
        }
      }

      if (trainersRes.error && missingTable(trainersRes.error)) {
        const fallbackTrainersRes = await supabase.from("trainers").select("*").limit(200);
        nextTrainers = fallbackTrainersRes.error ? [] : (fallbackTrainersRes.data || []);
        if (!fallbackTrainersRes.error) nextTrainerTable = "trainers";
      }
      const nextStudents = studentsRes.error
        ? (studentsServiceRes.error ? [] : (Array.isArray(studentsServiceRes.data) ? studentsServiceRes.data : []))
        : ((studentsRes.data || []).length
        ? (studentsRes.data || [])
        : (studentsServiceRes.error ? [] : (Array.isArray(studentsServiceRes.data) ? studentsServiceRes.data : [])));
      const nextCourses = coursesRes.error ? [] : (coursesRes.data || []);
      const nextStudentRecords = studentRes.error ? [] : (studentRes.data || []);
      const nextEnrollmentRows = enrollmentRes.error ? [] : (enrollmentRes.data || []);
      const nextStudentCourseRows = nextEnrollmentRows.length ? nextEnrollmentRows : (studentCourseRes.error ? [] : (studentCourseRes.data || []));

      setRequests(nextRequests);
      setTrainers(nextTrainers);
      setTrainerTable(nextTrainerTable);
      setStudents(nextStudents);
      setCourses(nextCourses);
      setStudentRecords(nextStudentRecords);
      setEnrollmentRows(nextEnrollmentRows);
      setStudentCourseRows(nextStudentCourseRows);
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

  const courseNameById = useMemo(
    () => new Map(courses.map((course) => [String(course.id), firstValue(course.title, course.name, course.course_name, "Untitled course")])),
    [courses]
  );

  const trainerNameById = useMemo(
    () => new Map(trainers.map((trainer) => [String(trainer.id), firstValue(trainer.full_name, trainer.name, trainer.email, "Unknown trainer")])),
    [trainers]
  );

  const studentRecordByProfile = useMemo(() => {
    const map = new Map();
    studentRecords.forEach((record) => {
      if (record.profile_id) map.set(String(record.profile_id), record);
      if (record.user_id) map.set(String(record.user_id), record);
      if (record.id) map.set(String(record.id), record);
    });
    return map;
  }, [studentRecords]);

  const enrollmentByProfile = useMemo(() => {
    const map = new Map();
    studentCourseRows.forEach((record) => {
      if (record.profile_id) map.set(String(record.profile_id), record);
      if (record.student_id) map.set(String(record.student_id), record);
      if (record.user_id) map.set(String(record.user_id), record);
      if (record.id) map.set(String(record.id), record);
    });
    enrollmentRows.forEach((record) => {
      if (record.profile_id) map.set(String(record.profile_id), record);
      if (record.student_id) map.set(String(record.student_id), record);
      if (record.user_id) map.set(String(record.user_id), record);
      if (record.id) map.set(String(record.id), record);
    });
    return map;
  }, [studentCourseRows, enrollmentRows]);

  const courseEnrollmentById = useMemo(() => {
    const map = new Map();
    studentRecords.forEach((record) => {
      if (record.course_id) map.set(String(record.course_id), (map.get(String(record.course_id)) || 0) + 1);
    });
    studentCourseRows.forEach((record) => {
      if (record.course_id) map.set(String(record.course_id), (map.get(String(record.course_id)) || 0) + 1);
    });
    enrollmentRows.forEach((record) => {
      if (record.course_id) map.set(String(record.course_id), (map.get(String(record.course_id)) || 0) + 1);
    });
    return map;
  }, [studentRecords, studentCourseRows, enrollmentRows]);

  const trainerWorkloadById = useMemo(() => {
    const map = new Map();
    studentRecords.forEach((record) => {
      if (record.trainer_id) map.set(String(record.trainer_id), (map.get(String(record.trainer_id)) || 0) + 1);
    });
    enrollmentRows.forEach((record) => {
      if (record.trainer_id) map.set(String(record.trainer_id), (map.get(String(record.trainer_id)) || 0) + 1);
    });
    return map;
  }, [studentRecords, enrollmentRows]);

  const enrichedStudents = useMemo(
    () =>
      students.map((student) => {
        const enrollmentRecord = enrollmentByProfile.get(String(student.id));
        const studentRecord = studentRecordByProfile.get(String(student.id));
        const record = enrollmentRecord || studentRecord;
        const courseId = firstValue(student.course_id, enrollmentRecord?.course_id, studentRecord?.course_id);
        const trainerId = firstValue(student.trainer_id, enrollmentRecord?.trainer_id, studentRecord?.trainer_id);
        const progress = Number(
          firstValue(enrollmentRecord?.completion_percent, enrollmentRecord?.progress_percent, studentRecord?.completion_percent, studentRecord?.progress_percent, student.completion_percent, 0)
        ) || 0;

        return {
          ...student,
          student_id: firstValue(student.student_id, student.student_login_id, enrollmentRecord?.student_id, enrollmentRecord?.student_login_id, studentRecord?.student_id, studentRecord?.student_login_id),
          enrolled_course: firstValue(
            student.course_name,
            enrollmentRecord?.course_name,
            studentRecord?.course_name,
            courseNameById.get(String(courseId)),
            "Unassigned"
          ),
          trainer_name: firstValue(
            student.trainer_name,
            enrollmentRecord?.trainer_name,
            studentRecord?.trainer_name,
            trainerNameById.get(String(trainerId)),
            "Unassigned"
          ),
          progress,
          certificate_ready: Boolean(
            student.certificate_ready ||
              enrollmentRecord?.certificate_ready ||
              studentRecord?.certificate_ready ||
              progress >= 100
          ),
        };
      }),
    [students, studentRecordByProfile, enrollmentByProfile, courseNameById, trainerNameById]
  );

  const metrics = useMemo(() => {
    const activeCourses = courses.filter((course) => (course.status || "active").toLowerCase() === "active").length;
    const mappedStudents = enrichedStudents.filter((student) => student.enrolled_course !== "Unassigned" && student.trainer_name !== "Unassigned").length;
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

  const heroHighlights = [
    { label: "Pending approvals", value: metrics.pendingApprovals, icon: ClipboardList },
    { label: "Active courses", value: metrics.activeCourses, icon: BookOpenCheck },
    { label: "Mapped students", value: metrics.mappedStudents, icon: Link2 },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const approveRequest = async (request) => {
    setSaving(true);
    setError("");
    setSuccess("");

    const profileId = firstValue(request.profile_id, request.user_id, request.id);
    const rawStudentLoginId = firstValue(request.student_id, request.student_login_id);
    const studentLoginId = normalizeStudentId(rawStudentLoginId);
    const studentName = firstValue(request.full_name, request.name, request.email, "Student");
    const studentEmail = (request.email || "").trim();
    const authEmail = firstValue(request.auth_email, studentAuthEmailFor(studentLoginId));
    const nextPassword = generateStudentPassword();

    if (!profileId || !studentLoginId || !studentEmail) {
      setSaving(false);
      setError("Missing student details for approval. Ensure request has student ID and email.");
      return;
    }

    if (hasServiceRoleKey) {
      const authResult = await serviceRoleAuthRequest(`/users/${profileId}`, "PUT", {
        email: authEmail,
        password: nextPassword,
        email_confirm: true,
        user_metadata: {
          full_name: studentName,
          registered_email: studentEmail,
          student_id: studentLoginId,
          role: "student",
          status: "active",
        },
      });

      if (authResult.error) {
        setSaving(false);
        setError(getDbErrorMessage(authResult.error, "Unable to prepare student login account."));
        return;
      }
    }

    let profileSyncWarning = false;

    const profileResult = await safeUpsert(
      "profiles",
      {
        id: profileId,
        email: studentEmail,
        auth_email: authEmail,
        full_name: studentName,
        role: "student",
        status: "active",
        student_id: studentLoginId,
        student_login_id: studentLoginId,
      },
      "id"
    );

    if (profileResult.error) {
      if (isStackDepthError(profileResult.error)) {
        profileSyncWarning = true;
      } else {
        setSaving(false);
        setError(profileResult.error.message || "Unable to activate student profile.");
        return;
      }
    }

    if (request.source === "access_requests") {
      const result = await safeUpdate("access_requests", request.id, {
        status: "approved",
        updated_at: new Date().toISOString(),
      });
      if (result.error) {
        setSaving(false);
        setError(result.error.message || "Unable to approve request.");
        return;
      }
    }

    const emailResult = await sendStudentApprovalEmail({
      email: studentEmail,
      name: studentName,
      studentId: studentLoginId,
      password: nextPassword,
    });

    if (emailResult.error) {
      setSuccess("Student approved, but email delivery failed. Check SMTP settings in send-email function.");
      setSaving(false);
      await loadData();
      return;
    }

    if (profileSyncWarning) {
      setSuccess("Student approved and credentials sent. Profile sync was skipped due database recursion issue.");
    } else {
      setSuccess("Student request approved and credentials sent to student email.");
    }
    setSaving(false);
    await loadData();
  };

  const rejectRequest = async (request) => {
    setSaving(true);
    setError("");
    setSuccess("");

    const profileId = firstValue(request.profile_id, request.user_id, request.id);

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

      if (authRejectResult.error) {
        setSaving(false);
        setError(getDbErrorMessage(authRejectResult.error, "Unable to reject request."));
        return;
      }
    }

    if (request.source === "access_requests") {
      const result = await safeUpdate("access_requests", request.id, {
        status: "rejected",
        updated_at: new Date().toISOString(),
      });
      if (result.error) {
        setSaving(false);
        setError(result.error.message || "Unable to reject request.");
        return;
      }
    }

    if (profileId) {
      const profileResult = await safeUpsert(
        "profiles",
        {
          id: profileId,
          role: "student",
          status: "rejected",
        },
        "id"
      );

      if (profileResult.error && !isStackDepthError(profileResult.error)) {
        setSaving(false);
        setError(profileResult.error.message || "Unable to reject request.");
        return;
      }
    }

    setSuccess("Student request rejected.");
    setSaving(false);
    await loadData();
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

    if (!trainerPassword.trim()) {
      setSaving(false);
      setError("Trainer password is required.");
      return;
    }

    try {
      const nextTrainerEmail = trainerEmail.trim() || `trainer-${Date.now()}@trainer.local`;
      const authResult = await createTrainerAuthUser({
        email: nextTrainerEmail,
        password: trainerPassword.trim(),
        fullName: trainerName.trim(),
        status: trainerStatus,
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
        } else if (existingProfileResult.data?.id) {
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
        password: trainerPassword.trim(),
        trainerId,
      });

      if (emailResult?.error) {
        setSuccess("Trainer added successfully, but email delivery failed. Check SMTP settings and function deployment.");
      }

      setTrainerName("");
      setTrainerEmail("");
      setTrainerPassword("");
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

    const payload = {
      title: courseTitle.trim(),
      name: courseTitle.trim(),
      course_name: courseTitle.trim(),
      description: courseDescription.trim() || null,
      course_description: courseDescription.trim() || null,
      duration: courseDuration.trim() || null,
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

  const toggleCourseStatus = async (course) => {
    setSaving(true);
    setError("");
    setSuccess("");

    const nextStatus = (course.status || "active").toLowerCase() === "active" ? "inactive" : "active";
    const result = await safeUpdate("courses", course.id, { status: nextStatus });
    setSaving(false);

    if (result.error) {
      setError(result.error.message || "Unable to update course status.");
      return;
    }

    setSuccess("Course status updated.");
    await loadData();
  };

  const saveMapping = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    if (!mapStudentId || !mapTrainerId || !mapCourseId) {
      setSaving(false);
      setError("Please select student, trainer, and course.");
      return;
    }

    const existingEnrollment = enrollmentByProfile.get(String(mapStudentId));

    const mappingPayload = {
      profile_id: mapStudentId,
      user_id: mapStudentId,
      student_id: mapStudentId,
      trainer_id: mapTrainerId,
      course_id: mapCourseId,
      status: "active",
    };

    let mappingResult;
    if (existingEnrollment?.id) {
      mappingResult = await safeUpsert("enrollments", { ...mappingPayload, id: existingEnrollment.id }, "id");
      if (mappingResult.skipped && hasServiceRoleKey) {
        mappingResult = await serviceRoleUpsert("enrollments", { ...mappingPayload, id: existingEnrollment.id }, "id");
      }
    } else {
      mappingResult = await safeInsert("enrollments", mappingPayload);
      if (mappingResult.skipped && hasServiceRoleKey) {
        mappingResult = await serviceRoleInsert("enrollments", mappingPayload);
      }
    }

    if (mappingResult.skipped) {
      mappingResult = await safeUpsert("students", mappingPayload, "id");
      if (mappingResult.skipped && hasServiceRoleKey) {
        mappingResult = await serviceRoleUpsert("students", mappingPayload, "id");
      }

      if (!mappingResult.error && !mappingResult.skipped) {
        let courseResult = await safeInsert("student_courses", {
          student_id: mapStudentId,
          profile_id: mapStudentId,
          course_id: mapCourseId,
          trainer_id: mapTrainerId,
          status: "active",
        });
        if (courseResult.skipped && hasServiceRoleKey) {
          courseResult = await serviceRoleInsert("student_courses", {
            student_id: mapStudentId,
            profile_id: mapStudentId,
            course_id: mapCourseId,
            trainer_id: mapTrainerId,
            status: "active",
          });
        }
      }
    }

    if (mappingResult.error) {
      setSaving(false);
      setError(getDbErrorMessage(mappingResult.error, "Unable to map student."));
      return;
    }

    if (mappingResult.skipped) {
      setSaving(false);
      setError("Unable to save mapping. Please create an enrollments table or students/student_courses tables.");
      return;
    }

    setMapStudentId("");
    setMapTrainerId("");
    setMapCourseId("");
    setSaving(false);
    setSuccess("Student mapping saved.");
    await loadData();
  };

  const statCards = [
    { label: "Total Students", value: metrics.totalStudents, hint: "Registered student profiles" },
    { label: "Pending Approvals", value: metrics.pendingApprovals, hint: "Requests waiting action" },
    { label: "Active Courses", value: metrics.activeCourses, hint: "Courses available now" },
    { label: "Trainers", value: metrics.totalTrainers, hint: "Trainer profiles" },
    { label: "Mapped Students", value: metrics.mappedStudents, hint: "Assigned trainer + course" },
  ];

  const renderAnalytics = () => {
    return null;
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
                    <Icon size={16} aria-hidden="true" />
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

        <section className="cert-glass-panel overflow-hidden rounded-[2.5rem] shadow-[0_28px_85px_-48px_rgba(7,26,47,0.38)]">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative overflow-hidden bg-[linear-gradient(180deg,#061e33_0%,#06324f_56%,#10945a_100%)] p-6 text-white sm:p-8 lg:p-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(231,232,91,0.18),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(49,201,111,0.2),transparent_36%)]" />
              <div className="relative flex h-full flex-col justify-between gap-8">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cert-yellow ring-1 ring-white/10 backdrop-blur">
                    <Bell size={14} aria-hidden="true" />
                    Admin control center
                  </div>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-emerald-50/85 sm:text-base">
                    Approve student access, manage trainers and courses, map assignments, and monitor platform performance from one polished workspace.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-3">
                  {heroHighlights.map(({ label, value, icon: Icon }) => (
                    <div key={label} className="rounded-[1.5rem] border border-white/10 bg-white/10 p-4 backdrop-blur">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-50/70">{label}</p>
                          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
                        </div>
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/10">
                          <Icon size={18} aria-hidden="true" className="text-cert-yellow" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-4 bg-[radial-gradient(circle_at_90%_0%,rgba(231,232,91,0.14),transparent_32%),linear-gradient(180deg,#f8fcf8_0%,#eef9f1_100%)] p-6 sm:p-8 lg:p-10">
              <div className="rounded-[1.8rem] border border-cert-line bg-white p-5 shadow-[0_22px_50px_-38px_rgba(7,26,47,0.18)]">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cert-green-dark">Workspace focus</p>
                <p className="mt-3 text-2xl font-semibold text-cert-ink">Approvals, mapping, and analytics</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Use the quick tabs to move between requests, trainers, students, courses, and reporting without losing context.
                </p>
              </div>


            </div>
          </div>
        </section>

        {(error || success) && (
          <section className="space-y-3">
            {error && <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
            {success && <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>}
          </section>
        )}

        {activeTab === "overview" && (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {statCards.map((card) => (
              <article key={card.label} className="relative overflow-hidden rounded-[1.5rem] border border-cert-line bg-white p-5 shadow-[0_20px_48px_-36px_rgba(7,26,47,0.22)]">
                <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#06324f_0%,#31c96f_55%,#e7e85b_100%)]" />
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{card.label}</p>
                <p className="mt-3 text-4xl font-semibold text-cert-ink">{card.value}</p>
                <p className="mt-2 text-sm text-slate-500">{card.hint}</p>
              </article>
            ))}
          </section>
        )}

        {activeTab === "requests" && (
          <section className="rounded-[1.75rem] border border-cert-line bg-white p-6">
            <h2 className="text-2xl font-semibold text-cert-ink">Access Requests</h2>
            <p className="mt-2 text-sm text-slate-500">Review newly registered student accounts and approve or reject them.</p>
            <div className="mt-6 space-y-4">
              {requests.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No pending requests.</p>}
              {requests.map((request) => (
                <div key={`${request.source}-${request.id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{firstValue(request.full_name, request.name, request.email, "Student request")}</p>
                      {request.email && <p className="mt-1 text-sm text-slate-600">{request.email}</p>}
                      {request.message && <p className="mt-1 text-sm text-slate-600">{request.message}</p>}
                      <p className="mt-1 text-xs text-slate-500">Requested on {fmtDate(request.created_at)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => approveRequest(request)}
                        className="rounded-lg bg-cert-green px-3 py-2 text-sm font-semibold text-cert-ink hover:bg-cert-green-dark hover:text-white disabled:opacity-70"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => rejectRequest(request)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-70"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "trainers" && (
          <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[1.75rem] border border-cert-line bg-white p-6">
              <h2 className="text-2xl font-semibold text-cert-ink">Trainer List</h2>
              <p className="mt-2 text-sm text-slate-500">Add, view, update, and manage trainer profiles.</p>
              <div className="mt-6 space-y-3">
                {trainers.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No trainers found.</p>}
                {trainers.map((trainer) => (
                  <div key={trainer.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{firstValue(trainer.full_name, trainer.name, trainer.email, "Unnamed trainer")}</p>
                        {trainer.email && <p className="mt-1 text-sm text-slate-600">{trainer.email}</p>}
                        <p className="mt-1 text-sm text-slate-600">Students assigned: {trainerWorkloadById.get(trainer.id) || 0}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => toggleTrainerStatus(trainer)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-70"
                        >
                          {(trainer.status || "active").toLowerCase() === "active" ? "Set Inactive" : "Set Active"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => removeTrainer(trainer)}
                          className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-70"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={createTrainer} className="rounded-[1.75rem] border border-cert-line bg-white p-6">
              <h3 className="text-xl font-semibold text-cert-ink">Add Trainer</h3>
              <p className="mt-2 text-sm text-slate-500">Create a trainer profile for assignment workflows.</p>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Full name</label>
                  <input
                    value={trainerName}
                    onChange={(event) => setTrainerName(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    placeholder="Trainer name"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Email (optional)</label>
                  <input
                    value={trainerEmail}
                    onChange={(event) => setTrainerEmail(event.target.value)}
                    type="email"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    placeholder="trainer@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Password</label>
                  <input
                    value={trainerPassword}
                    onChange={(event) => setTrainerPassword(event.target.value)}
                    type="password"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    placeholder="Enter trainer password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Status</label>
                  <select
                    value={trainerStatus}
                    onChange={(event) => setTrainerStatus(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-xl bg-cert-navy px-4 py-3 text-sm font-semibold text-white hover:bg-cert-ink disabled:opacity-70"
                >
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
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {enrichedStudents.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No students found.</p>}
              {enrichedStudents.map((student) => (
                <article key={student.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{firstValue(student.full_name, student.name, student.email, "Student")}</p>
                      <p className="mt-1 text-sm text-slate-600">Student ID: {student.student_id || "N/A"}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEditStudent(student)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStudent(student)}
                        className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">Status: {student.status || "N/A"}</p>
                  <p className="mt-1 text-sm text-slate-600">Course: {student.enrolled_course}</p>
                  <p className="mt-1 text-sm text-slate-600">Trainer: {student.trainer_name}</p>
                  <p className="mt-1 text-sm text-slate-600">Progress: {student.progress || 0}%</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "courses" && (
          <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[1.75rem] border border-cert-line bg-white p-6">
              <h2 className="text-2xl font-semibold text-cert-ink">Course Management</h2>
              <p className="mt-2 text-sm text-slate-500">Create and manage course name, description, duration, and status.</p>
              <div className="mt-6 space-y-3">
                {courses.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No courses available.</p>}
                {courses.map((course) => (
                  <div key={course.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{firstValue(course.title, course.name, course.course_name, "Untitled course")}</p>
                        <p className="mt-1 text-sm text-slate-600">Description: {firstValue(course.description, course.course_description, "N/A")}</p>
                        <p className="mt-1 text-sm text-slate-600">Duration: {firstValue(course.duration, "N/A")}</p>
                        <p className="mt-1 text-sm text-slate-600">Status: {firstValue(course.status, "active")}</p>
                        <p className="mt-1 text-sm text-slate-600">Students enrolled: {courseEnrollmentById.get(course.id) || 0}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => toggleCourseStatus(course)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-70"
                        >
                          {(course.status || "active").toLowerCase() === "active" ? "Set Inactive" : "Set Active"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => removeCourse(course)}
                          className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-70"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={createCourse} className="rounded-[1.75rem] border border-cert-line bg-white p-6">
              <h3 className="text-xl font-semibold text-cert-ink">Create Course</h3>
              <p className="mt-2 text-sm text-slate-500">Add course name, description, duration, and status.</p>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Course name</label>
                  <input
                    value={courseTitle}
                    onChange={(event) => setCourseTitle(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    placeholder="Full Stack Development"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Description</label>
                  <input
                    value={courseDescription}
                    onChange={(event) => setCourseDescription(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    placeholder="Course description"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Duration</label>
                  <input
                    value={courseDuration}
                    onChange={(event) => setCourseDuration(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    placeholder="16 weeks"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Status</label>
                  <select
                    value={courseStatus}
                    onChange={(event) => setCourseStatus(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-xl bg-cert-navy px-4 py-3 text-sm font-semibold text-white hover:bg-cert-ink disabled:opacity-70"
                >
                  {saving ? "Saving..." : "Create course"}
                </button>
              </div>
            </form>
          </section>
        )}

        {activeTab === "mapping" && (
          <section>
            <form onSubmit={saveMapping} className="rounded-[1.75rem] border border-cert-line bg-white p-6 max-w-2xl">
              <h2 className="text-2xl font-semibold text-cert-ink">Mapping</h2>
              <p className="mt-2 text-sm text-slate-500">Assign students to trainers and map students to courses.</p>
              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Student</label>
                  <select
                    value={mapStudentId}
                    onChange={(event) => setMapStudentId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
                    required
                  >
                    <option value="">Select student</option>
                    {enrichedStudents.map((student) => (
                      <option key={student.id} value={student.id}>
                        {firstValue(student.full_name, student.name, student.email, student.id)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Trainer</label>
                  <select
                    value={mapTrainerId}
                    onChange={(event) => setMapTrainerId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
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

                <div>
                  <label className="block text-sm font-medium text-slate-700">Course</label>
                  <select
                    value={mapCourseId}
                    onChange={(event) => setMapCourseId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cert-green focus:bg-white focus:ring-4 focus:ring-cert-green/15"
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
                  className="w-full rounded-xl bg-cert-navy px-4 py-3 text-sm font-semibold text-white hover:bg-cert-ink disabled:opacity-70"
                >
                  {saving ? "Saving..." : "Save mapping"}
                </button>
              </div>
            </form>
          </section>
        )}

        {(activeTab === "overview" || activeTab === "analytics") && renderAnalytics()}
      </div>
    </div>
  );
}
