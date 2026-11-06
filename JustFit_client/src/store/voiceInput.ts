import { create } from "zustand";

import { DEFAULT_VOICE_LANGUAGE, type VoiceLanguageCode } from "@/lib/voiceInputRules";

// The language the member last spoke to the coach in. Kept for this app session only (nothing
// is stored on the device beyond the session token); the next launch starts in English again.
type VoiceInputState = {
  language: VoiceLanguageCode;
  setLanguage: (language: VoiceLanguageCode) => void;
};

export const useVoiceInputStore = create<VoiceInputState>((set) => ({
  language: DEFAULT_VOICE_LANGUAGE,
  setLanguage: (language) => set({ language }),
}));
