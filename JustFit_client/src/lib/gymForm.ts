import { useRef, useState } from "react";

import type { ApiResult } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";

// A gym portal form's save: one request at a time, the server's error line on failure, a success
// buzz and `done(data)` on success. The server checks every field again.
export function useGymSave<T>(done: (data: T) => void) {
  const getToken = useSessionToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A ref, not the state: two taps in one frame both see busy === false (a double admission, or
  // an SMS sent and paid for twice)
  const running = useRef(false);
  const save = async (send: (token: string | null) => Promise<ApiResult<T>>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    let result: ApiResult<T>;
    try {
      result = await send(await getToken().catch(() => null));
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    haptic.success();
    done(result.data);
  };
  return { busy, error, save };
}
