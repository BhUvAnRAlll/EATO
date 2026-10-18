import { useCallback, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { AdminButton, AdminScreen } from "@/components/admin/AdminScreen";
import { FormAlert } from "@/components/FormAlert";
import { visibilityLabels, type GymVisibility } from "@/lib/gymRules";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

const input = { height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, fontSize: 15, color: colors.forestInk } as const;

// Platform admins create gyms and name each one's owner (an existing EATO account, by email).
// The owner then runs the gym from Community → Gyms → Gym owner portal. Tapping a gym here opens
// its owner portal (platform admins may open any gym's). The server allows this to platform admins only.
export default function AdminGyms() {
  const getToken = useSessionToken();
  const [list, setList] = useState<Gym[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [visibility, setVisibility] = useState<GymVisibility>("public");
  const [memberApproval, setMemberApproval] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await gyms.listAll(await getToken()); // hidden gyms included
    if (result.ok) setList(result.data.gyms);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const create = async () => {
    if (name.trim().length < 2) return setError("Give the gym a name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) return setError("Enter the owner's email.");
    setSaving(true);
    setError(null);
    const result = await gyms.create(await getToken(), { name: name.trim(), location: location.trim() || null, ownerEmail: ownerEmail.trim(), visibility, memberApproval });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setNotice(`${result.data.gym.name} is ready. Its owner can manage it from Community → Gyms.`);
    setName("");
    setLocation("");
    setOwnerEmail("");
    await load();
  };

  return (
    <AdminScreen title="Gyms" subtitle="Create a gym community and name its owner">
      <View className="gap-3">
        {error && <FormAlert message={error} />}
        {notice && <Text className="home__note">{notice}</Text>}
        <Text className="auth__label">Gym name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Iron Temple" placeholderTextColor={colors.faint} maxLength={80} accessibilityLabel="Gym name" style={input} />
        <Text className="auth__label">Area (optional)</Text>
        <TextInput value={location} onChangeText={setLocation} placeholder="Indiranagar, Bengaluru" placeholderTextColor={colors.faint} maxLength={80} accessibilityLabel="Area" style={input} />
        <Text className="auth__label">{"Owner's email"}</Text>
        <TextInput value={ownerEmail} onChangeText={setOwnerEmail} placeholder="owner@example.com" placeholderTextColor={colors.faint} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Owner's email" style={input} />
        <Text className="home__note">The owner must already have an EATO account.</Text>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {(Object.keys(visibilityLabels) as GymVisibility[]).map((value) => (
            <Pressable key={value} onPress={() => setVisibility(value)} className={visibility === value ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: visibility === value }}>
              <Text className={visibility === value ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{visibilityLabels[value].label}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="home__note">{visibilityLabels[visibility].hint}</Text>
        <View className="flex-row items-center justify-between">
          <Text className="auth__label">Approve new members</Text>
          <Switch value={memberApproval} onValueChange={setMemberApproval} trackColor={{ true: colors.forest }} accessibilityLabel="Approve new members" />
        </View>
        <AdminButton label={saving ? "Creating…" : "Create gym"} variant="primary" onPress={create} disabled={saving} />
        <Text className="setup__section mt-4">Gyms</Text>
        {list.length === 0 ? (
          <Text className="home__note">No gyms yet.</Text>
        ) : (
          list.map((gym) => (
            <Pressable
              key={gym.id}
              onPress={() => {
                useOwnerStore.getState().setGym(gym.id);
                router.push("/owner");
              }}
              className="py-2"
              accessibilityRole="button"
              accessibilityLabel={`Open the owner portal for ${gym.name}`}
            >
              <Text className="post__author">{gym.name}</Text>
              <Text className="post__time">{[gym.location, visibilityLabels[gym.visibility].label, `${gym.memberCount} ${gym.memberCount === 1 ? "member" : "members"}`].filter(Boolean).join(" · ")}</Text>
            </Pressable>
          ))
        )}
      </View>
    </AdminScreen>
  );
}
