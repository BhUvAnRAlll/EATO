import { Platform } from "react-native";

// Virtualisation settings for the app's long vertical lists (feeds, comments, members).
// Spread into a FlatList: <FlatList {...listPerf} ... />
// - the first screenful renders at once, then small batches, so the first frame is quick
// - about four screens above and below stay mounted (windowSize 9), enough for a fast flick
//   without blank rows, few enough to keep memory low on entry-level Android phones
// - Android also detaches rows that are off screen (on iOS it can blank rows, so it's off)
export const listPerf = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 6,
  updateCellsBatchingPeriod: 50,
  windowSize: 9,
  removeClippedSubviews: Platform.OS === "android",
} as const;

// The same for an inverted chat, without detaching rows (it can blank inverted lists)
export const chatListPerf = { ...listPerf, removeClippedSubviews: false } as const;
