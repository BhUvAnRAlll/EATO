import { Text } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { EnquiryList } from "@/components/gym/EnquiryList";
import { GymScreen } from "@/components/gym/GymScreen";

// Gym admin › Enquiries (Home's Enquiry tile): the enquiry list in its own screen, with Add
export default function GymEnquiries() {
  return (
    <GymScreen
      title="Enquiries"
      right={
        <PressableScale onPress={() => router.push("/gym/enquiry")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add an enquiry">
          <Text className="gym-link">Add</Text>
        </PressableScale>
      }
    >
      <EnquiryList />
    </GymScreen>
  );
}
