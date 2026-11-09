// The iPhone action sheet's buttons, kept free of React Native so they can be unit-tested
// (lib/nativeSheets.ts shows them): the actions in order, then Cancel last, with the indexes of
// the red (destructive) ones.

type Button = { label: string; destructive?: boolean };

export function iosButtons(actions: readonly Button[], cancelLabel = "Cancel") {
  const destructive = actions.flatMap((a, i) => (a.destructive ? [i] : []));
  return {
    options: [...actions.map((a) => a.label), cancelLabel],
    cancelButtonIndex: actions.length,
    destructiveButtonIndex: destructive.length > 0 ? destructive : undefined,
  };
}
