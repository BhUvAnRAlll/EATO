import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { timeAgo } from "@/lib/community";
import { owner, type MyTeamQuestion } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";

// On the gym's Ask screen: the member's earlier questions the assistant passed to the gym's team,
// with the team's reply under each (or "waiting for the team"). Shows nothing until there's one.
export function MyTeamReplies({ gymId, gymName }: { gymId: string; gymName: string }) {
  const getToken = useSessionToken();
  const [questions, setQuestions] = useState<MyTeamQuestion[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await owner.myQuestions(await getToken(), gymId);
      if (!cancelled && result.ok) setQuestions(result.data.questions.filter((q) => q.status !== "dismissed"));
    })();
    return () => {
      cancelled = true;
    };
  }, [gymId, getToken]);

  if (questions.length === 0) return null;
  return (
    <View className="gap-3" accessibilityLabel="Your questions to the team">
      <Text className="home__eyebrow">Your questions to the team</Text>
      {[...questions].reverse().map((q) => (
        <View key={q.id} className="gap-2">
          <View className="ask__bubble ask__bubble--you" style={{ alignSelf: "flex-end" }}>
            <Text className="ask__text ask__text--you">{q.question}</Text>
          </View>
          {q.answer ? (
            <View className="owner-team-reply" accessibilityLabel={`${gymName} team replied: ${q.answer}`}>
              <Text className="owner-stat__label">{gymName} team · {q.answeredAt ? timeAgo(q.answeredAt) : ""}</Text>
              <Text className="friend-row__note" style={{ fontSize: 15, lineHeight: 21 }}>{q.answer}</Text>
            </View>
          ) : (
            <Text className="owner-stat__label" style={{ alignSelf: "flex-end" }}>Waiting for the team · asked {timeAgo(q.askedAt)}</Text>
          )}
        </View>
      ))}
    </View>
  );
}
