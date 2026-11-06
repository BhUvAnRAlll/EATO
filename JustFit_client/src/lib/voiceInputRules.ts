// Voice input for the coach chat: the pure rules, with no React Native in them so they are
// unit-tested on Node. The phone's own speech recogniser (Apple's on iOS, Google's on Android,
// the browser's on the web) turns speech into text; nothing is recorded, uploaded or paid for.
// The words land in the ask box for the member to read and fix before they tap Send.

/** The languages the mic offers. The codes are BCP-47 tags the recognisers understand. */
export const VOICE_LANGUAGES = [
  { code: "en-IN", label: "English", native: "English" },
  { code: "hi-IN", label: "Hindi", native: "हिन्दी" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ" },
] as const;

export type VoiceLanguageCode = (typeof VOICE_LANGUAGES)[number]["code"];
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

export const DEFAULT_VOICE_LANGUAGE: VoiceLanguageCode = "en-IN";

export const isVoiceLanguage = (value: unknown): value is VoiceLanguageCode =>
  VOICE_LANGUAGES.some((language) => language.code === value);

/** "kn_IN", "kn-in" and "kn" all count as Kannada */
const languageOf = (tag: string) => tag.trim().toLowerCase().replace("_", "-").split("-")[0];

/**
 * The languages this phone can recognise, in the app's order. An empty list from the phone
 * (the web, Android 12 and below, or a failed read) means "unknown", and every language is
 * offered; the recogniser then says so itself if one isn't supported.
 */
export function availableVoiceLanguages(supportedLocales: readonly string[]): VoiceLanguage[] {
  if (supportedLocales.length === 0) return [...VOICE_LANGUAGES];
  const supported = new Set(supportedLocales.map(languageOf));
  const available = VOICE_LANGUAGES.filter((language) => supported.has(languageOf(language.code)));
  // A phone that recognises none of them still gets English: the recogniser reports the real answer
  return available.length > 0 ? available : [VOICE_LANGUAGES[0]];
}

/** The language to listen in: the member's choice when the phone has it, otherwise the first available */
export function resolveVoiceLanguage(chosen: VoiceLanguageCode, available: readonly VoiceLanguage[]): VoiceLanguageCode {
  return available.some((language) => language.code === chosen) ? chosen : (available[0]?.code ?? DEFAULT_VOICE_LANGUAGE);
}

/**
 * What the ask box shows while listening: whatever was typed before the mic was tapped, then
 * the words heard so far, within the chat's length limit.
 */
export function mergeTranscript(typedBefore: string, heard: string, maxLength: number): string {
  const base = typedBefore.trim();
  const words = heard.trim();
  const joined = base && words ? `${base} ${words}` : base || words;
  return joined.slice(0, maxLength);
}

/**
 * One friendly line for a recogniser error, or null when nothing needs saying (the member
 * stopped it themselves). `settings` marks the lines that the phone's Settings app can fix.
 */
export function voiceErrorMessage(code: string, languageLabel: string): { message: string; settings: boolean } | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return { message: "Allow the microphone and speech recognition in Settings to talk to your coach.", settings: true };
    case "language-not-supported":
      return { message: `This phone can't recognise ${languageLabel} yet. Try English, or type instead.`, settings: false };
    case "network":
      return { message: "Voice needs a connection right now. Try again, or type instead.", settings: false };
    case "no-speech":
    case "nomatch":
      return { message: "Didn't catch that. Try again a little closer to the mic.", settings: false };
    case "audio-capture":
    case "audio-busy":
      return { message: "The microphone isn't available right now. Close other apps using it and try again.", settings: false };
    default:
      return { message: "Voice input didn't work this time. You can type instead.", settings: false };
  }
}
