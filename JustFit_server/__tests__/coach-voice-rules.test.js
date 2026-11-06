// Voice questions for the coach chat: the clip is checked by its real bytes, the language by an
// allowlist, the body by its fields, and the model's text is made safe for the chat box.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { checkVoiceClip, cleanTranscript, sniffAudioType, voiceLimits, FAKE_TRANSCRIPTS } = require("../coach/voiceRules.js");

const b64 = (bytes, padTo = 0) => {
  const all = new Uint8Array(Math.max(bytes.length, padTo));
  all.set(bytes);
  return Buffer.from(all).toString("base64");
};
const M4A = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]; // ....ftypM4A
const WAV = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]; // RIFF....WAVE
const WEBM = [0x1a, 0x45, 0xdf, 0xa3];
const MP3 = [0x49, 0x44, 0x33, 0x04];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];

describe("sniffAudioType", () => {
  it("names the four clip types by their bytes and nothing else", () => {
    assert.equal(sniffAudioType(new Uint8Array(M4A)), "audio/mp4");
    assert.equal(sniffAudioType(new Uint8Array(WAV)), "audio/wav");
    assert.equal(sniffAudioType(new Uint8Array(WEBM)), "audio/webm");
    assert.equal(sniffAudioType(new Uint8Array(MP3)), "audio/mpeg");
    assert.equal(sniffAudioType(new Uint8Array(JPEG)), null);
    assert.equal(sniffAudioType(new Uint8Array([])), null);
  });
});

describe("checkVoiceClip", () => {
  const good = { data: b64(M4A, 64), mediaType: "audio/mp4", language: "kn-IN" };

  it("accepts a clip whose bytes match its type, with the model's language code", () => {
    const clip = checkVoiceClip(good);
    assert.equal(clip.ok, true);
    assert.deepEqual([clip.mediaType, clip.extension, clip.language, clip.bytes.length], ["audio/mp4", ".m4a", "kn", 64]);
    assert.equal(checkVoiceClip({ ...good, language: "hi-IN" }).language, "hi");
    assert.equal(checkVoiceClip({ ...good, language: "en-IN" }).language, "en");
  });

  it("refuses the wrong shape, an extra field, and a language it doesn't offer", () => {
    assert.equal(checkVoiceClip(null).status, 400);
    assert.equal(checkVoiceClip([]).status, 400);
    assert.equal(checkVoiceClip({ data: good.data, mediaType: "audio/mp4" }).status, 400);
    assert.match(checkVoiceClip({ ...good, userId: 7 }).error, /unexpected field: userId/);
    assert.match(checkVoiceClip({ ...good, language: "ta-IN" }).error, /English, Hindi or Kannada/);
    assert.equal(checkVoiceClip({ ...good, language: "kn" }).status, 400);
  });

  it("refuses bytes that aren't audio, a label that doesn't match, and bad base64", () => {
    assert.equal(checkVoiceClip({ ...good, data: b64(JPEG, 64) }).status, 415);
    assert.equal(checkVoiceClip({ ...good, mediaType: "audio/wav" }).status, 415);
    assert.equal(checkVoiceClip({ ...good, data: "not base64!" }).status, 400);
    assert.equal(checkVoiceClip({ ...good, data: "" }).status, 400);
  });

  it("caps the clip at the audio limit", () => {
    assert.equal(checkVoiceClip({ ...good, data: b64(M4A, voiceLimits.maxAudioBytes) }).ok, true);
    const over = checkVoiceClip({ ...good, data: b64(M4A, voiceLimits.maxAudioBytes + 1) });
    assert.equal(over.status, 413);
    assert.match(over.error, /30 seconds/);
  });
});

describe("cleanTranscript", () => {
  it("keeps the words in any script, drops control characters and caps the length", () => {
    assert.equal(cleanTranscript("  ಇಂದು   ಏನು\nತಿನ್ನಬೇಕು \u0000"), "ಇಂದು ಏನು ತಿನ್ನಬೇಕು");
    assert.equal(cleanTranscript(undefined), "");
    assert.equal(cleanTranscript(42), "");
    assert.equal(cleanTranscript("a".repeat(voiceLimits.textLength + 50)).length, voiceLimits.textLength);
  });

  it("has a fake sentence for each language tests can use", () => {
    assert.deepEqual(Object.keys(FAKE_TRANSCRIPTS).sort(), ["en", "hi", "kn"]);
  });
});
