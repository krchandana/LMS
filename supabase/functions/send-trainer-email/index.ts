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
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const validLoginUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
};

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
    const password = requiredString(body.password);
    const trainerId = requiredString(body.trainerId);
    const loginUrl = validLoginUrl(requiredString(body.loginUrl));

    if (!email || !name || !password || !trainerId) {
      return Response.json(
        { error: "Missing email, name, Trainer ID, or password." },
        { status: 400, headers: corsHeaders },
      );
    }

    const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "587");
    const smtpSecure = Deno.env.get("SMTP_SECURE") === "true";
    const smtpUser = smtpSecret("SMTP_USER");
    const smtpPass = normalizedSmtpPassword(smtpHost, smtpSecret("SMTP_PASS"));
    const fromEmail = smtpSecret("SMTP_FROM") || smtpUser;

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

    const safeName = escapeHtml(name);
    const safePassword = escapeHtml(password);
    const safeTrainerId = escapeHtml(trainerId);
    const safeLoginUrl = escapeHtml(loginUrl);
    const loginDetails = loginUrl
      ? ["", `Sign in: ${loginUrl}`]
      : ["", "Sign in from the trainer portal using the login name and password above."];
    const loginHtml = loginUrl
      ? `<p><a href="${safeLoginUrl}">Sign in to the trainer portal</a></p>`
      : "<p>Sign in from the trainer portal using the login name and password above.</p>";

    await transporter.sendMail({
      from: fromEmail,
      to: email,
      subject: "Trainer account created",
      text: [
        `Hello ${name},`,
        "",
        "Your trainer account has been created.",
        "",
        `Trainer name: ${name}`,
        `Trainer ID: ${trainerId}`,
        `Login email: ${email}`,
        `Password: ${password}`,
        ...loginDetails,
      ].join("\n"),
      html: `
        <h2>Trainer account created</h2>
        <p>Hello ${safeName},</p>
        <p>Your trainer account has been created.</p>
        <p><strong>Trainer name:</strong> ${safeName}</p>
        <p><strong>Trainer ID:</strong> ${safeTrainerId}</p>
        <p><strong>Login email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Password:</strong> ${safePassword}</p>
        ${loginHtml}
      `,
    });

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
});
