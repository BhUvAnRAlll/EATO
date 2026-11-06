import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";

import { coachApi } from "@/lib/coach";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";
import { useVoiceClip } from "@/lib/useVoiceClip";
import {
  MAX_CLIP_SECONDS,
  VOICE_LANGUAGES,
  resolveVoiceLanguage,
  voiceEngineFor,
  voiceErrorMessage,
  type VoiceEngine,
  type VoiceLanguageCode,
} from "@/lib/voiceInputRules";
import { useVoiceInputStore } from "@/store/voiceInput";

// Speech to text for the coach chat. Two engines, chosen per language by voiceEngineFor:
//   "phone"   the phone's own recogniser (expo-speech-recognition: Apple's on iOS, Google's on
//             Android, the browser's on the web). Nothing is recorded or uploaded, nothing is paid.
//   "server"  for a language the phone's recogniser doesn't list (an iPhone for Kannada): a clip of
//             at most 30 s is recorded (lib/useVoiceClip) and POST /api/coach/voice transcribes it,
//             a small paid call counted on Admin › AI Usage. The clip is never stored.
// Either way the caller gets the words and puts them in a text box; the member reads and sends.
//
//   const voice = useVoiceInput();
//   voice.supported    false where there is no recogniser and no recorder (then show no mic)
//   voice.listening    true from start until the session ends
//   voice.transcribing true while the server works on a clip (the mic shows a spinner)
//   voice.transcript   the words heard so far in this session (interim, then final; empty again
//                      when the member cancels it, so nothing half heard is kept)
//   voice.error        one friendly line, or null; `error.settings` means Settings can fix it
//   voice.languages    every language offered, voice.language the one in use, voice.engine who listens
//   voice.start() / voice.stop() / voice.cancel() / voice.setLanguage(code)
export type VoiceError = { message: string; settings: boolean };

const recognitionAvailable = () => {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
};

export function useVoiceInput() {
  const [phoneEngine] = useState(recognitionAvailable);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<VoiceError | null>(null);
  const [supportedLocales, setSupportedLocales] = useState<string[]>([]);
  const chosen = useVoiceInputStore((state) => state.language);
  const setChosen = useVoiceInputStore((state) => state.setLanguage);
  const language = resolveVoiceLanguage(chosen, VOICE_LANGUAGES);
  const languageLabel = VOICE_LANGUAGES.find((l) => l.code === language)?.label ?? "English";
  // The server path needs a recorder, which the web build doesn't offer; the phone path needs a recogniser
  const engine: VoiceEngine = Platform.OS === "web" ? "phone" : voiceEngineFor(language, supportedLocales);
  const supported = phoneEngine || Platform.OS !== "web";
  const clip = useVoiceClip();
  const getToken = useSessionToken();
  // Which engine is listening right now, so an unmount or a trip to the background stops it
  const active = useRef<VoiceEngine | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which of the app's languages the phone's recogniser lists. The web (and Android 12 and
  // below) can't say, so the phone path stays in use for every language there.
  useEffect(() => {
    if (!phoneEngine || Platform.OS === "web") return;
    let cancelled = false;
    ExpoSpeechRecognitionModule.getSupportedLocales({})
      .then(({ locales }) => {
        if (!cancelled) setSupportedLocales(locales);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phoneEngine]);

  const fail = useCallback(
    (code: string) => {
      const line = voiceErrorMessage(code, languageLabel);
      if (line) {
        setError(line);
        haptic.error();
      }
    },
    [languageLabel],
  );

  // ---- the phone's recogniser ----
  useSpeechRecognitionEvent("start", () => {
    active.current = "phone";
    setListening(true);
  });
  useSpeechRecognitionEvent("end", () => {
    if (active.current === "phone") active.current = null;
    setListening(false);
  });
  useSpeechRecognitionEvent("result", (event) => {
    setTranscript(event.results[0]?.transcript ?? "");
  });
  useSpeechRecognitionEvent("error", (event) => {
    if (active.current === "phone") active.current = null;
    setListening(false);
    // The member stopped it themselves (Cancel, a language switch): what was half heard is dropped
    if (event.error === "aborted") setTranscript("");
    fail(event.error);
  });

  const clearCap = () => {
    if (capTimer.current) clearTimeout(capTimer.current);
    capTimer.current = null;
  };

  const cancel = useCallback(() => {
    clearCap();
    const which = active.current;
    if (!which) return;
    active.current = null;
    setListening(false);
    setTranscript("");
    if (which === "phone") {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // nothing to stop
      }
    } else {
      clip.cancel().catch(() => {});
    }
  }, [clip]);

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

  // ---- the server's transcription of a recorded clip ----
  const stopClip = useCallback(async () => {
    clearCap();
    if (active.current !== "server") return;
    active.current = null;
    haptic.tap();
    setListening(false);
    setTranscribing(true);
    try {
      const recorded = await clip.stop();
      if (!recorded) return fail("no-speech");
      const result = await coachApi.voice(await getToken(), { ...recorded, language });
      if (!result.ok) {
        setError({ message: result.error, settings: false });
        haptic.error();
        return;
      }
      setTranscript(result.data.text);
    } finally {
      setTranscribing(false);
    }
  }, [clip, fail, getToken, language]);

  const start = useCallback(async () => {
    if (!supported || active.current || transcribing) return;
    setError(null);
    setTranscript("");
    if (engine === "server") {
      const started = await clip.start();
      if (!started.ok) return fail(started.code);
      active.current = "server";
      haptic.select();
      setListening(true);
      // A question is short: the recording stops itself at the server's limit
      capTimer.current = setTimeout(() => {
        stopClip().catch(() => setTranscribing(false));
      }, MAX_CLIP_SECONDS * 1000);
      return;
    }
    let granted = false;
    try {
      granted = (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted;
    } catch {
      granted = false;
    }
    if (!granted) return fail("not-allowed");
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
      fail("audio-capture");
    }
  }, [supported, transcribing, engine, clip, fail, language, stopClip]);

  const stop = useCallback(() => {
    if (active.current === "server") {
      stopClip().catch(() => setTranscribing(false));
      return;
    }
    if (active.current !== "phone") return;
    haptic.tap();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      cancel();
    }
  }, [stopClip, cancel]);

  // Switching language mid-sentence ends the session; the next tap listens in the new language
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

  return {
    supported,
    listening,
    transcribing,
    transcript,
    error,
    clearError: () => setError(null),
    languages: VOICE_LANGUAGES,
    language,
    engine,
    setLanguage,
    start,
    stop,
    cancel,
    openSettings,
  };
}
