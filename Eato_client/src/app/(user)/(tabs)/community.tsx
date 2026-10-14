import { PlaceholderScreen } from "@/components/PlaceholderScreen";

// Feed, groups and messages (built in the Community feature)
export default function Community() {
  return (
    <PlaceholderScreen
      showBack={false}
      title="Community"
      subtitle="Share progress, join groups and message other members."
      icon={{ ios: "person.2", android: "group", web: "group" }}
    />
  );
}
