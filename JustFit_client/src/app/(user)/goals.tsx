import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function Goals() {
  return (
    <PlaceholderScreen
      title="Nutrition goal"
      subtitle="Adjust your calorie and macro targets. Your current targets come from profile setup."
      icon={{ ios: "target", android: "track_changes", web: "track_changes" }}
    />
  );
}
