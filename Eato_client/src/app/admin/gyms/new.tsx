import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { Avatar } from "@/components/community/Avatar";
import { KIND_LABEL, PLAN_LABEL, adminPortal, type AdminUserRow, type GymPlan, type NewGym } from "@/lib/adminPortal";
import { visibilityLabels, type GymVisibility } from "@/lib/gymRules";
import { useSessionToken } from "@/lib/session";
import { colors, switchColors } from "@/theme";

// Super Admin › Create gym: name, area, owner (an existing JustFit account, picked from a search),
// visibility, approval and plan. Creating starts a 14-day trial and makes the chosen person its
// owner, who then runs it from Gym Manager. The server checks everything again.

const PLANS: GymPlan[] = ["starter", "pro", "elite"];
const OWNER_RESULTS = 6;
const input = { height: 50, borderRadius: 16, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 16, fontSize: 15, color: colors.forestInk } as const;

export default function AdminCreateGym() {
  const getToken = useSessionToken();
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");
  const [owners, setOwners] = useState<AdminUserRow[]>([]);
  const [owner, setOwner] = useState<AdminUserRow | null>(null);
  const [visibility, setVisibility] = useState<GymVisibility>("public");
  const [memberApproval, setMemberApproval] = useState(false);
  const [plan, setPlan] = useState<GymPlan>("starter");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // People to pick as the owner, a moment after typing stops (suspended accounts left out)
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await adminPortal.users(await getToken().catch(() => null), "all", ownerSearch.trim());
      if (!cancelled && result.ok) setOwners(result.data.users.filter((u) => !u.suspended).slice(0, OWNER_RESULTS));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ownerSearch, getToken]);

  const create = async () => {
    if (name.trim().length < 2) return setError("Give the gym a name.");
    if (location.trim().length < 2) return setError("Enter the gym's area.");
    if (!owner) return setError("Pick the gym's owner.");
    setSaving(true);
    setError(null);
    const gym: NewGym = { name: name.trim(), tagline: tagline.trim() || null, location: location.trim(), address: address.trim() || null, ownerId: owner.id, visibility, memberApproval, plan };
    const result = await adminPortal.createGym(await getToken().catch(() => null), gym);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    router.replace({ pathname: "/admin/gyms/[gymId]", params: { gymId: result.data.gym.id } });
  };

  const field = (label: string, value: string, onChange: (v: string) => void, opts: { required?: boolean; placeholder?: string; max: number }) => (
    <View className="gap-1.5">
      <Text className="compose__label">{label}{opts.required && <Text className="compose__required"> *</Text>}</Text>
      <TextInput value={value} onChangeText={(v) => { onChange(v); setError(null); }} placeholder={opts.placeholder} placeholderTextColor={colors.faint} maxLength={opts.max} accessibilityLabel={label} style={input} />
    </View>
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/admin/gyms"))} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title flex-1 text-center">Create gym</Text>
          <View className="screen-bar__back" />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {field("Gym name", name, setName, { required: true, max: 80 })}
            {field("Tagline", tagline, setTagline, { placeholder: "e.g. Strength, conditioning & community", max: 120 })}
            {field("Area", location, setLocation, { required: true, placeholder: "e.g. Indiranagar, Bengaluru", max: 80 })}
            {field("Street address", address, setAddress, { max: 200 })}

            <View className="gap-1.5">
              <Text className="compose__label">Owner<Text className="compose__required"> *</Text></Text>
              <View className="search search--pill">
                <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
                <TextInput className="search__input" value={ownerSearch} onChangeText={setOwnerSearch} placeholder="Search by name or email" placeholderTextColor={colors.faint} autoCorrect={false} autoCapitalize="none" maxLength={80} accessibilityLabel="Search for the owner" />
              </View>
              <View className="admin-list" accessibilityRole="radiogroup">
                {owners.length === 0 ? (
                  <Text className="home__note p-4">No account matches.</Text>
                ) : (
                  owners.map((u, i) => {
                    const selected = owner?.id === u.id;
                    return (
                      <Pressable key={u.id} onPress={() => { setOwner(u); setError(null); }} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`Owner: ${u.name}`}>
                        <Avatar member={{ id: u.id, name: u.name, initial: u.name.charAt(0).toUpperCase() }} size={36} />
                        <Text className="card__title min-w-0 flex-1" numberOfLines={1}>{u.name}</Text>
                        <Text className="post__time">{KIND_LABEL[u.kind]}</Text>
                        <View className={selected ? "radio radio--selected" : "radio"}>{selected && <View className="radio__dot" />}</View>
                      </Pressable>
                    );
                  })
                )}
              </View>
              {owner && <Text className="home__note">{`${owner.name} will own this gym and run it from Gym Manager.`}</Text>}
            </View>

            <View className="gap-1.5">
              <Text className="compose__label">Visibility</Text>
              <View className="admin-list" accessibilityRole="radiogroup">
                {(Object.keys(visibilityLabels) as GymVisibility[]).map((value, i) => {
                  const selected = visibility === value;
                  return (
                    <Pressable key={value} onPress={() => setVisibility(value)} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${visibilityLabels[value].label}: ${visibilityLabels[value].hint}`}>
                      <View className="min-w-0 flex-1">
                        <Text className="card__title">{visibilityLabels[value].label}</Text>
                        <Text className="post__time">{visibilityLabels[value].hint}</Text>
                      </View>
                      <View className={selected ? "radio radio--selected" : "radio"}>{selected && <View className="radio__dot" />}</View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="admin-list flex-row items-center gap-3" style={{ padding: 16 }}>
              <View className="min-w-0 flex-1">
                <Text className="card__title">Approve new members</Text>
                <Text className="post__time">The owner approves each join request.</Text>
              </View>
              <Switch {...switchColors} value={memberApproval} onValueChange={setMemberApproval} accessibilityLabel="Approve new members" />
            </View>

            <View className="gap-1.5">
              <Text className="compose__label">Plan (14-day trial)</Text>
              <View className="flex-row gap-2" accessibilityRole="radiogroup">
                {PLANS.map((p) => {
                  const selected = plan === p;
                  return (
                    <Pressable key={p} onPress={() => setPlan(p)} className={selected ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${PLAN_LABEL[p]} plan`}>
                      <Text className={selected ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{PLAN_LABEL[p]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text className="home__note">No payment is taken. The plan is a label.</Text>
            </View>

            {error && <FormAlert message={error} />}
          </ScrollView>
          <View className="compose__footer">
            <Pressable onPress={create} disabled={saving} className="btn-forest flex-1" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Create gym">
              {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Create gym</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
