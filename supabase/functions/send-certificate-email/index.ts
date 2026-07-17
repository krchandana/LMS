import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std/http/server.ts";
import nodemailer from "npm:nodemailer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const requiredString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const formatIssueDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric" }).format(date);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const certificateId = requiredString((await req.json().catch(() => ({}))).certificateId);
    const token = requiredString(req.headers.get("Authorization")).replace(/^Bearer\s+/i, "");
    const supabaseUrl = requiredString(Deno.env.get("SUPABASE_URL"));
    const serviceRoleKey = requiredString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    if (!certificateId || !token || !supabaseUrl || !serviceRoleKey) {
      return Response.json({ error: "Missing certificate or server configuration." }, { status: 400, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });

    const { data: certificate, error: certificateError } = await admin
      .from("certificates")
      .select("id, student_id, course_id, issued_by, certificate_number, issue_date")
      .eq("id", certificateId)
      .maybeSingle();
    if (certificateError || !certificate || certificate.issued_by !== userData.user.id) {
      return Response.json({ error: "Certificate was not found for this trainer." }, { status: 403, headers: corsHeaders });
    }

    const [{ data: student }, { data: course }] = await Promise.all([
      admin.from("profiles").select("full_name, email").eq("id", certificate.student_id).maybeSingle(),
      admin.from("courses").select("title, duration").eq("id", certificate.course_id).maybeSingle(),
    ]);
    const email = requiredString(student?.email);
    if (!email) return Response.json({ error: "The student does not have an email address." }, { status: 400, headers: corsHeaders });

    const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = requiredString(Deno.env.get("SMTP_USER"));
    const smtpPass = requiredString(Deno.env.get("SMTP_PASS")).replace(/\s+/g, "");
    const fromEmail = requiredString(Deno.env.get("SMTP_FROM")) || smtpUser;
    if (!smtpUser || !smtpPass || !fromEmail) {
      return Response.json({ error: "SMTP is not configured. Set SMTP_USER, SMTP_PASS, and SMTP_FROM." }, { status: 500, headers: corsHeaders });
    }

    const studentName = requiredString(student?.full_name) || "Student";
    const courseName = requiredString(course?.title) || "your course";
    const courseDuration = requiredString(course?.duration) || "Duration not specified";
    const certificateNumber = requiredString(certificate.certificate_number) || `CERT-${certificate.id.slice(-8).toUpperCase()}`;
    const issueDate = formatIssueDate(requiredString(certificate.issue_date) || new Date().toISOString());
    const safeName = escapeHtml(studentName);
    const safeCourse = escapeHtml(courseName);
    const safeNumber = escapeHtml(certificateNumber);
    const safeDate = escapeHtml(issueDate);

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: Deno.env.get("SMTP_SECURE") === "true",
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({
      from: fromEmail,
      to: email,
      subject: `Certificate issued: ${courseName}`,
      text: [`Hello ${studentName},`, "", "Congratulations! Your certificate of completion has been issued by Certisured Learning Management System.", "", `Course: ${courseName}`, `Course duration: ${courseDuration}`, `Certificate number: ${certificateNumber}`, `Issue date: ${issueDate}`, "", "Sign in to the student portal to view and download your certificate."].join("\n"),
      html: `<main style="font-family:Arial,sans-serif;color:#071a2f;max-width:640px;margin:auto;border:1px solid #d8e7dc;border-radius:16px;overflow:hidden"><div style="background:#e9f8ef;padding:28px;text-align:center"><p style="margin:0;color:#049c54;font-weight:bold;letter-spacing:2px">CERTISURED</p><p style="margin:8px 0 0;font-size:11px;font-weight:bold;letter-spacing:1px;color:#526375">LEARNING MANAGEMENT SYSTEM</p><h1 style="margin:12px 0 0">Certificate of Completion</h1></div><div style="padding:28px"><p>Hello ${safeName},</p><p>Congratulations! Your certificate for <strong>${safeCourse}</strong> has been issued.</p><p><strong>Course duration:</strong> ${escapeHtml(courseDuration)}<br><strong>Certificate no.:</strong> ${safeNumber}<br><strong>Issue date:</strong> ${safeDate}</p><p>Sign in to the student portal to view and download your certificate.</p></div></main>`,
    });

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Certificate email failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to send certificate email." }, { status: 500, headers: corsHeaders });
  }
});
