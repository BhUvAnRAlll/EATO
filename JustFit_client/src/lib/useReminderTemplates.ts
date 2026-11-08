import { useEffect, useState } from "react";

import { gymApi } from "@/lib/gymApi";
import type { CustomTemplates } from "@/lib/reminderTemplates";
import { useSessionToken } from "@/lib/session";

// The branch's Reminder Templates for a screen that writes a message (Send Reminder, the enquiry
// cards' WhatsApp), read once when it opens. Null until they arrive, and for good when the read
// fails (before the migration, offline): the messages then use justFit's default wording.
export function useReminderTemplates() {
  const getToken = useSessionToken();
  const [custom, setCustom] = useState<CustomTemplates | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const answer = await gymApi.templates(await getToken().catch(() => null));
      if (live && answer.ok) setCustom(answer.data.templates);
    })();
    return () => {
      live = false;
    };
  }, [getToken]);
  return custom;
}
