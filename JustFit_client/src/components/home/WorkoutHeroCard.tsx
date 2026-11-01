import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";

import { SymbolView } from "@/components/SymbolView";
import type { HomeWorkout } from "@/store/home";
import { useThemeColors } from "@/theme";

type WorkoutHeroCardProps = {
  workout: HomeWorkout;
  // Opens today's session (or the Workout hub when there's nothing to start)
  onOpen: () => void;
};

const LEVEL: Record<string, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

// Today's workout as a dark hero card: the session's title and length, its level and exercise
// count as glass chips, and a round red play button. A rest day or a finished session says so
// instead of inviting a start. (No photo: the plan has none of its own, and a stock one would
// not be the member's workout.)
export function WorkoutHeroCard({ workout, onOpen }: WorkoutHeroCardProps) {
  const colors = useThemeColors();
  const { status, day } = workout;
  const done = status === "completed";
  const resting = status === "rest" || !day;
  const title = resting ? "Rest day" : day.title;
  const meta = resting
    ? "Recover today. Your next session is on your plan."
    : done
      ? `Done · ${day.minutes} min`
      : status === "in_progress"
        ? `In progress · ${day.minutes} min`
        : `${day.minutes} min · ${day.exerciseCount} exercises`;
  const label = resting ? "Rest day. Open your workout plan" : done ? `${title} done. Open today's workout` : `Start ${title}, ${day.minutes} minutes`;

  return (
    <PressableScale scaleTo={0.98} onPress={onOpen} className="home__hero" accessibilityRole="button" accessibilityLabel={label}>
      <View className="flex-row" style={{ gap: 8 }}>
        <View className="workout__chip">
          <SymbolView name={{ ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" }} size={13} tintColor={colors.white} />
          <Text className="workout__chip-label">{"Today's workout"}</Text>
        </View>
        {!resting && (
          <View className="workout__chip">
            <Text className="workout__chip-label">{LEVEL[workout.level] ?? workout.level}</Text>
          </View>
        )}
      </View>

      <View className="mt-6 flex-row items-end justify-between" style={{ gap: 12 }}>
        <View className="min-w-0 flex-1">
          <Text className="home__hero-title" numberOfLines={2}>{title}</Text>
          <Text className="home__hero-meta" numberOfLines={2}>{meta}</Text>
        </View>
        <View className={done ? "home__play home__play--done" : "home__play"}>
          <SymbolView
            name={done ? { ios: "checkmark", android: "check", web: "check" } : resting ? { ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" } : { ios: "play.fill", android: "play_arrow", web: "play_arrow" }}
            size={22}
            tintColor={colors.white}
          />
        </View>
      </View>
    </PressableScale>
  );
}
