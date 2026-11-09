import { useEffect, useState } from "react";

import { gymApi, type GymTemplates } from "@/lib/gymApi";
import { useSessionToken } from "@/lib/session";

// The branch's Reminder Templates for a screen that writes a message (Send Reminder, the enquiry
// cards' WhatsApp), read once when it opens. Null until they arrive, and for good when the read
// fails (before the migration, offline): the messages then use justFit's default wording and
// there are no added templates.
export function useReminderTemplates() {
  const getToken = useSessionToken();
  const [custom, setCustom] = useState<GymTemplates | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const answer = await gymApi.templates(await getToken().catch(() => null));
      if (live && answer.ok) setCustom(answer.data);
    })();
    return () => {
      live = false;
    };
  }, [getToken]);
  return custom;
}
