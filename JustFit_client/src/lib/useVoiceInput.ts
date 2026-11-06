import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";

import { haptic } from "@/lib/haptics";
import {
  VOICE_LANGUAGES,
  availableVoiceLanguages,
  resolveVoiceLanguage,
  voiceErrorMessage,
  type VoiceLanguage,
  type VoiceLanguageCode,
} from "@/lib/voiceInputRules";
import { useVoiceInputStore } from "@/store/voiceInput";

// Speech to text with the phone's own recogniser (expo-speech-recognition: Apple's on iOS,
// Google's on Android, the browser's on the web). Audio never leaves the recogniser the phone
// already has; justFit records nothing, uploads nothing and pays nothing. The caller gets the
// words heard so far and puts them in a text box; the member reads them and taps Send.
//
//   const voice = useVoiceInput();
//   voice.supported   false where there is no recogniser (then show no mic at all)
//   voice.listening   true between start and the end of the session
//   voice.transcript  the words heard so far in this session (interim, then final; empty again
//                     when the member cancels it, so nothing half heard is kept)
//   voice.error       one friendly line, or null; `error.settings` means Settings can fix it
//   voice.languages   the languages this phone offers, voice.language the one in use
//   voice.start() / voice.stop() / voice.cancel() / voice.setLanguage(code)
export type VoiceError = { message: string; settings: boolean };

const isAvailable = () => {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
};

export function useVoiceInput() {
  const [supported] = useState(isAvailable);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<VoiceError | null>(null);
  const [languages, setLanguages] = useState<VoiceLanguage[]>(() => [...VOICE_LANGUAGES]);
  const chosen = useVoiceInputStore((state) => state.language);
  const setChosen = useVoiceInputStore((state) => state.setLanguage);
  const language = resolveVoiceLanguage(chosen, languages);
  const languageLabel = VOICE_LANGUAGES.find((l) => l.code === language)?.label ?? "English";
  // Set while the member is listening, so an unmount or a trip to the background stops it
  const active = useRef(false);

  // Which of the app's languages this phone can recognise. The web (and Android 12 and below)
  // can't say, so every language stays offered there.
  useEffect(() => {
    if (!supported || Platform.OS === "web") return;
    let cancelled = false;
    ExpoSpeechRecognitionModule.getSupportedLocales({})
      .then(({ locales }) => {
        if (!cancelled) setLanguages(availableVoiceLanguages(locales));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [supported]);

  useSpeechRecognitionEvent("start", () => {
    active.current = true;
    setListening(true);
  });
  useSpeechRecognitionEvent("end", () => {
    active.current = false;
    setListening(false);
  });
  useSpeechRecognitionEvent("result", (event) => {
    setTranscript(event.results[0]?.transcript ?? "");
  });
  useSpeechRecognitionEvent("error", (event) => {
    active.current = false;
    setListening(false);
    // The member stopped it themselves (Cancel, a language switch): what was half heard is dropped
    if (event.error === "aborted") setTranscript("");
    const line = voiceErrorMessage(event.error, languageLabel);
    if (line) {
      setError(line);
      haptic.error();
    }
  });

  const cancel = useCallback(() => {
    if (!active.current) return;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // nothing to stop
    }
    active.current = false;
    setListening(false);
    setTranscript("");
  }, []);

  // Leaving the screen, or sending the app to the background, stops the microphone
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") cancel();
    });
    return () => {
      sub.remove();
      cancel();
    };
  }, [cancel]);

  const start = useCallback(async () => {
    if (!supported || active.current) return;
    setError(null);
    setTranscript("");
    let granted = false;
    let canAskAgain = true;
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      granted = permission.granted;
      canAskAgain = permission.canAskAgain;
    } catch {
      granted = false;
    }
    if (!granted) {
      setError(voiceErrorMessage("not-allowed", languageLabel));
      if (!canAskAgain) haptic.error();
      return;
    }
    haptic.select();
    try {
      ExpoSpeechRecognitionModule.start({
        lang: language,
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        addsPunctuation: true,
        iosTaskHint: "dictation",
      });
    } catch {
      setError(voiceErrorMessage("audio-capture", languageLabel));
    }
  }, [supported, language, languageLabel]);

  const stop = useCallback(() => {
    if (!active.current) return;
    haptic.tap();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      cancel();
    }
  }, [cancel]);

  // Switching language mid-sentence starts a fresh session in the new language
  const setLanguage = useCallback(
    (code: VoiceLanguageCode) => {
      if (code === chosen) return;
      haptic.select();
      setChosen(code);
      if (active.current) cancel();
    },
    [chosen, setChosen, cancel],
  );

  const openSettings = useCallback(() => {
    if (Platform.OS === "web") return;
    Linking.openSettings().catch(() => {});
  }, []);

  return { supported, listening, transcript, error, clearError: () => setError(null), languages, language, setLanguage, start, stop, cancel, openSettings };
}
