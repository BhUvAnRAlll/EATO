import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { daysLeftLabel, flagLabel, owner, type MemberPlan, type RenewalFlag } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";

// A member's own package in a gym (the member's side of renewals): plan name, end date and
// days left. Shows nothing until the gym records a package for them.
export function MyGymPlan({ gymId }: { gymId: string }) {
  const getToken = useSessionToken();
  const [plan, setPlan] = useState<{ plan: MemberPlan | null; flag: RenewalFlag } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await owner.myPlan(await getToken(), gymId);
      if (!cancelled && result.ok) setPlan(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [gymId, getToken]);

  if (!plan?.plan) return null;
  const { name, endsOn, daysLeft } = plan.plan;
  const ending = plan.flag === "expired" || plan.flag === "this_week";
  return (
    <View className="owner-plan" accessibilityLabel={`Your membership: ${name}, ${flagLabel[plan.flag]}, ${daysLeftLabel(daysLeft)}`}>
      <Text className="home__eyebrow">Your membership</Text>
      <Text className="friend-row__name">{name}</Text>
      <Text className="friend-row__note">
        {endsOn ? `${plan.flag === "expired" ? "Ended" : "Until"} ${endsOn} · ${daysLeftLabel(daysLeft)}` : "No end date"}
      </Text>
      {ending && <Text className="friend-row__note">Ask the front desk to renew it.</Text>}
    </View>
  );
}
