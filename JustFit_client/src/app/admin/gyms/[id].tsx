import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { AdminField } from "@/components/admin/AdminField";
import { GymReviewCard } from "@/components/admin/GymReviewCard";
import { TransferOwnerCard } from "@/components/admin/TransferOwnerCard";
import { FeatureGymCard } from "@/components/admin/FeatureGymCard";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { KIND_LABEL, METHOD_LABEL, phoneInput, phoneText, rupees, shortDate } from "@/data/gymDashboard";
import type { ApiResult } from "@/lib/api";
import { adminGyms, type AdminGymDetail } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useResponsive } from "@/lib/responsive";
import { useThemeColors } from "@/theme";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/gyms"));

// Super Admin › a gym branch: today's takings, this month, members, dues, attendance and enquiries; its
// gym admins (link one by their sign-in number, or remove them); its latest payments; and editing
// its name and place; its SMS credits (added by hand: justFit takes no payments). The numbers are the same ones the gym's own portal shows.
export default function AdminGymDetailScreen() {
  const colors = useThemeColors();
  const { compact } = useResponsive();
  const { id } = useLocalSearchParams<{ id: string }>();
  // The id from the address, which may be anything (letters, a list): only a whole number is asked for
  const gymId = Number(id);
  const invalidId = !Number.isInteger(gymId) || gymId < 1;
  const load = useCallback(
    (token: string | null): Promise<ApiResult<AdminGymDetail>> => (invalidId ? Promise.resolve({ ok: false, error: "That gym id isn't valid." }) : adminGyms.detail(token, gymId)),
    [gymId, invalidId],
  );
  const { result, retry, set, refreshing, refresh } = useGymData(load);
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({ name: "", branch: "", area: "", city: "" });
  const [newBranch, setNewBranch] = useState<{ branch: string; area: string; city: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [credits, setCredits] = useState("");
  const link = useGymSave((data: AdminGymDetail) => { set(data); setPhone(""); });
  const topUp = useGymSave((data: AdminGymDetail) => { set(data); setCredits(""); });
  const unlink = useGymSave((data: AdminGymDetail) => { set(data); setRemoving(null); });
  const edit = useGymSave((data: AdminGymDetail) => { set(data); setEditing(false); });
  const addBranch = useGymSave((data: AdminGymDetail) => { setNewBranch(null); router.replace({ pathname: "/admin/gyms/[id]", params: { id: String(data.gym.id) } }); });

  const data = result.state === "ready" ? result.data : null;
  const branchReady = !!newBranch && [newBranch.branch, newBranch.area, newBranch.city].every((v) => v.trim().length >= 2);
  const phoneReady = phone.length >= 10;
  const creditsReady = Number(credits) >= 1;
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
            {data && <Text className="screen-bar__subtitle" numberOfLines={1}>{`${data.gym.branch} branch · ${data.gym.area}, ${data.gym.city}`}</Text>}
          </View>
          <View className="screen-bar__spacer" />
        </View>
        {/* Keeps the lower fields and Save above the keyboard on Android too */}
        <KeyboardAvoider>
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} progressBackgroundColor={colors.surface} />}
          >
            {result.state === "loading" && <ScreenSkeleton label="Loading the gym" />}
            {result.state === "failed" && (
              <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the gym" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
            )}
            {data && (
              <>
                <GymReviewCard gymId={gymId} onChanged={refresh} />
                <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                  {tiles.map((t) => (
                    <View key={t.label} className={compact ? "admin-stat admin-stat--half" : "admin-stat"} accessible accessibilityLabel={`${t.label}: ${t.value}, ${t.note}`}>
                      <Text className="admin-stat__label" numberOfLines={1}>{t.label}</Text>
                      <Text className="admin-stat__value" numberOfLines={1} adjustsFontSizeToFit>{t.value}</Text>
                      <Text className="meta-text" numberOfLines={2}>{t.note}</Text>
                    </View>
                  ))}
                </View>

                <Text className="setup__section">{`${data.gym.name}'s branches`}</Text>
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {data.branches.map((b) => {
                    const current = b.id === data.gym.id;
                    return (
                      <Pressable
                        key={b.id}
                        onPress={current ? undefined : () => router.replace({ pathname: "/admin/gyms/[id]", params: { id: String(b.id) } })}
                        className={current ? "filter-chip filter-chip--selected" : "filter-chip"}
                        accessibilityRole="button"
                        accessibilityState={{ selected: current }}
                        accessibilityLabel={`${b.branch} branch${current ? ", open" : ""}`}
                      >
                        <Text className={current ? "filter-chip__label filter-chip__label--selected" : "filter-chip__label"}>{b.branch}</Text>
                      </Pressable>
                    );
                  })}
                  {!newBranch && (
                    <Pressable onPress={() => setNewBranch({ branch: "", area: "", city: data.gym.city })} className="filter-chip" accessibilityRole="button" accessibilityLabel="Add a branch">
                      <Text className="filter-chip__label">+ Add branch</Text>
                    </Pressable>
                  )}
                </View>
                {newBranch && (
                  <View style={{ gap: 12 }}>
                    <AdminField label="Branch name" value={newBranch.branch} onChangeText={(branch) => setNewBranch((b) => b && { ...b, branch })} maxLength={80} placeholder="For example: Kunigal" />
                    <AdminField label="Area" value={newBranch.area} onChangeText={(area) => setNewBranch((b) => b && { ...b, area })} maxLength={80} />
                    <AdminField label="City" value={newBranch.city} onChangeText={(city) => setNewBranch((b) => b && { ...b, city })} maxLength={60} />
                    {addBranch.error ? <FormAlert message={addBranch.error} /> : null}
                    <View className="flex-row" style={{ gap: 10 }}>
                      <Pressable
                        onPress={() => addBranch.save((token) => adminGyms.addBranch(token, gymId, { branch: newBranch.branch.trim(), area: newBranch.area.trim(), city: newBranch.city.trim() }))}
                        disabled={addBranch.busy || !branchReady}
                        className={branchReady ? "btn-forest flex-1" : "btn-forest btn--disabled flex-1"}
                        accessibilityRole="button"
                        accessibilityLabel="Save branch"
                        accessibilityState={{ busy: addBranch.busy }}
                      >
                        {addBranch.busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text className={branchReady ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>Add branch</Text>}
                      </Pressable>
                      <Pressable onPress={() => setNewBranch(null)} disabled={addBranch.busy} className="btn-outline" style={{ paddingHorizontal: 18 }} accessibilityRole="button" accessibilityLabel="Cancel">
                        <Text className="btn-outline__label">Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                <Text className="setup__section">{`Gym admins at ${data.gym.branch}`}</Text>
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
                          <View className="flex-row items-center" style={{ gap: 12 }}>
                            <Pressable onPress={() => unlink.save((token) => adminGyms.unlinkStaff(token, gymId, m.id))} disabled={unlink.busy} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Yes, remove ${m.name}`} accessibilityState={{ busy: unlink.busy }}>
                              {unlink.busy ? <ActivityIndicator size="small" color={colors.danger} /> : <Text className="meta-text" style={{ color: colors.danger }}>Remove</Text>}
                            </Pressable>
                            <Pressable onPress={() => setRemoving(null)} disabled={unlink.busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Keep" style={{ opacity: unlink.busy ? 0.5 : 1 }}>
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
                  onChangeText={(t) => setPhone(phoneInput(t))}
                  keyboardType="phone-pad"
                 
                  placeholder="9606577501"
                />
                {link.error ? <FormAlert message={link.error} /> : null}
                <Pressable onPress={() => link.save((token) => adminGyms.linkStaff(token, gymId, phone))} disabled={!phoneReady || link.busy} className={phoneReady ? "btn-outline" : "btn-outline btn--disabled border-cream-tab"} accessibilityRole="button" accessibilityLabel="Link gym admin">
                  {link.busy && <ActivityIndicator size="small" color={colors.leaf} />}
                  <Text className={phoneReady ? "btn-outline__label" : "btn-outline__label btn--disabled-label"}>Link gym admin</Text>
                </Pressable>

                <FeatureGymCard gymId={gymId} />
                <TransferOwnerCard gymId={gymId} onDone={set} />

                <Text className="setup__section">SMS credits</Text>
                {data.smsCredits === null ? (
                  <Text className="meta-text">SMS needs the 2026-11-25-gym-sms migration on this server.</Text>
                ) : (
                  <>
                    <View className="admin-card" accessible accessibilityLabel={`${data.smsCredits} SMS credits left`}>
                      <Text className="admin-stat__label">Credits left</Text>
                      <Text className="admin-stat__value">{data.smsCredits.toLocaleString("en-IN")}</Text>
                      <Text className="meta-text">1 credit = 1 SMS to a member (reminders, wishes)</Text>
                    </View>
                    <AdminField
                      label="Add credits"
                      hint="Between 1 and 100,000, added to this branch only."
                      value={credits}
                      onChangeText={(t) => setCredits(t.replace(/\D/g, "").slice(0, 6))}
                      keyboardType="number-pad"
                      placeholder="500"
                    />
                    {topUp.error ? <FormAlert message={topUp.error} /> : null}
                    <Pressable onPress={() => topUp.save((token) => adminGyms.addSmsCredits(token, gymId, Number(credits)))} disabled={!creditsReady || topUp.busy} className={creditsReady ? "btn-outline" : "btn-outline btn--disabled border-cream-tab"} accessibilityRole="button" accessibilityLabel="Add SMS credits">
                      {topUp.busy && <ActivityIndicator size="small" color={colors.leaf} />}
                      <Text className={creditsReady ? "btn-outline__label" : "btn-outline__label btn--disabled-label"}>Add credits</Text>
                    </Pressable>
                  </>
                )}

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
                    <AdminField label="Gym name" hint="Shared by all its branches" value={fields.name} onChangeText={(name) => setFields((f) => ({ ...f, name }))} maxLength={80} />
                    <AdminField label="Branch name" value={fields.branch} onChangeText={(branch) => setFields((f) => ({ ...f, branch }))} maxLength={80} />
                    <AdminField label="Area" value={fields.area} onChangeText={(area) => setFields((f) => ({ ...f, area }))} maxLength={80} />
                    <AdminField label="City" value={fields.city} onChangeText={(city) => setFields((f) => ({ ...f, city }))} maxLength={60} />
                    {edit.error ? <FormAlert message={edit.error} /> : null}
                    <View className="flex-row" style={{ gap: 10 }}>
                      <Pressable onPress={() => edit.save((token) => adminGyms.update(token, gymId, { name: fields.name.trim(), branch: fields.branch.trim(), area: fields.area.trim(), city: fields.city.trim() }))} disabled={edit.busy} className="btn-forest flex-1" style={{ opacity: edit.busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Save gym details" accessibilityState={{ busy: edit.busy }}>
                        {edit.busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text className="btn-forest__label">Save</Text>}
                      </Pressable>
                      <Pressable onPress={() => setEditing(false)} disabled={edit.busy} className="btn-outline" style={{ paddingHorizontal: 18 }} accessibilityRole="button" accessibilityLabel="Cancel">
                        <Text className="btn-outline__label">Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable onPress={() => { setFields({ name: data.gym.name, branch: data.gym.branch, area: data.gym.area, city: data.gym.city }); setEditing(true); }} className="btn-outline" accessibilityRole="button" accessibilityLabel="Edit gym details">
                    <Text className="btn-outline__label">Edit names and place</Text>
                  </Pressable>
                )}
              </>
            )}
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}
