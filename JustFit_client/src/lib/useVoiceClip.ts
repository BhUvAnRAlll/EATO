import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { File } from "expo-file-system";

// Records one short clip of the member's voice (expo-audio, 64 kbps AAC in an .m4a) for the
// server to transcribe, for a phone whose own recogniser lacks the chosen language. The clip
// goes to the app's cache folder only while it is read as base64, then it is deleted. Used by
// lib/useVoiceInput, which owns the listening state, the 30-second cap and the upload.
export type VoiceClip = { data: string; mediaType: string };

export type ClipStart = { ok: true } | { ok: false; code: "not-allowed" | "audio-capture"; canAskAgain: boolean };

const mediaTypeOf = (uri: string) => (uri.endsWith(".webm") ? "audio/webm" : uri.endsWith(".wav") ? "audio/wav" : "audio/mp4");

export function useVoiceClip() {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const recording = useRef(false);

  const start = useCallback(async (): Promise<ClipStart> => {
    if (Platform.OS === "web") return { ok: false, code: "audio-capture", canAskAgain: false };
    let permission;
    try {
      permission = await requestRecordingPermissionsAsync();
    } catch {
      return { ok: false, code: "audio-capture", canAskAgain: false };
    }
    if (!permission.granted) return { ok: false, code: "not-allowed", canAskAgain: permission.canAskAgain };
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recording.current = true;
      return { ok: true };
    } catch {
      return { ok: false, code: "audio-capture", canAskAgain: true };
    }
  }, [recorder]);

  // Reads the clip, deletes the file. null when nothing was recorded.
  const finish = useCallback(async (keep: boolean): Promise<VoiceClip | null> => {
    if (!recording.current) return null;
    recording.current = false;
    try {
      await recorder.stop();
    } catch {
      // the recorder may already have stopped (an interruption)
    }
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    const uri = recorder.uri;
    if (!uri) return null;
    const file = new File(uri);
    let data: string | null = null;
    try {
      if (keep) data = await file.base64();
    } catch {
      data = null;
    }
    try {
      file.delete();
    } catch {
      // already gone
    }
    return data ? { data, mediaType: mediaTypeOf(uri) } : null;
  }, [recorder]);

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => finish(false).then(() => undefined), [finish]);

  return { start, stop, cancel };
}
