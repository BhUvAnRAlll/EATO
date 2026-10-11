import { Redirect } from "expo-router";

// The app opens on onboarding. Point this at the home tabs once they're built.
export default function Index() {
  return <Redirect href="/onboarding" />;
}
