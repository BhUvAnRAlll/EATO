// Turns a short voice clip into text with OpenAI's transcription model (server only), for a
// phone whose own recogniser lacks the member's language. The clip is held in memory for the
// one call and never written to disk, stored or logged; the text is answered to the app for the
// member to read and send themselves. In tests (NODE_ENV=test with AI_PROVIDER=fake) a fixed
// sentence in the asked language is answered instead.
const OpenAI = require("openai");
const { toFile } = require("openai");

const models = require("../ai/models");
const { cleanTranscript, FAKE_TRANSCRIPTS } = require("./voiceRules");

// The model comes from ai/models.js (AI_MODEL_COACH_VOICE): a small transcription model
const FEATURE = "coach_voice";

// A failure the member can act on: `status` is the HTTP status to answer with
class VoiceError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "VoiceError";
    this.status = status;
  }
}

const NOTHING_HEARD = "We couldn't hear any words. Try again a little closer to the mic.";

// { bytes, mediaType, extension, language } → { text }. `usage` (ai/usage.tracker) records
// the call for the admin's AI Usage screen; never the audio or the words.
async function transcribeClip(clip, env = process.env, usage = null) {
  if (models.isFake(env)) {
    await usage?.record({ provider: "openai", model: "fake", inputTokens: 40, outputTokens: 8, status: "ok" });
    return { text: cleanTranscript(FAKE_TRANSCRIPTS[clip.language]) };
  }

  const { model: MODEL } = models.settingsFor(FEATURE, env);
  const client = models.openaiClient();
  let response;
  try {
    response = await client.audio.transcriptions.create({
      file: await toFile(Buffer.from(clip.bytes), `clip${clip.extension}`, { type: clip.mediaType }),
      model: MODEL,
      language: clip.language,
      response_format: "json",
    });
  } catch (error) {
    await usage?.record({ provider: "openai", model: MODEL, status: "failed" });
    // Never log the request or response content, only the status
    if (error instanceof OpenAI.RateLimitError) throw new VoiceError("We're busy right now. Please try again in a minute.", 503);
    if (error instanceof OpenAI.APIError) {
      console.error(`Voice transcription failed: OpenAI ${error.status ?? "unknown"} ${error.name}`);
      throw new VoiceError("We couldn't hear that right now. Please try again, or type instead.", 502);
    }
    throw error;
  }

  const text = cleanTranscript(response?.text);
  // Transcription models bill by audio token (usage.type "tokens"); whisper by seconds, recorded as no tokens
  const tokens = response?.usage?.type === "tokens" ? response.usage : null;
  await usage?.record({
    provider: "openai", model: MODEL, inputTokens: tokens?.input_tokens, outputTokens: tokens?.output_tokens,
    status: text ? "ok" : "refused",
  });
  if (!text) throw new VoiceError(NOTHING_HEARD, 422);
  return { text };
}

module.exports = { VoiceError, transcribeClip, FEATURE };
