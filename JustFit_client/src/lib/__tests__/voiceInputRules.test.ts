// Voice input for the coach chat: which languages a phone offers, the text the box shows while
// listening, and the one line shown when the recogniser fails.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_VOICE_LANGUAGE,
  VOICE_LANGUAGES,
  availableVoiceLanguages,
  isVoiceLanguage,
  mergeTranscript,
  resolveVoiceLanguage,
  voiceErrorMessage,
} from "../voiceInputRules.ts";

describe("availableVoiceLanguages", () => {
  it("offers every language when the phone can't say what it supports", () => {
    assert.deepEqual(availableVoiceLanguages([]), VOICE_LANGUAGES);
  });

  it("keeps only the languages the phone lists, in the app's order, whatever the tag's shape", () => {
    const codes = availableVoiceLanguages(["kn_IN", "EN-in", "ta-IN", "fr-FR"]).map((l) => l.code);
    assert.deepEqual(codes, ["en-IN", "kn-IN"]);
    assert.deepEqual(availableVoiceLanguages(["hi"]).map((l) => l.code), ["hi-IN"]);
  });

  it("still offers English when the phone lists none of them, so the recogniser can answer", () => {
    assert.deepEqual(availableVoiceLanguages(["de-DE"]).map((l) => l.code), ["en-IN"]);
  });
});

describe("resolveVoiceLanguage", () => {
  it("keeps the member's choice when the phone has it, else falls back to the first available", () => {
    const all = availableVoiceLanguages([]);
    assert.equal(resolveVoiceLanguage("kn-IN", all), "kn-IN");
    const iphone = availableVoiceLanguages(["en-IN", "hi-IN"]);
    assert.equal(resolveVoiceLanguage("kn-IN", iphone), "en-IN");
    assert.equal(resolveVoiceLanguage("hi-IN", iphone), "hi-IN");
    assert.equal(resolveVoiceLanguage("kn-IN", []), DEFAULT_VOICE_LANGUAGE);
  });

  it("recognises the app's codes and nothing else", () => {
    assert.equal(isVoiceLanguage("kn-IN"), true);
    assert.equal(isVoiceLanguage("kn"), false);
    assert.equal(isVoiceLanguage(null), false);
  });
});

describe("mergeTranscript", () => {
  it("adds the heard words after what was typed, within the limit", () => {
    assert.equal(mergeTranscript("", "how much protein", 1000), "how much protein");
    assert.equal(mergeTranscript("Coach, ", " how much protein ", 1000), "Coach, how much protein");
    assert.equal(mergeTranscript("typed", "", 1000), "typed");
    assert.equal(mergeTranscript("", "ಇಂದು ಏನು ತಿನ್ನಬೇಕು", 1000), "ಇಂದು ಏನು ತಿನ್ನಬೇಕು");
    assert.equal(mergeTranscript("abc", "defgh", 6), "abc de");
  });
});

describe("voiceErrorMessage", () => {
  it("says nothing when the member stopped it, and names Settings only for permissions", () => {
    assert.equal(voiceErrorMessage("aborted", "English"), null);
    assert.equal(voiceErrorMessage("not-allowed", "English")?.settings, true);
    assert.equal(voiceErrorMessage("network", "English")?.settings, false);
  });

  it("names the language the phone can't recognise", () => {
    assert.match(voiceErrorMessage("language-not-supported", "Kannada")!.message, /recognise Kannada/);
  });

  it("has a friendly line for anything unexpected", () => {
    assert.match(voiceErrorMessage("something-new", "English")!.message, /type instead/);
  });
});
