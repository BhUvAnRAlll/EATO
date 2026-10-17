import { Redirect, useLocalSearchParams } from "expo-router";

// An invite link (eato://community/gyms/invite/CODE) opens the join screen with the code filled in
export default function InviteLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: "/community/gyms/join", params: { code } }} />;
}
