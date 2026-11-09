import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { addressApi, type AddressBook } from "@/lib/addressApi";
import { useSessionToken } from "@/lib/session";

export type AddressBookLoad = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; book: AddressBook };

// The member's saved addresses, read whenever the screen comes into view (a save on the form shows
// at once on the list). `set` puts in an answer a change already returned, without a second read.
export function useAddressBook() {
  const getToken = useSessionToken();
  const [load, setLoad] = useState<AddressBookLoad>({ state: "loading" });

  const reload = useCallback(async () => {
    const answer = await addressApi.list(await getToken().catch(() => null));
    setLoad((current) => (answer.ok ? { state: "ready", book: answer.data } : current.state === "ready" ? current : { state: "failed", error: answer.error }));
    return answer;
  }, [getToken]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const set = useCallback((book: AddressBook) => setLoad({ state: "ready", book }), []);
  const retry = useCallback(() => {
    setLoad({ state: "loading" });
    reload();
  }, [reload]);
  return { load, reload, retry, set, getToken };
}
