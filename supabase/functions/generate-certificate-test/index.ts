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
  const topics = [...context.assignments.map((item) => item.title), ...context.projects.map((item) => item.title), context.title]
    .map((value) => requiredString(value).replace(/\s+/g, " ").slice(0, 64))
    .filter(Boolean);
  const courseName = context.title;
  const normalizedCourseName = courseName.toLowerCase();
  const courseTopics = normalizedCourseName.includes("agentic")
    ? [
      ["planning", "Break a complex goal into clear, actionable steps.", "Generate random responses without a goal.", "Store only the final answer.", "Avoid deciding what to do next."],
      ["memory", "Retain relevant context from earlier interactions and tasks.", "Delete all context after each step.", "Replace every answer with the same text.", "Prevent the agent from using prior information."],
      ["tool use", "Call an appropriate external tool or API to complete a task.", "Guess data that a tool could provide.", "Avoid using any available tool.", "Use a tool without checking its result."],
      ["natural language processing", "Understand and work with human language in text or speech.", "Only store images without analysing them.", "Turn off all user input.", "Avoid interpreting the user's request."],
      ["feedback", "Use evaluation results to improve the next action or response.", "Ignore every evaluation result.", "Repeat an error without checking it.", "Stop learning after the first response."],
    ]
    : normalizedCourseName.includes("python")
      ? [
        ["a Python function", "Reuse a named block of code to perform a task.", "Store only a web page layout.", "Replace every variable with text.", "Run code without a defined task."],
        ["a Python list", "Store an ordered, changeable collection of values.", "Store only one unchangeable value.", "Prevent values from being accessed.", "Compile a program into machine code."],
        ["a dictionary", "Map unique keys to related values.", "Store values only by their screen position.", "Create a loop with no condition.", "Prevent data from having labels."],
        ["a loop", "Repeat a block of code while processing multiple values.", "Run a block only after deleting it.", "Stop a program before it starts.", "Replace all conditions with comments."],
        ["indentation", "Define the structure and code blocks in Python.", "Change only the font of a program.", "Add a database connection.", "Remove every function parameter."],
      ]
      : normalizedCourseName.includes("machine learning")
        ? [
          ["training data", "Provide examples from which a model can learn patterns.", "Guarantee a model never receives examples.", "Only store the final prediction.", "Remove all input features."],
          ["a feature", "Represent an input attribute used by a model for prediction.", "Represent only the final model score.", "Delete a training example.", "Prevent a model from receiving input."],
          ["a test set", "Evaluate how well a trained model performs on unseen data.", "Train a model repeatedly on the same answer key.", "Replace labels with blank values.", "Remove model evaluation entirely."],
          ["overfitting", "Learning training examples too closely and generalising poorly.", "Improving performance on unseen data.", "Collecting a balanced dataset.", "Using evaluation data correctly."],
          ["supervised learning", "Learn from examples that include known target labels.", "Learn without any input data.", "Remove all target values from a task.", "Use only random guesses as labels."],
        ]
        : [];
  if (courseTopics.length === 5) {
    const stems = [
      (topic: string) => `What is the primary role of ${topic} in ${courseName}?`,
      (topic: string) => `In a ${courseName} task, which use of ${topic} is correct?`,
      (topic: string) => `Which outcome shows effective use of ${topic} in ${courseName}?`,
    ];
    return {
      title: `${courseName} certificate test`,
      question_sets: stems.map((stem, setIndex) => courseTopics.map(([topic, correct, ...incorrect], questionIndex) => ({
        question: stem(topic),
        options: [correct, ...incorrect],
        correct_index: 0,
      }))),
    };
  }
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
      // The correct answer is deliberately kept first, matching correct_index 0.
      // Do not reorder this array without updating correct_index as well.
      return { question: `Assessment set ${setIndex + 1}: ${prompts[questionIndex](topic)}`, options, correct_index: 0 };
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
