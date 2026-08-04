import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std/http/server.ts";
import nodemailer from "npm:nodemailer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric" }).format(date);
};

const submissionPageUrl = ({ appUrl, workType, courseId, workTitle, assignedDate, endDate }: {
  appUrl: string;
  workType: string;
  courseId: string;
  workTitle: string;
  assignedDate: string;
  endDate: string;
}) => {
  if (!appUrl) return "";

  try {
    const baseUrl = new URL(appUrl);
    if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") return "";

    const url = new URL("/student", baseUrl.origin);
    url.searchParams.set("workType", workType);
    url.searchParams.set("courseId", courseId);
    url.searchParams.set("workTitle", workTitle);
    url.searchParams.set("assignedDate", assignedDate);
    url.searchParams.set("endDate", endDate);
    return url.toString();
  } catch {
    return "";
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const courseId = text(body.courseId);
    const workTitle = text(body.workTitle) || text(body.assignmentTitle);
    const workType = text(body.workType).toLowerCase() === "project" ? "project" : "assignment";
    const workLabel = workType === "project" ? "Project" : "Assignment";
    const assignedDate = text(body.assignedDate);
    const endDate = text(body.endDate);
    // Existing deployed trainer pages may not yet send `appUrl`. The request
    // origin is the live LMS address in that case, while SITE_URL remains a
    // useful fallback for server-side callers.
    const appUrl = text(body.appUrl) || text(Deno.env.get("SITE_URL")) || text(req.headers.get("Origin"));
    const token = text(req.headers.get("Authorization")).replace(/^Bearer\s+/i, "");
    const supabaseUrl = text(Deno.env.get("SUPABASE_URL"));
    const serviceRoleKey = text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    if (!courseId || !workTitle || !assignedDate || !endDate || !token || !supabaseUrl || !serviceRoleKey) {
      return Response.json({ error: "Missing assignment details or server configuration." }, { status: 400, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });

    const { data: course, error: courseError } = await admin
      .from("courses")
      .select("*")
      .eq("id", courseId)
      .maybeSingle();
    if (courseError || !course || String(course.trainer_id) !== userData.user.id) {
      return Response.json({ error: "You can only notify students in your own course." }, { status: 403, headers: corsHeaders });
    }

    const { data: enrollments, error: enrollmentError } = await admin
      .from("enrollments")
      .select("student_id")
      .eq("course_id", courseId)
      .not("student_id", "is", null);
    if (enrollmentError) throw enrollmentError;

    const studentIds = [...new Set((enrollments || []).map((row) => row.student_id).filter(Boolean))];
    if (!studentIds.length) return Response.json({ ok: true, sentCount: 0, failedCount: 0, skippedCount: 0 }, { headers: corsHeaders });

    const { data: students, error: studentsError } = await admin
      .from("profiles")
      .select("id,full_name,email")
      .in("id", studentIds);
    if (studentsError) throw studentsError;

    const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = text(Deno.env.get("SMTP_USER"));
    const smtpPass = text(Deno.env.get("SMTP_PASS")).replace(/\s+/g, "");
    const fromEmail = text(Deno.env.get("SMTP_FROM")) || smtpUser;
    if (!smtpUser || !smtpPass || !fromEmail) {
      return Response.json({ error: "SMTP is not configured. Set SMTP_USER, SMTP_PASS, and SMTP_FROM." }, { status: 500, headers: corsHeaders });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: Deno.env.get("SMTP_SECURE") === "true",
      auth: { user: smtpUser, pass: smtpPass },
    });
    const courseName = text(course.title) || text(course.name) || text(course.course_name) || "your course";
    const safeCourseName = escapeHtml(courseName);
    const safeTitle = escapeHtml(workTitle);
    const safeEndDate = escapeHtml(formatDate(endDate));
    const workSubmissionUrl = submissionPageUrl({ appUrl, workType, courseId, workTitle, assignedDate, endDate });
    const safeSubmissionUrl = escapeHtml(workSubmissionUrl);

    const results = await Promise.allSettled((students || []).map(async (student) => {
      const email = text(student.email);
      if (!email) return "skipped";
      const studentName = text(student.full_name) || "Student";
      await transporter.sendMail({
        from: fromEmail,
        to: email,
        subject: `New ${workLabel}: ${workTitle}`,
        text: [
          `Hello ${studentName},`,
          "",
          `Your trainer has assigned a new ${workType} for ${courseName}. It is due on`,
          formatDate(endDate) + ".",
          "",
          `Course: ${courseName}`,
          `${workLabel}: ${workTitle}`,
          "",
          workSubmissionUrl ? `Submit your ${workType}: ${workSubmissionUrl}` : "Please sign in to Certisured LMS and submit it before the deadline.",
          "",
          "Regards,",
          "Certisured LMS",
        ].join("\n"),
        html: `<main style="font-family:Arial,sans-serif;color:#071a2f;max-width:640px;margin:auto;border:1px solid #d8e7dc;border-radius:16px;overflow:hidden"><header style="background:#e9f8ef;padding:28px;text-align:center"><p style="margin:0;color:#049c54;font-weight:bold;letter-spacing:2px">CERTISURED LMS</p><h1 style="margin:12px 0 0;font-size:24px">New ${workLabel}</h1></header><section style="padding:28px"><p>Hello ${escapeHtml(studentName)},</p><p>Your trainer has assigned a new <strong>${safeCourseName}</strong> ${workType}, due on<br><strong>${safeEndDate}</strong>.</p><p><strong>Course:</strong> ${safeCourseName}<br><strong>${workLabel}:</strong> ${safeTitle}</p>${workSubmissionUrl ? `<p style="margin:28px 0"><a href="${safeSubmissionUrl}" style="display:inline-block;background:#049c54;color:#ffffff;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Submit ${workLabel}</a></p><p style="font-size:13px;color:#526375">The link opens this ${workType} in Certisured LMS. Sign in with your student account if prompted.</p>` : "<p>Please sign in to Certisured LMS and submit it before the deadline.</p>"}<p>Regards,<br>Certisured LMS</p></section></main>`,
      });
      return "sent";
    }));

    const sentCount = results.filter((result) => result.status === "fulfilled" && result.value === "sent").length;
    const skippedCount = results.filter((result) => result.status === "fulfilled" && result.value === "skipped").length;
    const failedCount = results.filter((result) => result.status === "rejected").length;
    return Response.json({ ok: true, sentCount, skippedCount, failedCount }, { headers: corsHeaders });
  } catch (error) {
    console.error("Assignment notification email failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to send assignment notification emails." }, { status: 500, headers: corsHeaders });
  }
});
