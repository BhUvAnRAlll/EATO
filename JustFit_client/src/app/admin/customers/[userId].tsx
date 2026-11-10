import { useCallback } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { ISSUE_CATEGORY_LABEL, ISSUE_STATUS_LABEL } from "@/data/issues";
import { hud } from "@/lib/hud";
import { issuesApi } from "@/lib/issuesApi";
import { SLOT_LABEL, STATUS_LABEL, rupees, type OrderStatus } from "@/lib/mealRules";
import { useGymData } from "@/lib/useGymData";

const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const DIET: Record<string, string> = { vegetarian: "Vegetarian", "non-vegetarian": "Non-vegetarian", eggetarian: "Eggetarian", vegan: "Vegan" };

// Super Admin › a user › Meal orders and plans (Meal Operations phase 6): the member's food
// preferences (diet, cuisines, dislikes, allergies), delivery addresses, recent orders, meal plans
// and reports; an issue opens to work it. Admin only (the server checks the role).
export default function AdminCustomer() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const load = useCallback((t: string | null) => issuesApi.customer(t, String(userId)), [userId]);
  const { result, retry, refresh } = useGymData(load);
  const c = result.state === "ready" ? result.data.customer : null;
  return (
    <AdminScreen title={c?.name ?? "Customer"} subtitle="Meal orders and plans" onRefresh={refresh}>
      {result.state === "loading" && <ScreenSkeleton label="Loading" />}
      {result.state === "failed" && (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      )}
      {c && (
        <View style={{ gap: 14 }}>
          <View className="card" style={{ gap: 6 }}>
            {c.phone ? (
              <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`).catch(() => hud.error("Couldn't open the phone app"))} accessibilityRole="button">
                <Text className="meal-link">{`Call +91 ${c.phone}`}</Text>
              </Pressable>
            ) : null}
            <Text className="card__title">Food preferences</Text>
            {c.preferences ? (
              <>
                <Text className="meta-text">{[c.preferences.diet ? DIET[c.preferences.diet] ?? c.preferences.diet : null, c.preferences.cuisines.length ? c.preferences.cuisines.join(", ") : null].filter(Boolean).join(" · ") || "No diet set"}</Text>
                {c.preferences.allergies ? <Text className="type-body text-forest-ink">{`Allergies: ${c.preferences.allergies}`}</Text> : null}
                {c.preferences.dislikes ? <Text className="meta-text">{`Doesn't eat: ${c.preferences.dislikes}`}</Text> : null}
              </>
            ) : (
              <Text className="meta-text">Not set up yet.</Text>
            )}
          </View>
          <Text className="admin-section__title">{`Addresses (${c.addresses.length})`}</Text>
          {c.addresses.map((a) => <Text key={a.id} className="meta-text">{`${a.selected ? "● " : ""}${a.kind} · ${a.line}`}</Text>)}
          <Text className="admin-section__title">{`Recent orders (${c.orders.length})`}</Text>
          {c.orders.length === 0 ? <Text className="meta-text">No orders yet.</Text> : null}
          {c.orders.map((o) => <Text key={o.id} className="meta-text">{`#${o.code} · ${date(o.date)} ${SLOT_LABEL[o.slot] ?? o.slot} · ${STATUS_LABEL[o.status as OrderStatus] ?? o.status} · ${rupees(o.total)}`}</Text>)}
          <Text className="admin-section__title">{`Meal plans (${c.subscriptions.length})`}</Text>
          {c.subscriptions.length === 0 ? <Text className="meta-text">No meal plans.</Text> : null}
          {c.subscriptions.map((s) => (
            <Pressable key={s.id} onPress={() => router.push({ pathname: "/admin/subscriptions/[id]", params: { id: s.id } })} accessibilityRole="button">
              <Text className="meta-text">{`${s.planName} · ${s.days} days · ${date(s.startsOn)} – ${date(s.endsOn)} · ${s.status}`}</Text>
            </Pressable>
          ))}
          <Text className="admin-section__title">{`Reports (${c.issues.length})`}</Text>
          {c.issues.length === 0 ? <Text className="meta-text">No reports.</Text> : null}
          {c.issues.map((i) => (
            <Pressable key={i.id} onPress={() => router.push({ pathname: "/admin/issues/[id]", params: { id: String(i.id) } })} accessibilityRole="button">
              <Text className="meta-text">{`${i.code} · ${ISSUE_CATEGORY_LABEL[i.category]} · ${ISSUE_STATUS_LABEL[i.status]}`}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </AdminScreen>
  );
}
