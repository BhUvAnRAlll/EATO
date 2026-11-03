import { useEffect, useMemo, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { fonts } from "@/constants/fonts";
import { revealWords } from "@/lib/motionRules";

// About 25 words a second: fast enough to feel like the coach writing, slow enough to read along
const WORD_MS = 40;

type RevealTextProps = {
  // The reply, with its main points marked **like this** (shown semibold)
  text: string;
  // Reveal word by word (a reply that just arrived) or show it whole (one read from history)
  animate: boolean;
  className?: string;
  style?: StyleProp<TextStyle>;
  // Called once the whole reply is showing
  onDone?: () => void;
};

// A coach reply written in word by word. Every word is laid out from the start and the unrevealed
// ones are clear, so lines never reflow and the bubble keeps its size while the words arrive.
// Screen readers get the whole reply at once; Reduce Motion shows it whole.
export function RevealText({ text, animate, className, style, onDone }: RevealTextProps) {
  const reduceMotion = useReducedMotion();
  const words = useMemo(() => revealWords(text), [text]);
  const whole = !animate || reduceMotion;
  const [count, setCount] = useState(0);
  const shownCount = whole ? words.length : count;

  useEffect(() => {
    if (whole) {
      onDone?.();
      return;
    }
    let shown = 0;
    const id = setInterval(() => {
      shown += 1;
      setCount(shown);
      if (shown >= words.length) {
        clearInterval(id);
        onDone?.();
      }
    }, WORD_MS);
    return () => clearInterval(id);
    // onDone is a notification only; restarting the reveal for a new callback would replay it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whole, words]);

  return (
    <Text className={className} style={style} accessibilityLabel={words.map((w) => w.text).join("")}>
      {words.map((word, i) => (
        <Text key={i} style={[word.bold && { fontFamily: fonts.semibold }, i >= shownCount && { color: "transparent" }]}>
          {word.text}
        </Text>
      ))}
    </Text>
  );
}
