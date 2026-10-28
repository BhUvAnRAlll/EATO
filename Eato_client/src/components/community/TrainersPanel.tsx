import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { isOffline } from "@/lib/community";
import { coachingModeLabels, specialties, specialtyLabels, type Specialty } from "@/lib/trainerRules";
import { trainers, type MyConnection, type TrainerCard } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// The Trainers tab: My Trainer (none, request pending, or connected with shortcuts) above
// Find Trainers (search by name or title, filter by specialty). A trainer's full profile,
// messaging, diet plan, workout and targets unlock only once they accept. `header` is the
// Community header, drawn above so the page scrolls as one.
export function TrainersPanel({ header }: { header: ReactElement }) {
  const getToken = useSessionToken();
  const [search, setSearch] = useState("");
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [list, setList] = useState<TrainerCard[] | null>(null);
  const [mine, setMine] = useState<MyConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(async () => {
    const result = await trainers.list(await getToken(), search.trim() || null, specialty);
    if (result.ok) {
      setList(result.data.trainers);
      setError(null);
    } else setError(result.error);
  }, [search, specialty, getToken]);

  const loadMine = useCallback(async () => {
    const result = await trainers.myConnection(await getToken());
    if (result.ok) setMine(result.data);
  }, [getToken]);

  // The search and filter reload the list (debounced); coming back to the tab reloads both
  useEffect(() => {
    const timer = setTimeout(loadList, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadList, search]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(loadMine, 0);
      return () => clearTimeout(timer);
    }, [loadMine]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadList(), loadMine()]);
    setRefreshing(false);
  };

  const openTrainer = (id: string) => router.push({ pathname: "/community/trainers/[id]", params: { id } });

  const myTrainer = (
    <View className="mx-5 mt-5">
      <Text className="setup__section mb-2">My Trainer</Text>
      {mine === null ? (
        <ActivityIndicator color={colors.forest} />
      ) : mine.state === "none" ? (
        <View className="post__card flex-row items-center gap-3">
          <View className="group__tile">
            <SymbolView name={{ ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" }} size={22} tintColor={colors.leaf} />
          </View>
          <Text className="post__body flex-1">{"You don't have a trainer yet. Find one below to get a diet plan, a workout and targets made for you."}</Text>
        </View>
      ) : (
        <View className="post__card gap-3">
          {/* The header opens My Trainer (or the trainer); the shortcuts below are separate buttons, not nested in it */}
          <Pressable onPress={() => (mine.state === "connected" ? router.push("/community/trainers/mine") : openTrainer(mine.trainer.member.id))} className="flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={mine.state === "connected" ? `My trainer ${mine.trainer.member.name}` : `Request sent to ${mine.trainer.member.name}`}>
            {mine.trainer.photoUrl ? <AuthImage path={mine.trainer.photoUrl} style={{ width: 48, height: 48, borderRadius: 24 }} /> : <Avatar member={mine.trainer.member} size={48} />}
            <View className="flex-1">
              <Text className="post__author" numberOfLines={1}>{mine.trainer.member.name}</Text>
              <Text className="post__time" numberOfLines={1}>{mine.state === "connected" ? `${mine.trainer.title} · connected` : "Request sent · waiting for them to accept"}</Text>
            </View>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
          </Pressable>
          {mine.state === "requested" ? (
            <View className="flex-row items-center gap-1.5">
              <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={12} tintColor={colors.muted} />
              <Text className="home__note flex-1">{mine.messageLockReason}</Text>
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {[
                { label: "Diet Plan", href: "/community/trainers/plan" as const, isNew: false, show: mine.trainer.offersNutrition },
                { label: "Workout", href: "/workout" as const, isNew: false, show: true },
                { label: "Targets", href: "/community/trainers/targets" as const, isNew: mine.recommendation?.isNew ?? false, show: mine.trainer.offersNutrition },
              ].filter((s) => s.show).map((s) => (
                <Pressable key={s.label} onPress={() => router.push(s.href)} className="admin__action flex-row items-center gap-1.5" accessibilityRole="button" accessibilityLabel={s.isNew ? `${s.label}, new recommendation` : s.label}>
                  <Text className="admin__action-label">{s.label}</Text>
                  {s.isNew && <View className="h-2 w-2 rounded-pill bg-danger" />}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      data={list ?? []}
      keyExtractor={(t) => t.member.id}
      ListHeaderComponent={
        <View>
          {header}
          {myTrainer}
          <Text className="setup__section mx-5 mb-2 mt-6">Find Trainers</Text>
          <View className="search mx-5">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
            <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search by name or specialization" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search trainers" />
          </View>
          <View className="mx-5 mt-3 flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {[null, ...specialties].map((value) => {
              const selected = specialty === value;
              const label = value ? specialtyLabels[value] : "All";
              return (
                <Pressable key={label} onPress={() => setSpecialty(value)} className={selected ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`Filter: ${label}`}>
                  <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          {error && list !== null && (
            <Pressable onPress={() => setError(null)} className="mx-5 mt-3">
              <FormAlert message={error} />
            </Pressable>
          )}
        </View>
      }
      ListHeaderComponentStyle={{ marginBottom: 12 }}
      ListEmptyComponent={
        <View className="px-5">
          {list === null ? (
            error ? <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={isOffline(error) ? "You're offline" : "Couldn't load trainers"} text={error} actionLabel="Retry" onAction={loadList} /> : <ActivityIndicator color={colors.forest} />
          ) : (
            <EmptyState icon={{ ios: "person.crop.circle.badge.questionmark", android: "person_search", web: "person_search" }} title="No trainers found" text={search || specialty ? "Try another name or specialty." : "Trainers taking clients will appear here."} />
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => openTrainer(item.member.id)} className="post__card mx-5 mb-3 gap-2" accessibilityRole="button" accessibilityLabel={`${item.member.name}, ${item.title}`}>
          <View className="flex-row items-center gap-3">
            {item.photoUrl ? <AuthImage path={item.photoUrl} style={{ width: 52, height: 52, borderRadius: 26 }} /> : <Avatar member={item.member} size={52} />}
            <View className="flex-1">
              <Text className="post__author" numberOfLines={1}>{item.member.name}</Text>
              <Text className="post__time" numberOfLines={1}>{`${item.title} · ${item.yearsExperience} yrs`}</Text>
            </View>
            {item.connection !== "none" && (
              <View className="rounded-pill bg-forest-soft px-3 py-1">
                <Text className="post__time" style={{ color: colors.forestInk }}>{item.connection === "connected" ? "Your trainer" : "Requested"}</Text>
              </View>
            )}
          </View>
          <Text className="post__body" numberOfLines={2}>{item.bio}</Text>
          <Text className="home__note" numberOfLines={1}>{[item.specialties.map((s) => specialtyLabels[s]).join(", "), coachingModeLabels[item.coachingMode], item.offersNutrition ? "Nutrition coaching" : null].filter(Boolean).join(" · ")}</Text>
        </Pressable>
      )}
      contentContainerStyle={{ paddingBottom: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );
}
