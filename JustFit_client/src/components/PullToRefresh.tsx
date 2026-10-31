import { useCallback, useRef, useState } from "react";
import { RefreshControl } from "react-native";

import { colors } from "@/theme";

// Pull to refresh for a screen. `reload` is the screen's own loader (the same one its focus
// effect calls, with any freshness window forced off) so a pull reads everything the screen
// shows again. One pull at a time: a second pull while the first is still reading is ignored,
// so the server never gets the same request twice. Errors stay with the loader (it already
// shows them on screen); the spinner just stops.
//
//   const { refreshControl } = usePullToRefresh(load);
//   <ScrollView refreshControl={refreshControl}>
//
// Only the vertical list or scroll view of a screen gets it: horizontal carousels, nested
// lists and inputs never do.
export function usePullToRefresh(reload: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const onRefresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      await reload();
    } catch {
      // the loader reports its own errors
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, [reload]);

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} progressBackgroundColor={colors.surface} />;
  return { refreshing, onRefresh, refreshControl };
}
