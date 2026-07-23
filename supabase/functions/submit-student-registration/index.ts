import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const value = (input: unknown) => (typeof input === "string" ? input.trim() : "");
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const missingColumn = (error: { message?: string } | null) =>
  error?.message?.match(/column "([^"]+)"/i)?.[1] || error?.message?.match(/'([^']+)' column/i)?.[1] || "";

const saveWithColumnFallback = async (
  operation: (payload: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>,
  payload: Record<string, unknown>,
) => {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await operation(nextPayload);
    if (!error) return null;

    const column = missingColumn(error);
    if (!column || !(column in nextPayload)) return error;
    delete nextPayload[column];
  }

  return { message: "The database schema does not support this registration." };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const name = value(body.name);
    const email = value(body.email).toLowerCase();

    if (!name || !isValidEmail(email)) {
      return Response.json({ error: "Enter a name and a valid email address." }, { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Registration service is not configured.");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [profileResult, requestResult] = await Promise.all([
      admin.from("profiles").select("id,status").eq("email", email).limit(1),
      admin.from("access_requests").select("id,status").eq("email", email).limit(1),
    ]);
    const existing = profileResult.data?.[0] || requestResult.data?.[0];
    if (existing) {
      const status = value(existing.status).toLowerCase();
      const message = ["active", "approved"].includes(status)
        ? "An active student account already uses this email. Please sign in with the Student ID sent by admin."
        : status === "rejected"
          ? "This registration was previously rejected. Please contact the admin before registering again."
          : "A registration request for this email is already pending admin approval.";
      return Response.json({ ok: true, alreadyExists: true, message }, { headers: corsHeaders });
    }

    const { data: studentId, error: idError } = await admin.rpc("next_student_login_id");
    if (idError || typeof studentId !== "string" || !studentId.trim()) throw idError || new Error("Unable to generate a student ID.");

    const normalizedStudentId = studentId.trim().toUpperCase();
    const authEmail = `${normalizedStudentId.toLowerCase()}@student.local`;
    const temporaryPassword = `Pending@${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: authEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: name, registered_email: email, student_id: normalizedStudentId, role: "student", status: "pending" },
    });
    if (authError || !authData.user) throw authError || new Error("Unable to create the pending student account.");

    const userId = authData.user.id;
    const profileError = await saveWithColumnFallback(
      (payload) => admin.from("profiles").upsert(payload, { onConflict: "id" }),
      { id: userId, email, auth_email: authEmail, full_name: name, role: "student", status: "pending", student_id: normalizedStudentId, student_login_id: normalizedStudentId },
    );
    const requestError = profileError
      ? profileError
      : await saveWithColumnFallback(
        (payload) => admin.from("access_requests").insert(payload),
        { profile_id: userId, user_id: userId, student_id: normalizedStudentId, student_login_id: normalizedStudentId, full_name: name, name, email, auth_email: authEmail, role: "student", status: "pending", message: "Student login approval requested." },
      );

    if (requestError) {
      await admin.auth.admin.deleteUser(userId);
      throw requestError;
    }

    return Response.json({ ok: true, message: "Registration successful. Your request was sent to admin. After approval, admin will send your Student ID and password." }, { headers: corsHeaders });
  } catch (error) {
    console.error("Student registration failed:", error);
    const message = error instanceof Error ? error.message : "Unable to submit the registration request.";
    return Response.json({ error: message }, { status: 400, headers: corsHeaders });
  }
});
