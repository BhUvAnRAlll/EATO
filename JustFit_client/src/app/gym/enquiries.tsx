import { useLocalSearchParams } from "expo-router";

import { EnquiryList } from "@/components/gym/EnquiryList";
import { GymSectionScreen } from "@/components/gym/GymSectionScreen";
import { ENQUIRY_VIEWS } from "@/data/gymDashboard";
import type { EnquiryView } from "@/lib/gymApi";

// Gym admin › Enquiries (Home's Enquiry tile on ?view=today, + › Add Enquiry's list, the ☰ menu)
export default function GymEnquiries() {
  const params = useLocalSearchParams<{ view?: string }>();
  const view: EnquiryView = ENQUIRY_VIEWS.some((v) => v.id === params.view) ? (params.view as EnquiryView) : "open";
  return (
    <GymSectionScreen title="Enquiries" area="enquiries">
      <EnquiryList key={view} initialView={view} />
    </GymSectionScreen>
  );
}
