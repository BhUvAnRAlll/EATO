// Voice questions for the coach chat, the pure rules (no network, no database, so they are
// unit-tested directly). A phone whose own speech recogniser lacks the member's language (an
// iPhone for Kannada, for one) records a short clip instead; the server transcribes it and the
// text goes into the chat's box, unsent, exactly like the words the phone hears itself. The
// clip is checked by its real bytes, capped in size and length, and never stored or logged.
const { decodeBase64 } = require("../bodyComposition/upload");

const voiceLimits = {
  maxAudioBytes: 1024 * 1024, // 30 s of 64 kbps AAC is about 240 KB; 1 MB leaves room for a louder preset
  // The biggest allowed clip as base64 (4/3 of its bytes) plus the JSON around it
  maxBodyBytes: Math.ceil(1024 * 1024 * (4 / 3)) + 1024,
  maxSeconds: 30,
  textLength: 1000, // the chat's own limit on a message (chatRules.limits.text)
};

// The languages the app offers for speaking, as the transcription model names them
const LANGUAGES = { "en-IN": "en", "hi-IN": "hi", "kn-IN": "kn" };

// What a phone or a browser records: AAC in an MP4 container (iOS and Android), WAV, WebM (the web), MP3
const TYPES = {
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/mpeg": ".mp3",
};

// Real file type from the first bytes ("magic numbers"), never the client's label
function sniffAudioType(bytes) {
  const at = (offset, text) => [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  if (bytes.length >= 12 && at(4, "ftyp")) return "audio/mp4";
  if (bytes.length >= 12 && at(0, "RIFF") && at(8, "WAVE")) return "audio/wav";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (bytes.length >= 3 && (at(0, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return "audio/mpeg";
  return null;
}

// { data: base64, mediaType, language } → { ok, bytes, mediaType, extension, language } or
// { ok: false, status, error }. Nothing else is accepted in the body.
function checkVoiceClip(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "Send the clip as { data, mediaType, language }." };
  for (const key of Object.keys(body)) {
    if (!["data", "mediaType", "language"].includes(key)) return { ok: false, status: 400, error: `The request has an unexpected field: ${key}.` };
  }
  const { data, mediaType, language } = body;
  if (typeof data !== "string" || typeof mediaType !== "string" || typeof language !== "string") {
    return { ok: false, status: 400, error: "Send the clip as { data, mediaType, language }." };
  }
  if (!Object.hasOwn(LANGUAGES, language)) return { ok: false, status: 400, error: "Pick English, Hindi or Kannada." };
  const bytes = decodeBase64(data);
  if (!bytes) return { ok: false, status: 400, error: "The clip couldn't be read." };
  const actual = sniffAudioType(bytes);
  if (!actual || !TYPES[actual]) return { ok: false, status: 415, error: "Send an audio clip (M4A, WAV, WebM or MP3)." };
  if (actual !== mediaType) return { ok: false, status: 415, error: "The clip's type doesn't match its contents." };
  if (bytes.length > voiceLimits.maxAudioBytes) return { ok: false, status: 413, error: "That clip is too long. Keep a question under 30 seconds." };
  return { ok: true, bytes, mediaType: actual, extension: TYPES[actual], language: LANGUAGES[language] };
}

// The model's text → one clean line the chat box will accept: no control characters, single
// spaces, at most the chat's length. "" when nothing was said.
function cleanTranscript(text) {
  if (typeof text !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, voiceLimits.textLength);
}

// What tests get instead of a paid call, per language
const FAKE_TRANSCRIPTS = { en: "What should I eat today", hi: "आज मुझे क्या खाना चाहिए", kn: "ಇಂದು ಏನು ತಿನ್ನಬೇಕು" };

module.exports = { voiceLimits, LANGUAGES, TYPES, sniffAudioType, checkVoiceClip, cleanTranscript, FAKE_TRANSCRIPTS };
