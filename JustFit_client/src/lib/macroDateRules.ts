// The Macro diary's day rules with no React Native in them, so they are unit-tested on Node
// (lib/macro.ts imports the API client and can't be).

// The day a meal or water entry is logged to. The selected day is kept across screens, so an app
// left open past midnight still "selects" yesterday: when the selection was today at the time it
// was made (`selectedWhenToday`), it follows the clock to the new today. A past day picked on
// purpose stays as it is (and logging to it is refused by the screen).
export const logDateFor = (selectedDate: string, selectedWhenToday: string, today: string) =>
  selectedDate === selectedWhenToday ? today : selectedDate;
