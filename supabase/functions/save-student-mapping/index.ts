import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Mapping service is not configured.");
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller.user) return Response.json({ error: "Sign in as an administrator to manage mappings." }, { status: 401, headers: corsHeaders });
    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
    if (callerProfile?.role !== "admin") return Response.json({ error: "Only administrators can manage mappings." }, { status: 403, headers: corsHeaders });

    const body = await req.json().catch(() => ({}));
    const studentIds = Array.from(new Set(Array.isArray(body.studentIds) ? body.studentIds.map(text).filter(Boolean) : []));
    const trainerId = text(body.trainerId);
    const courseId = text(body.courseId);
    if (!studentIds.length || !trainerId || !courseId) {
      return Response.json({ error: "Select at least one student, a trainer, and a course." }, { status: 400, headers: corsHeaders });
    }

    const [{ data: trainer, error: trainerError }, { data: course, error: courseError }] = await Promise.all([
      admin.from("profiles").select("id,full_name,email,role,status").eq("id", trainerId).maybeSingle(),
      admin.from("courses").select("id").eq("id", courseId).maybeSingle(),
    ]);
    if (trainerError || !trainer || trainer.role !== "trainer") throw trainerError || new Error("Selected trainer was not found.");
    if (courseError || !course) throw courseError || new Error("Selected course was not found.");

    const trainerName = text(trainer.full_name) || text(trainer.email) || "Trainer";
    const { error: courseUpdateError } = await admin.from("courses").update({ trainer_id: trainerId, trainer_name: trainerName }).eq("id", courseId);
    if (courseUpdateError) throw courseUpdateError;

    const failedStudentIds: string[] = [];
    for (const studentId of studentIds) {
      const { data: existingEnrollment, error: lookupError } = await admin
        .from("enrollments")
        .select("id")
        .eq("student_id", studentId)
        .eq("course_id", courseId)
        .maybeSingle();
      if (lookupError) {
        failedStudentIds.push(studentId);
        continue;
      }

      const enrollment = { student_id: studentId, course_id: courseId, enrollment_status: "active" };
      const { error: enrollmentError } = existingEnrollment?.id
        ? await admin.from("enrollments").update(enrollment).eq("id", existingEnrollment.id)
        : await admin.from("enrollments").insert(enrollment);
      if (enrollmentError) failedStudentIds.push(studentId);
    }

    const mappedCount = studentIds.length - failedStudentIds.length;
    if (!mappedCount) throw new Error("The selected students could not be enrolled.");
    return Response.json({ ok: true, mappedCount, failedStudentIds, trainerName }, { headers: corsHeaders });
  } catch (error) {
    console.error("Mapping save failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save the mapping." }, { status: 400, headers: corsHeaders });
  }
});
