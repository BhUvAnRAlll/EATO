// Everything the app keeps in memory about the signed-in account (the feed, the owner portal's
// gym, the coach intake, the cart...) belongs to one "account generation". Signing out, or in
// as someone else, starts a new generation: every store that registered a clear function is
// emptied, and the answer to a request started in an earlier generation is thrown away instead
// of being written into the next account's screens.
// Pure: no React Native imports, so it is unit-tested on its own.

type Clear = () => void;

const clears = new Set<Clear>();
let generation = 0;

// A store registers how to empty itself (once, when its module loads)
export function onAccountCleared(clear: Clear): void {
  clears.add(clear);
}

// Starts a new generation and empties every registered store
export function clearAccountData(): void {
  generation += 1;
  for (const clear of clears) clear();
}

// A store registers how to empty itself (once, when its module loads); lib/analytics.ts registers
// its queue the same way from its own module

// Call before a request; the returned check says whether its answer still belongs to the
// account on screen:
//   const stillCurrent = sameAccount();
//   const result = await fetchSomething(token);
//   if (!stillCurrent()) return;
export function sameAccount(): () => boolean {
  const started = generation;
  return () => generation === started;
}
