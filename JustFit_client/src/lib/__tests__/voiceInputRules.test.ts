// Voice input for the coach chat: which languages a phone offers, the text the box shows while
// listening, and the one line shown when the recogniser fails.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_VOICE_LANGUAGE,
  VOICE_LANGUAGES,
  isVoiceLanguage,
  mergeTranscript,
  resolveVoiceLanguage,
  voiceEngineFor,
  voiceErrorMessage,
} from "../voiceInputRules.ts";

describe("voiceEngineFor", () => {
  it("uses the phone's recogniser when it can't say what it supports (the web, old Android)", () => {
    assert.equal(voiceEngineFor("kn-IN", []), "phone");
    assert.equal(voiceEngineFor("en-IN", []), "phone");
  });

  it("uses the phone for a language it lists, whatever the tag's shape, and the server for one it leaves out", () => {
    const iphone = ["en-IN", "hi_IN", "ta-IN", "fr-FR"];
    assert.equal(voiceEngineFor("en-IN", iphone), "phone");
    assert.equal(voiceEngineFor("hi-IN", iphone), "phone");
    assert.equal(voiceEngineFor("kn-IN", iphone), "server");
    assert.equal(voiceEngineFor("kn-IN", ["kn"]), "phone");
  });
});

describe("resolveVoiceLanguage", () => {
  it("keeps the member's choice when it is offered, else falls back to the first offered", () => {
    assert.equal(resolveVoiceLanguage("kn-IN", VOICE_LANGUAGES), "kn-IN");
    const two = VOICE_LANGUAGES.slice(0, 2);
    assert.equal(resolveVoiceLanguage("kn-IN", two), "en-IN");
    assert.equal(resolveVoiceLanguage("hi-IN", two), "hi-IN");
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
