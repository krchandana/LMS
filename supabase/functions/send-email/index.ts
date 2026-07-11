import { serve } from "https://deno.land/std/http/server.ts";
import nodemailer from "npm:nodemailer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const requiredString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const smtpSecret = (name: string) => requiredString(Deno.env.get(name));
const normalizedSmtpPassword = (host: string, password: string) =>
  host.toLowerCase().includes("gmail.com") ? password.replace(/\s+/g, "") : password;
const smtpErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("535-5.7.8") || message.toLowerCase().includes("badcredentials")
    ? "Gmail rejected the SMTP login. Create a new Gmail App Password for SMTP_USER, set it as SMTP_PASS without spaces, then redeploy the function."
    : message;
};
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = requiredString(body.email);
    const name = requiredString(body.name);
    const studentId = requiredString(body.studentId);
    const password = requiredString(body.password);

    if (!email || !name || !studentId || !password) {
      return Response.json(
        { error: "Missing email, name, studentId, or password." },
        { status: 400, headers: corsHeaders },
      );
    }

    const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "587");
    const smtpSecure = Deno.env.get("SMTP_SECURE") === "true";
    const smtpUser = smtpSecret("SMTP_USER");
    const smtpPass = normalizedSmtpPassword(smtpHost, smtpSecret("SMTP_PASS"));
    const fromEmail = smtpSecret("SMTP_FROM") || smtpUser;
    const safeName = escapeHtml(name);
    const safeStudentId = escapeHtml(studentId);
    const safePassword = escapeHtml(password);

    if (!smtpUser || !smtpPass || !fromEmail) {
      return Response.json(
        { error: "SMTP is not configured. Set SMTP_USER, SMTP_PASS, and SMTP_FROM." },
        { status: 500, headers: corsHeaders },
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: fromEmail,
      to: email,
      subject: "Student registration approved",
      text: [
        `Hello ${name},`,
        "",
        "Your student registration has been approved.",
        "",
        `Name: ${name}`,
        `Student ID: ${studentId}`,
        `Password: ${password}`,
        "",
        "Use this Student ID and password to log in.",
        "",
        "Thank you.",
      ].join("\n"),
      html: `
        <h2>Student registration approved</h2>
        <p>Hello ${safeName},</p>
        <p>Your student registration has been approved.</p>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Student ID:</strong> ${safeStudentId}</p>
        <p><strong>Password:</strong> ${safePassword}</p>
        <p>Use this Student ID and password to log in.</p>
        <p>Thank you.</p>
      `,
    });

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("SMTP email failed:", error);

    return Response.json(
      { error: smtpErrorMessage(error) },
      { status: 500, headers: corsHeaders },
    );
  }
});
