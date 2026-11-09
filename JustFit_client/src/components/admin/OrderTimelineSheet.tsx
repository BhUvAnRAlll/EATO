import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { STATUS_LABEL, type OrderStatus } from "@/lib/mealRules";
import { kitchenApi, type OrderEvent } from "@/lib/mealsApi";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const EXTRA: Record<string, string> = { kitchen_changed: "Kitchen changed" };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// An order's timeline (Meal Operations phase 3): every step, when, who and why (a rejection's reason,
// a kitchen change, a stock override), oldest first
export function OrderTimelineSheet({ orderId, code, onClose }: { orderId: string; code: string; onClose: () => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [events, setEvents] = useState<OrderEvent[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      const answer = await kitchenApi.events(await getToken(), orderId);
      if (answer.ok) setEvents(answer.data.events);
      else setError(answer.error);
    })();
  }, [getToken, orderId]);
  return (
    <BottomSheet onClose={onClose}>
      {() => (
        <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
          <Text className="type-headline text-forest-ink">{`Order #${code}`}</Text>
          {error ? <FormAlert message={error} /> : null}
          {!events && !error ? <ActivityIndicator color={colors.leaf} /> : null}
          {events?.length === 0 ? <Text className="meta-text">No steps recorded yet.</Text> : null}
          {events?.map((e, i) => (
            <View key={`${e.status}-${i}`} className="flex-row" style={{ gap: 12 }}>
              <View className="order-step__dot order-step__dot--done" />
              <View className="min-w-0 flex-1">
                <Text className="card__title">{STATUS_LABEL[e.status as OrderStatus] ?? EXTRA[e.status] ?? e.status}</Text>
                <Text className="meta-text">{[when(e.at), e.by, e.note].filter(Boolean).join(" · ")}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}
