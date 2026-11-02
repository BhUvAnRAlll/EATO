import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { adminPrograms, type AdminSection } from "@/lib/adminPrograms";
import { useSessionToken } from "@/lib/session";

// The Fitness tab's categories for an admin screen, read again each time the screen is shown (so
// one just made in Categories › New is there on coming back). Undefined until they load or when
// they can't; screens then fall back to the six built-in ones.
export function useAdminSections(): AdminSection[] | undefined {
  const getToken = useSessionToken();
  const [sections, setSections] = useState<AdminSection[] | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const result = await adminPrograms.sections(await getToken().catch(() => null));
        if (live && result.ok) setSections(result.data.sections);
      })();
      return () => {
        live = false;
      };
    }, [getToken]),
  );
  return sections;
}
