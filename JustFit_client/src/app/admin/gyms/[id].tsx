import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { AdminField } from "@/components/admin/AdminField";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { KIND_LABEL, METHOD_LABEL, phoneText, rupees, shortDate } from "@/data/gymDashboard";
import { adminGyms, type AdminGymDetail } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/gyms"));

// Super Admin › a gym: today's takings, this month, members, dues, attendance and enquiries; its
// gym admins (link one by their sign-in number, or remove them); its latest payments; and editing
// its name and place. The numbers are the same ones the gym's own portal shows.
export default function AdminGymDetailScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const gymId = Number(id);
  const load = useCallback((token: string | null) => adminGyms.detail(token, gymId), [gymId]);
  const { result, retry, set } = useGymData(load);
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({ name: "", area: "", city: "" });
  const [removing, setRemoving] = useState<string | null>(null);
  const link = useGymSave((data: AdminGymDetail) => { set(data); setPhone(""); });
  const unlink = useGymSave((data: AdminGymDetail) => { set(data); setRemoving(null); });
  const edit = useGymSave((data: AdminGymDetail) => { set(data); setEditing(false); });

  const data = result.state === "ready" ? result.data : null;
  const s = data?.stats;
  const tiles = s
    ? [
        { label: "Today", value: rupees(s.todayOnline + s.todayCash), note: `${rupees(s.todayOnline)} online · ${rupees(s.todayCash)} cash` },
        { label: "This month", value: rupees(s.monthRevenue), note: `${s.monthAdmissions} admissions · ${s.monthRenewals} renewals` },
        { label: "Members", value: String(s.members), note: `${s.active} active` },
        { label: "Owed", value: rupees(s.dueTotal), note: `${s.dueMembers} ${s.dueMembers === 1 ? "member" : "members"}` },
        { label: "In today", value: String(s.attendanceToday), note: "check-ins" },
        { label: "Enquiries", value: String(s.enquiriesMonth), note: "this month" },
      ]
    : [];

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="min-w-0 flex-1 items-center">
            <Text className="screen-bar__title" numberOfLines={1} accessibilityRole="header">{data?.gym.name ?? "Gym"}</Text>
            {data && <Text className="screen-bar__subtitle" numberOfLines={1}>{`${data.gym.area}, ${data.gym.city}`}</Text>}
          </View>
          <View className="screen-bar__spacer" />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} showsVerticalScrollIndicator={false}>
          {result.state === "loading" && <ScreenSkeleton label="Loading the gym" />}
          {result.state === "failed" && (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the gym" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
          )}
          {data && (
            <>
              <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                {tiles.map((t) => (
                  <View key={t.label} className="admin-stat" accessible accessibilityLabel={`${t.label}: ${t.value}, ${t.note}`}>
                    <Text className="admin-stat__label">{t.label}</Text>
                    <Text className="admin-stat__value" numberOfLines={1} adjustsFontSizeToFit>{t.value}</Text>
                    <Text className="meta-text" numberOfLines={2}>{t.note}</Text>
                  </View>
                ))}
              </View>

              <Text className="setup__section">Gym admins</Text>
              <View className="admin-list">
                {data.staff.length === 0 ? (
                  <View className="admin-row"><Text className="meta-text flex-1">{"No gym admin yet. Link one below so they can use the gym portal."}</Text></View>
                ) : (
                  data.staff.map((m, i) => (
                    <View key={m.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}>
                      <View className="admin-initials"><Text className="admin-initials__label">{m.name.charAt(0).toUpperCase()}</Text></View>
                      <View className="min-w-0 flex-1">
                        <Text className="card__title" numberOfLines={1}>{m.name}</Text>
                        <Text className="meta-text">{phoneText(m.phone)}</Text>
                      </View>
                      {removing === m.id ? (
                        <View className="flex-row" style={{ gap: 12 }}>
                          <Pressable onPress={() => unlink.save((token) => adminGyms.unlinkStaff(token, gymId, m.id))} disabled={unlink.busy} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Yes, remove ${m.name}`}>
                            <Text className="meta-text" style={{ color: colors.danger }}>Remove</Text>
                          </Pressable>
                          <Pressable onPress={() => setRemoving(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Keep">
                            <Text className="meta-text">Keep</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable onPress={() => setRemoving(m.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${m.name} from this gym`}>
                          <Text className="meta-text" style={{ color: colors.danger }}>Remove</Text>
                        </Pressable>
                      )}
                    </View>
                  ))
                )}
              </View>
              {unlink.error ? <FormAlert message={unlink.error} /> : null}
              <AdminField
                label="Link a gym admin"
                hint="Their sign-in mobile number. The account needs the gym_admin role first (npm run set-role)."
                value={phone}
                onChangeText={(t) => setPhone(t.replace(/[^0-9+ ]/g, "").slice(0, 15))}
                keyboardType="phone-pad"
                placeholder="96065 77501"
              />
              {link.error ? <FormAlert message={link.error} /> : null}
              <Pressable onPress={() => link.save((token) => adminGyms.linkStaff(token, gymId, phone.trim()))} disabled={phone.replace(/\D/g, "").length < 10 || link.busy} className="btn-outline" style={{ opacity: phone.replace(/\D/g, "").length < 10 || link.busy ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="Link gym admin">
                {link.busy && <ActivityIndicator size="small" color={colors.leaf} />}
                <Text className="btn-outline__label">Link gym admin</Text>
              </Pressable>

              <Text className="setup__section">Latest payments</Text>
              {data.recent.length === 0 ? (
                <Text className="meta-text">No payments recorded yet.</Text>
              ) : (
                <View className="admin-list">
                  {data.recent.map((p, i) => (
                    <View key={p.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessible accessibilityLabel={`${p.title}, ${KIND_LABEL[p.kind]}, ${METHOD_LABEL[p.method]}, ${rupees(p.amount)}, ${shortDate(p.paidOn)}`}>
                      <View className="min-w-0 flex-1">
                        <Text className="card__title" numberOfLines={1}>{p.title}</Text>
                        <Text className="meta-text" numberOfLines={1}>{`${KIND_LABEL[p.kind]} · ${p.detail} · ${METHOD_LABEL[p.method]}`}</Text>
                      </View>
                      <View className="items-end">
                        <Text className="card__title" style={{ color: colors.success }}>{`+${rupees(p.amount)}`}</Text>
                        <Text className="meta-text">{shortDate(p.paidOn)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <Text className="setup__section">Details</Text>
              {editing ? (
                <View style={{ gap: 12 }}>
                  <AdminField label="Gym name" value={fields.name} onChangeText={(name) => setFields((f) => ({ ...f, name }))} maxLength={80} />
                  <AdminField label="Area" value={fields.area} onChangeText={(area) => setFields((f) => ({ ...f, area }))} maxLength={80} />
                  <AdminField label="City" value={fields.city} onChangeText={(city) => setFields((f) => ({ ...f, city }))} maxLength={60} />
                  {edit.error ? <FormAlert message={edit.error} /> : null}
                  <View className="flex-row" style={{ gap: 10 }}>
                    <Pressable onPress={() => edit.save((token) => adminGyms.update(token, gymId, { name: fields.name.trim(), area: fields.area.trim(), city: fields.city.trim() }))} disabled={edit.busy} className="btn-forest flex-1" accessibilityRole="button" accessibilityLabel="Save gym details">
                      <Text className="btn-forest__label">Save</Text>
                    </Pressable>
                    <Pressable onPress={() => setEditing(false)} className="btn-outline" style={{ paddingHorizontal: 18 }} accessibilityRole="button" accessibilityLabel="Cancel">
                      <Text className="btn-outline__label">Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable onPress={() => { setFields({ name: data.gym.name, area: data.gym.area, city: data.gym.city }); setEditing(true); }} className="btn-outline" accessibilityRole="button" accessibilityLabel="Edit gym details">
                  <Text className="btn-outline__label">Edit name and place</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
