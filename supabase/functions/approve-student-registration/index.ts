import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const studentEmail = (studentId: string) => `${studentId.toLowerCase()}@student.local`;
const password = () => `Stud@${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
const missingColumn = (error: { message?: string } | null) => error?.message?.match(/column "([^"]+)"/i)?.[1] || "";

const upsertProfile = async (client: ReturnType<typeof createClient>, payload: Record<string, unknown>) => {
  let nextPayload = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await client.from("profiles").upsert(nextPayload, { onConflict: "id" });
    if (!error) return null;
    const column = missingColumn(error);
    if (!column || !(column in nextPayload)) return error;
    delete nextPayload[column];
  }
  return { message: "Unable to activate the student profile." };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Approval service is not configured.");
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller.user) return Response.json({ error: "Sign in as an administrator to approve students." }, { status: 401, headers: corsHeaders });
    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
    if (callerProfile?.role !== "admin") return Response.json({ error: "Only administrators can approve students." }, { status: 403, headers: corsHeaders });

    const body = await req.json().catch(() => ({}));
    const name = text(body.name);
    const email = text(body.email).toLowerCase();
    let id = text(body.studentId).toUpperCase();
    const requestId = text(body.requestId);
    const requestSource = text(body.requestSource);
    let profileId = text(body.profileId);
    if (!name || !email) return Response.json({ error: "Student name and email are required." }, { status: 400, headers: corsHeaders });

    if (!id) {
      const { data, error } = await admin.rpc("next_student_login_id");
      if (error || typeof data !== "string") throw error || new Error("Unable to generate a Student ID.");
      id = data.trim().toUpperCase();
    }

    const authEmail = text(body.authEmail) || studentEmail(id);
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existingUser = users.users.find((user) =>
      user.id === profileId || user.email?.toLowerCase() === authEmail || user.user_metadata?.registered_email?.toLowerCase() === email,
    );
    const nextPassword = password();
    const authPayload = {
      email: authEmail,
      password: nextPassword,
      email_confirm: true,
      user_metadata: { full_name: name, registered_email: email, student_id: id, role: "student", status: "active" },
    };
    const authResult = existingUser
      ? await admin.auth.admin.updateUserById(existingUser.id, authPayload)
      : await admin.auth.admin.createUser(authPayload);
    if (authResult.error || !authResult.data.user) throw authResult.error || new Error("Unable to prepare the student login account.");
    profileId = authResult.data.user.id;

    const profileError = await upsertProfile(admin, {
      id: profileId, email, auth_email: authEmail, full_name: name, role: "student", status: "active", student_id: id, student_login_id: id,
    });
    if (profileError) throw profileError;

    if (requestSource === "access_requests" && requestId) {
      const { error } = await admin.from("access_requests").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", requestId);
      if (error) throw error;
    }

    const mailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, studentId: id, password: nextPassword }),
    });
    const mailData = await mailResponse.json().catch(() => ({}));
    if (!mailResponse.ok) return Response.json({ ok: true, emailError: mailData.error || "Student activated, but email delivery failed." }, { headers: corsHeaders });

    return Response.json({ ok: true, message: "Student request approved and credentials sent to student email." }, { headers: corsHeaders });
  } catch (error) {
    console.error("Student approval failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to approve the student." }, { status: 400, headers: corsHeaders });
  }
});
