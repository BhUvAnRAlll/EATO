import { Redirect } from "expo-router";

// Adding an enquiry is Manage › Enquiry's + (or Home's + › Add Enquiry); old links land there
export default function GymEnquiry() {
  return <Redirect href="/gym/manage?tab=enquiry" />;
}
