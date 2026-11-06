import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { CatalogList } from "@/components/gym/CatalogList";
import { EnquiryList } from "@/components/gym/EnquiryList";
import { GymEmpty } from "@/components/gym/GymStates";
import { MemberList } from "@/components/gym/MemberList";
import type { StaffArea } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { useCan } from "@/store/gymAccess";

type Tab = "member" | "catalog" | "enquiry" | "expense";
// area: the Role & Permission area the tab needs (a Staff login without it doesn't see the tab)
const TABS: { id: Tab; label: string; area?: StaffArea }[] = [
  { id: "member", label: "Member", area: "members" },
  { id: "catalog", label: "Plan / Catalogue", area: "catalog" },
  { id: "enquiry", label: "Enquiry", area: "enquiries" },
  { id: "expense", label: "Expense" },
];
const isTab = (v: unknown): v is Tab => typeof v === "string" && TABS.some((t) => t.id === v);

// Gym admin › Manage (no title, at the user's request): Member, Plan / Catalogue, Enquiry and Expense under one tab. The ☰
// menu opens it on a section (?tab=).
export default function GymManage() {
  const params = useLocalSearchParams<{ tab?: string }>();
  // The tab picked here, remembered against the link it was picked under: a new link from the ☰
  // menu (?tab=) wins over an earlier pick
  const [choice, setChoice] = useState<{ link: string | undefined; tab: Tab } | null>(null);
  const can = useCan();
  const tabs = TABS.filter((t) => !t.area || can(t.area));
  const wanted: Tab = choice && choice.link === params.tab ? choice.tab : isTab(params.tab) ? params.tab : "member";
  // A tab this login can't open falls back to the first it can
  const tab: Tab = tabs.some((t) => t.id === wanted) ? wanted : (tabs[0]?.id ?? "expense");
  const setTab = (next: Tab) => setChoice({ link: params.tab, tab: next });

  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-toptabs">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }} accessibilityRole="tablist">
            {tabs.map((t) => {
              const selected = t.id === tab;
              return (
                <PressableScale key={t.id} onPress={() => { if (!selected) haptic.select(); setTab(t.id); }} className={selected ? "gym-toptab gym-toptab--selected" : "gym-toptab"} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={t.label}>
                  <Text className={selected ? "gym-toptab__label gym-toptab__label--selected" : "gym-toptab__label"}>{t.label}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>
        <View className="flex-1">
          {tab === "member" && <MemberList />}
          {tab === "catalog" && <CatalogList />}
          {tab === "enquiry" && <EnquiryList />}
          {tab === "expense" && (
            <View className="p-4">
              <GymEmpty icon="receipt" title="Expenses are coming soon" text="Rent, salaries and other spending will be kept here." />
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
