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
import { haptic } from "@/lib/haptics";

type Tab = "member" | "catalog" | "enquiry" | "expense";
const TABS: { id: Tab; label: string }[] = [
  { id: "member", label: "Member" },
  { id: "catalog", label: "Plan / Catalogue" },
  { id: "enquiry", label: "Enquiry" },
  { id: "expense", label: "Expense" },
];
const isTab = (v: unknown): v is Tab => typeof v === "string" && TABS.some((t) => t.id === v);

// Gym admin › Manage ("Manager"): Member, Plan / Catalogue, Enquiry and Expense under one tab. The ☰
// menu opens it on a section (?tab=).
export default function GymManage() {
  const params = useLocalSearchParams<{ tab?: string }>();
  // The tab picked here, remembered against the link it was picked under: a new link from the ☰
  // menu (?tab=) wins over an earlier pick
  const [choice, setChoice] = useState<{ link: string | undefined; tab: Tab } | null>(null);
  const tab: Tab = choice && choice.link === params.tab ? choice.tab : isTab(params.tab) ? params.tab : "member";
  const setTab = (next: Tab) => setChoice({ link: params.tab, tab: next });

  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <Text className="gym-manage__title" accessibilityRole="header">Manager</Text>
        <View className="gym-toptabs">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }} accessibilityRole="tablist">
            {TABS.map((t) => {
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
          {tab === "enquiry" && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
              <EnquiryList />
            </ScrollView>
          )}
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
