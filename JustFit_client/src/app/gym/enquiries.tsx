import { Redirect } from "expo-router";

// Enquiries live in Manage › Enquiry since the follow-up redesign; old links land there
export default function GymEnquiries() {
  return <Redirect href="/gym/manage?tab=enquiry" />;
}
