import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";

import { CatalogList } from "@/components/gym/CatalogList";
import { EnquiryList } from "@/components/gym/EnquiryList";
import { ExpenseList } from "@/components/gym/ExpenseList";
import { GymEmpty } from "@/components/gym/GymStates";
import { MemberList } from "@/components/gym/MemberList";
import { ENQUIRY_VIEWS } from "@/data/gymDashboard";
import type { EnquiryView, StaffArea } from "@/lib/gymApi";
import { useCan } from "@/store/gymAccess";

type Section = "member" | "catalog" | "enquiry" | "expense";
// area: the Role & Permission area the section needs (a Staff login without it is sent to the first it has)
const SECTIONS: { id: Section; label: string; area?: StaffArea }[] = [
  { id: "member", label: "Members", area: "members" },
  { id: "catalog", label: "Plans / Catalogue", area: "catalog" },
  { id: "enquiry", label: "Enquiries", area: "enquiries" },
  { id: "expense", label: "Expenses", area: "expenses" },
];
const isSection = (v: unknown): v is Section => typeof v === "string" && SECTIONS.some((s) => s.id === v);

// Gym admin › Manage: one section at a time, with no top tabs (removed 2026-11-08 at the user's
// request). The Manage tab opens Members, with its search bar at the top; Plans / Catalogue,
// Enquiries and Expenses open from their links (?tab=: the ☰ menu, Home's tiles, + › Add Plan)
// under a small title. Home's Enquiry tile adds the list to open (?view=today), and Home's + ›
// Add Expense opens Expenses with its sheet up (?add=1).
export default function GymManage() {
  const params = useLocalSearchParams<{ tab?: string; view?: string; add?: string }>();
  const can = useCan();
  const sections = SECTIONS.filter((s) => !s.area || can(s.area));
  const wanted: Section = isSection(params.tab) ? params.tab : "member";
  // A section this login can't open falls back to the first it can
  const section = sections.find((s) => s.id === wanted) ?? sections[0] ?? null;
  // The Enquiry list opens on the linked view; a new link re-keys it so the chip follows
  const enquiryView: EnquiryView = ENQUIRY_VIEWS.some((v) => v.id === params.view) ? (params.view as EnquiryView) : "open";

  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        {section && section.id !== "member" && (
          <Text className="gym-manage__title" accessibilityRole="header">{section.label}</Text>
        )}
        <View className="flex-1">
          {section?.id === "member" && <MemberList />}
          {section?.id === "catalog" && <CatalogList />}
          {section?.id === "enquiry" && <EnquiryList key={enquiryView} initialView={enquiryView} />}
          {/* A new + › Add Expense link re-keys the list so its sheet opens again */}
          {section?.id === "expense" && <ExpenseList key={params.add ?? "list"} addOnOpen={params.add === "1"} />}
          {/* A Staff login given none of these areas */}
          {section === null && (
            <View className="p-4">
              <GymEmpty icon="layout-grid" title="Nothing to manage here" text="Your login doesn't include Members, Plans, Enquiries or Expenses. Ask your gym admin." />
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
