import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const requiredString = (value: unknown) => typeof value === "string" ? value.trim() : "";

const quizSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "question_sets"],
  properties: {
    title: { type: "string" },
    question_sets: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "array",
        minItems: 5,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "options", "correct_index"],
          properties: {
            question: { type: "string" },
            options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
            correct_index: { type: "integer", minimum: 0, maximum: 3 },
          },
        },
      },
    },
  },
};

const outputText = (response: Record<string, unknown>) => {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  return output.flatMap((item: Record<string, unknown>) => Array.isArray(item.content) ? item.content : [])
    .map((content: Record<string, unknown>) => content.text)
    .find((text): text is string => typeof text === "string") || "";
};

const fallbackQuiz = (context: { title: string; description: string; assignments: { title: string; description: string }[]; projects: { title: string; description: string }[] }) => {
  const topics = [context.description, ...context.assignments.flatMap((item) => [item.title, item.description]), ...context.projects.flatMap((item) => [item.title, item.description])]
    .map((value) => requiredString(value).replace(/\s+/g, " ").slice(0, 120))
    .filter(Boolean);
  const courseName = context.title;
  const topicFor = (index: number) => topics[index % topics.length] || `${courseName} core concepts`;
  const prompts = [
    (topic: string) => `Which course topic should you understand to complete work related to “${topic}”?`,
    (topic: string) => `What is the best way to demonstrate learning for “${topic}”?`,
    (topic: string) => `Which learning activity is most relevant to “${topic}”?`,
    (topic: string) => `When completing “${topic}”, what should guide your work?`,
    (topic: string) => `What should a successful submission for “${topic}” show?`,
  ];

  return {
    title: `${courseName} certificate test`,
    question_sets: Array.from({ length: 3 }, (_, setIndex) => Array.from({ length: 5 }, (_, questionIndex) => {
      const index = setIndex * 5 + questionIndex;
      const topic = topicFor(index);
      const correct = [
        `Apply the course requirements for ${topic}`,
        `Review the assigned material and demonstrate ${topic}`,
        `Use the trainer's instructions for ${topic}`,
        `Submit work that clearly addresses ${topic}`,
      ][index % 4];
      const options = [
        correct,
        `Skip the requirements for ${topic}`,
        "Submit work unrelated to the course",
        "Ignore the trainer's feedback and instructions",
      ];
      const correctIndex = index % 4;
      const orderedOptions = [...options.slice(correctIndex), ...options.slice(0, correctIndex)];
      return { question: `Assessment set ${setIndex + 1}: ${prompts[questionIndex](topic)}`, options: orderedOptions, correct_index: 0 };
    })),
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const courseId = requiredString(body.courseId);
    const token = requiredString(req.headers.get("Authorization")).replace(/^Bearer\s+/i, "");
    const supabaseUrl = requiredString(Deno.env.get("SUPABASE_URL"));
    const serviceRoleKey = requiredString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const openAiKey = requiredString(Deno.env.get("OPENAI_API_KEY"));
    if (!courseId || !token || !supabaseUrl || !serviceRoleKey) {
      return Response.json({ error: "Missing course details or server configuration." }, { status: 400, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });

    const { data: course, error: courseError } = await admin.from("courses").select("id,title,description,trainer_id").eq("id", courseId).maybeSingle();
    if (courseError || !course || String(course.trainer_id) !== userData.user.id) {
      return Response.json({ error: "You can only generate a test for your own course." }, { status: 403, headers: corsHeaders });
    }

    const [{ data: assignments }, { data: projects }] = await Promise.all([
      admin.from("assignments").select("title,description").eq("course_id", courseId),
      admin.from("projects").select("title,description").eq("course_id", courseId),
    ]);
    const learningContext = {
      title: requiredString(course.title) || "Untitled course",
      description: requiredString(course.description),
      assignments: (assignments || []).map((item) => ({ title: requiredString(item.title), description: requiredString(item.description) })),
      projects: (projects || []).map((item) => ({ title: requiredString(item.title), description: requiredString(item.description) })),
    };

    let generated: { title: string; question_sets: unknown[] } = fallbackQuiz(learningContext);
    if (openAiKey) {
      const aiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openAiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // This model supports Responses API structured output and is available to most API accounts.
          // It can be overridden per project with OPENAI_TEST_GENERATION_MODEL.
          model: Deno.env.get("OPENAI_TEST_GENERATION_MODEL") || "gpt-4o-mini",
          store: false,
          input: [
            { role: "system", content: "You create fair final-course multiple-choice assessments. Use only the supplied course material. Produce three different sets of five practical questions. Never repeat a question, answer, or distractor across sets. Each question needs one unambiguously correct answer and three plausible distractors. Do not include answers or explanations in question text." },
            { role: "user", content: `Create a certificate test for this course material:\n${JSON.stringify(learningContext)}` },
          ],
          text: { format: { type: "json_schema", name: "certificate_test", strict: true, schema: quizSchema } },
        }),
      });
      const aiBody = await aiResponse.json().catch(() => ({}));
      if (aiResponse.ok) generated = JSON.parse(outputText(aiBody));
      else console.warn("OpenAI test generation unavailable; using course-based fallback questions.", aiBody?.error?.message || aiResponse.status);
    }
    if (!Array.isArray(generated.question_sets) || generated.question_sets.length !== 3) throw new Error("The generated test was incomplete.");
    const questionTexts = new Set<string>();
    const questions = generated.question_sets.map((questionSet: unknown, setIndex: number) => {
      if (!Array.isArray(questionSet) || questionSet.length !== 5) throw new Error("The generated test has an incomplete question set.");
      return questionSet.map((question: Record<string, unknown>, questionIndex: number) => {
      const questionText = requiredString(question.question);
      const options = Array.isArray(question.options) ? question.options.map(requiredString) : [];
      const correctIndex = Number(question.correct_index);
      if (!questionText || options.length !== 4 || options.some((option) => !option) || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
        throw new Error("The generated test has an invalid question.");
      }
      const questionKey = questionText.toLocaleLowerCase().replace(/\s+/g, " ");
      if (questionTexts.has(questionKey)) throw new Error("The generated test repeated a question. Please generate it again.");
      questionTexts.add(questionKey);
      return { id: `s${setIndex + 1}q${questionIndex + 1}`, question: questionText, options, correct_option: String(correctIndex) };
      });
    });

    const { data: test, error: testError } = await admin.from("course_certificate_tests").upsert({
      course_id: courseId,
      trainer_id: userData.user.id,
      title: requiredString(generated.title) || `${learningContext.title} certificate test`,
      questions,
      passing_score: 75,
      updated_at: new Date().toISOString(),
    }, { onConflict: "course_id" }).select("id,title").single();
    if (testError) throw testError;
    return Response.json({ ok: true, test }, { headers: corsHeaders });
  } catch (error) {
    console.error("Certificate test generation failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to generate the certificate test." }, { status: 500, headers: corsHeaders });
  }
});
