import { Text, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { initialsOf, phoneText, shortDate } from "@/data/gymDashboard";
import { gymApi } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";

// Gym admin › Enquiries: the latest 100 people who asked about joining
export default function GymEnquiries() {
  const { result, retry } = useGymData(gymApi.enquiries);
  return (
    <GymScreen
      title="Enquiries"
      right={
        <PressableScale onPress={() => router.push("/gym/enquiry")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add an enquiry">
          <Text className="gym-link">Add</Text>
        </PressableScale>
      }
    >
      {result.state === "loading" && <GymLoading label="Loading enquiries" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" &&
        (result.data.enquiries.length === 0 ? (
          <GymEmpty icon={{ ios: "questionmark.bubble", android: "contact_support", web: "contact_support" }} title="No enquiries yet" text="When someone asks about joining, add them here so you can follow up." />
        ) : (
          <View style={{ gap: 10 }}>
            {result.data.enquiries.map((e) => (
              <View key={e.id} className="gym-card gym-tx" accessible accessibilityLabel={`${e.name}${e.phone ? `, ${e.phone}` : ""}${e.note ? `, ${e.note}` : ""}, ${shortDate(e.enquiredOn)}`}>
                <View className="gym-avatar">
                  <Text className="gym-avatar__label">{initialsOf(e.name)}</Text>
                </View>
                <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                  <Text className="gym-tx__name" numberOfLines={1}>{e.name}</Text>
                  {e.phone ? <Text className="gym-tx__meta">{phoneText(e.phone)}</Text> : null}
                  {e.note ? <Text className="gym-tx__meta" numberOfLines={2}>{e.note}</Text> : null}
                </View>
                <Text className="gym-tx__date">{shortDate(e.enquiredOn)}</Text>
              </View>
            ))}
          </View>
        ))}
    </GymScreen>
  );
}
