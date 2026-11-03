// Pure helpers behind the app's motion (components/motion, lib/useTween). No React Native
// imports, so they run under `npm test`.

// Ease-out cubic: quick off the start, a long soft landing (numbers, rings and bars settling)
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// Where a tween from `from` to `to` is after `elapsed` of `duration` ms
export function tweenAt(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  return from + (to - from) * easeOut(elapsed / duration);
}

export type RevealWord = { text: string; bold: boolean };

// A coach reply split into words for the word-by-word reveal, keeping its **marked** points
// bold. Each word carries the space that follows it, so the words laid end to end are the reply
// exactly as the chat shows it (markers removed), and revealing more words never reflows a line.
export function revealWords(text: string): RevealWord[] {
  const words: RevealWord[] = [];
  text.split(/\*\*(.+?)\*\*/).forEach((part, i) => {
    const bold = i % 2 === 1;
    for (const piece of part.split(/(?<=\s)/)) if (piece) words.push({ text: piece, bold });
  });
  return words;
}

// Keys that weren't there when a list was first shown: these get an entrance, the rest (what
// the screen opened with) appear in place. `first` is null until the list has been shown once.
export function newKeys(first: ReadonlySet<string> | null, keys: readonly string[]): Set<string> {
  if (!first) return new Set();
  return new Set(keys.filter((key) => !first.has(key)));
}
