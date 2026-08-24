import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const certificateId = text((await req.json().catch(() => ({}))).certificateId).toUpperCase();
    const supabaseUrl = text(Deno.env.get("SUPABASE_URL"));
    const serviceRoleKey = text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!certificateId || !supabaseUrl || !serviceRoleKey) return Response.json({ valid: false, error: "Certificate ID is required." }, { status: 400, headers: corsHeaders });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: certificate, error } = await admin.from("certificates")
      .select("certificate_number, issue_date, status, student_id, course_id")
      .eq("certificate_number", certificateId)
      .maybeSingle();
    if (error || !certificate || (certificate.status && certificate.status !== "issued")) {
      return Response.json({ valid: false, error: "No issued certificate matches this ID." }, { status: 404, headers: corsHeaders });
    }

    const [{ data: student }, { data: course }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", certificate.student_id).maybeSingle(),
      admin.from("courses").select("title, name, course_name").eq("id", certificate.course_id).maybeSingle(),
    ]);

    return Response.json({
      valid: true,
      certificate: {
        certificateId: certificate.certificate_number,
        studentName: text(student?.full_name) || "Student",
        courseTitle: text(course?.title) || text(course?.name) || text(course?.course_name) || "Course",
        completionDate: certificate.issue_date,
      },
    }, { headers: corsHeaders });
  } catch (error) {
    console.error("Certificate verification failed:", error);
    return Response.json({ valid: false, error: "Unable to verify this certificate." }, { status: 500, headers: corsHeaders });
  }
});
