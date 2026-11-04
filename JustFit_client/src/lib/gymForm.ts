import { useState } from "react";

import type { ApiResult } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";

// A gym portal form's save: one request at a time, the server's error line on failure, a success
// buzz and `done(data)` on success. The server checks every field again.
export function useGymSave<T>(done: (data: T) => void) {
  const getToken = useSessionToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (send: (token: string | null) => Promise<ApiResult<T>>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await send(await getToken().catch(() => null));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    haptic.success();
    done(result.data);
  };
  return { busy, error, save };
}
