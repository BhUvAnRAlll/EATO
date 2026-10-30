// The AI model behind the gym agent, behind one small interface so the provider can change:
//   complete({ instructions, messages }) → { reply, escalate, reason, inputTokens, outputTokens }
// OpenAI is the provider today (OPENAI_API_KEY, model AI_MODEL). Nothing is stored on the
// provider's side, and no prompt or reply is ever logged. In tests (NODE_ENV=test with
// AI_PROVIDER=fake) a deterministic stand-in is used instead.
const OpenAI = require("openai");

class AiError extends Error {
  constructor(code, retryable) {
    super(`AI request failed (${code})`);
    this.name = "AiError";
    this.code = code;
    this.retryable = retryable;
    this.publicMessage = `ai_${code}`;
  }
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "escalate", "reason"],
  properties: {
    reply: { type: "string" },
    escalate: { type: "boolean" },
    reason: { type: "string" },
  },
};

function openAiProvider({ model, timeoutMs = 20000 }) {
  const client = new OpenAI({ timeout: timeoutMs, maxRetries: 0 }); // the job queue retries, not the SDK
  return {
    model, // named on each ai_usage row
    async complete({ instructions, messages }) {
      let response;
      try {
        response = await client.responses.create({
          model,
          instructions,
          store: false,
          max_output_tokens: 400,
          input: messages.map((m) => ({ role: m.role, content: m.content })),
          text: { format: { type: "json_schema", name: "gym_agent_reply", strict: true, schema: SCHEMA } },
        });
      } catch (error) {
        if (error instanceof OpenAI.RateLimitError) throw new AiError("rate_limited", true);
        if (error instanceof OpenAI.APIConnectionError) throw new AiError("network", true);
        if (error instanceof OpenAI.APIError) throw new AiError(`status_${error.status ?? "unknown"}`, (error.status ?? 500) >= 500);
        throw error;
      }
      let parsed = null;
      try { parsed = JSON.parse(response.output_text ?? ""); } catch { /* handled below */ }
      if (!parsed || typeof parsed.reply !== "string") throw new AiError("bad_output", true);
      return {
        reply: parsed.reply,
        escalate: parsed.escalate === true,
        reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : "",
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };
    },
  };
}

// Tests only: answers from the first FAQ that shares a word with the question, says a price
// only when told to (to prove the price guard), and fails or escalates on request.
function fakeProvider() {
  return {
    model: "fake",
    calls: [],
    async complete({ instructions, messages }) {
      this.calls.push({ instructions, messages });
      const last = messages.at(-1)?.content ?? "";
      if (/FAIL_AI/.test(last)) throw new AiError("status_500", true);
      if (/INVENT_PRICE/.test(last)) return { reply: "Our yearly plan is ₹99,999.", escalate: false, reason: "", inputTokens: 10, outputTokens: 5 };
      if (/HUMAN_PLEASE/.test(last)) return { reply: "Let me get someone from the team for you.", escalate: true, reason: "asked for a person", inputTokens: 10, outputTokens: 5 };
      const facts = /<gym_facts>(\{[\s\S]*\})<\/gym_facts>/.exec(instructions)?.[1] ?? "{}";
      const faqs = JSON.parse(facts).faqs ?? [];
      const words = last.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const faq = faqs.find((f) => words.some((w) => f.question.toLowerCase().includes(w)));
      return faq
        ? { reply: faq.answer, escalate: false, reason: "", inputTokens: 20, outputTokens: 10 }
        : { reply: "I'm not sure about that. A team member will follow up.", escalate: true, reason: "unknown", inputTokens: 20, outputTokens: 10 };
    },
  };
}

function createAiProvider(env = process.env) {
  if (env.NODE_ENV === "test" && env.AI_PROVIDER === "fake") return fakeProvider();
  return openAiProvider({ model: env.AI_MODEL || "gpt-4o-mini" });
}

module.exports = { createAiProvider, fakeProvider, AiError };
