import { PlaceholderScreen } from "@/components/PlaceholderScreen";

// Workout plans, active workouts and activity tracking (built in the Training feature)
export default function Fitness() {
  return (
    <PlaceholderScreen
      showBack={false}
      title="Fitness"
      subtitle="Workout plans, your active workout, the exercise library and progress charts."
      icon={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }}
    />
  );
}
