import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { BottomSheet } from "@/components/BottomSheet";
import { EmptyState } from "@/components/EmptyState";
import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SkeletonCard } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { findMe, openLocationSettings } from "@/lib/deliveryLocation";
import { discoverApi, type DiscoverQuery, type DiscoverSort, type GymCard } from "@/lib/discoverApi";
import { distanceText, facilitiesLine, fromPriceText, priceText } from "@/lib/gymDiscover";
import { averageText, countText } from "@/lib/gymReviews";
import { FACILITIES, GYM_TYPES, gymTypesText, type FacilityId, type GymType } from "@/lib/gymProfile";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

// key: the query the answer is for; while it isn't the current one, the list shows loading
type Load = { state: "loading" } | { state: "failed"; key: string; error: string } | { state: "ready"; key: string; gyms: GymCard[]; total: number; nextPage: number | null; priceCaps: number[] };
type Filters = { facilities: FacilityId[]; maxPrice: number | null; sort: DiscoverSort; trainers: boolean; type: GymType | null };
const NO_FILTERS: Filters = { facilities: [], maxPrice: null, sort: "relevance", trainers: false, type: null };
const PRICE_CAPS = [1000, 1500, 2000, 3000, 5000];

// Gym Hub › Discover Gyms (phase 3, 2026-11-09): every gym on justFit, searched by name, area or
// city, filtered by facilities and the cheapest plan a month, sorted by relevance or (once the
// member shares their location, asked only when Near me is tapped) by distance. A card opens the
// gym's page. 20 a page with Show more. The location is rounded and used for the answer only.
export function DiscoverGyms() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [near, setNear] = useState<DiscoverQuery["near"]>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<{ message: string; settings: boolean } | null>(null);
  const [answered, setResult] = useState<Load>({ state: "loading" });
  const [moreBusy, setMoreBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const call = useRef(0);

  // The search waits for a short pause in typing
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const query: DiscoverQuery = { search, facilities: filters.facilities, maxPrice: filters.maxPrice, sort: near ? filters.sort : "relevance", near, trainers: filters.trainers, type: filters.type };
  const key = JSON.stringify(query);
  const load = useCallback(async () => {
    const turn = ++call.current;
    const answer = await discoverApi.gyms(await getToken().catch(() => null), JSON.parse(key) as DiscoverQuery);
    if (turn !== call.current) return;
    setResult(answer.ok ? { state: "ready", key, gyms: answer.data.gyms, total: answer.data.total, nextPage: answer.data.nextPage, priceCaps: answer.data.priceCaps } : { state: "failed", key, error: answer.error });
  }, [getToken, key]);
  useEffect(() => { load(); }, [load]);
  const result: Load = answered.state !== "loading" && answered.key === key ? answered : { state: "loading" };
  const retry = () => { setResult({ state: "loading" }); load(); };

  const more = async () => {
    if (result.state !== "ready" || !result.nextPage || moreBusy) return;
    setMoreBusy(true);
    const turn = call.current;
    const answer = await discoverApi.gyms(await getToken().catch(() => null), { ...query, page: result.nextPage });
    setMoreBusy(false);
    if (turn !== call.current || !answer.ok) return;
    setResult((current) => (current.state === "ready" ? { ...current, gyms: [...current.gyms, ...answer.data.gyms], nextPage: answer.data.nextPage } : current));
  };

  // Near me: on asks for the location (only now) and sorts nearest first; off forgets it
  const toggleNear = async () => {
    if (near) {
      setNear(null);
      setFilters((f) => ({ ...f, sort: "relevance" }));
      return;
    }
    if (locating) return;
    setLocating(true);
    setLocationError(null);
    const found = await findMe();
    setLocating(false);
    if (!found.ok) {
      setLocationError({ settings: found.settings, message: found.settings ? "Location is off for justFit. Turn it on in Settings to see the gyms nearest you." : "We couldn't find your location. Try again, or search by area or city." });
      return;
    }
    setNear({ latitude: found.at.latitude, longitude: found.at.longitude });
    setFilters((f) => ({ ...f, sort: "distance" }));
  };

  const filterCount = filters.facilities.length + (filters.maxPrice !== null ? 1 : 0) + (filters.trainers ? 1 : 0) + (filters.type ? 1 : 0);
  const filtered = filterCount > 0 || search !== "";

  return (
    <View style={{ gap: 12 }}>
      <View className="address-search">
        <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
        <TextInput
          value={text}
          onChangeText={(t) => setText(t.slice(0, 60))}
          placeholder="Search gyms, areas or cities"
          placeholderTextColor={colors.faint}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, minHeight: 44, fontFamily: "Poppins-Regular", fontSize: 14, color: colors.ink, paddingVertical: 0 }}
          accessibilityLabel="Search gyms, areas or cities"
        />
        {text !== "" && (
          <Pressable onPress={() => setText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear the search">
            <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={16} tintColor={colors.muted} />
          </Pressable>
        )}
      </View>

      <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
        <PressableScale onPress={toggleNear} haptic="select" className={near ? "admin-chip admin-chip--on flex-row items-center" : "admin-chip flex-row items-center"} style={{ gap: 6 }} accessibilityRole="switch" accessibilityState={{ checked: Boolean(near), busy: locating }} accessibilityLabel="Near me">
          {locating ? <ActivityIndicator size="small" color={colors.leaf} /> : <SymbolView name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} size={14} tintColor={near ? colors.ink : colors.muted} />}
          <Text className={near ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>Near me</Text>
        </PressableScale>
        <PressableScale onPress={() => setSheetOpen(true)} haptic="select" className={filterCount > 0 ? "admin-chip admin-chip--on flex-row items-center" : "admin-chip flex-row items-center"} style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} on` : "Filters"}>
          <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={14} tintColor={filterCount > 0 ? colors.ink : colors.muted} />
          <Text className={filterCount > 0 ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{filterCount > 0 ? `Filters · ${filterCount}` : "Filters"}</Text>
        </PressableScale>
        {result.state === "ready" && <Text className="type-caption text-muted">{`${result.total} ${result.total === 1 ? "gym" : "gyms"}`}</Text>}
      </View>
      {locationError && (
        <View style={{ gap: 6 }}>
          <Text className="type-caption" style={{ color: colors.danger }}>{locationError.message}</Text>
          {locationError.settings && (
            <Pressable onPress={openLocationSettings} className="self-start" hitSlop={8} accessibilityRole="button">
              <Text className="auth__note-link">Open Settings</Text>
            </Pressable>
          )}
        </View>
      )}

      {result.state === "loading" ? (
        <View style={{ gap: 12 }} accessibilityLabel="Loading gyms">
          <SkeletonCard tall />
          <SkeletonCard tall />
        </View>
      ) : result.state === "failed" ? (
        <View className="card" style={{ gap: 12 }}>
          <FormAlert message={result.error} />
          <PrimaryButton label="Try again" onPress={retry} />
        </View>
      ) : result.gyms.length === 0 ? (
        <EmptyState
          icon={{ ios: "building.2", android: "location_city", web: "location_city" }}
          title={filtered ? "No gyms match" : "No gyms on justFit yet"}
          message={filtered ? "Try another name or city, or fewer filters." : "Gyms appear here as they join justFit."}
        >
          {filtered ? <PrimaryButton label="Clear search and filters" onPress={() => { setText(""); setSearch(""); setFilters({ ...NO_FILTERS, sort: near ? "distance" : "relevance" }); }} /> : null}
        </EmptyState>
      ) : (
        <>
          {result.gyms.map((gym) => <GymCardView key={gym.id} gym={gym} />)}
          {result.nextPage && <PrimaryButton label="Show more gyms" onPress={more} loading={moreBusy} />}
        </>
      )}

      {sheetOpen && (
        <FiltersSheet
          filters={filters}
          priceCaps={result.state === "ready" ? result.priceCaps : PRICE_CAPS}
          canSortByDistance={Boolean(near)}
          onApply={setFilters}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </View>
  );
}

function GymCardView({ gym }: { gym: GymCard }) {
  const colors = useThemeColors();
  const place = [gym.area, gym.city].filter((v, i, all) => v && all.indexOf(v) === i).join(", ");
  const distance = distanceText(gym.distanceKm);
  return (
    <PressableScale
      onPress={() => router.push({ pathname: "/gym-hub/gyms/[id]", params: { id: String(gym.id) } })}
      className="hub-gym-card"
      accessibilityRole="button"
      accessibilityLabel={`${gym.name} ${gym.branch}, ${place}${distance ? `, ${distance} away` : ""}${gym.rating ? `, rated ${averageText(gym.rating.average)} from ${countText(gym.rating.count)}` : ""}. ${fromPriceText(gym.fromPrice)}`}
      accessibilityHint="Opens the gym's photos, facilities, hours and plans"
    >
      <View>
        <View className="hub-gym-card__cover">
          {gym.coverUrl ? <MemberPhotoImage url={gym.coverUrl} /> : <SymbolView name={{ ios: "dumbbell", android: "fitness_center", web: "fitness_center" }} size={32} tintColor={colors.faint} />}
        </View>
        <View className="hub-gym-card__logo" style={{ zIndex: 1, elevation: 2 }}>
          {gym.logoUrl ? <MemberPhotoImage url={gym.logoUrl} fit="contain" /> : <Text className="type-subhead text-ink">{gym.name.slice(0, 1).toUpperCase()}</Text>}
        </View>
      </View>
      <View className="hub-gym-card__body">
        <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center" style={{ gap: 6 }}>
              <Text className="card__title shrink" numberOfLines={1}>{gym.name}</Text>
              {gym.featured ? <Text className="type-caption text-primary-text" accessibilityLabel="Featured by justFit">★ Featured</Text> : null}
            </View>
            <Text className="card__subtitle" numberOfLines={1}>{`${gym.branch} · ${place}${gym.trainerCount ? ` · ${gym.trainerCount} ${gym.trainerCount === 1 ? "trainer" : "trainers"}` : ""}`}</Text>
          </View>
          {distance ? <Text className="type-caption text-muted">{distance}</Text> : null}
        </View>
        {gym.rating ? (
          <View className="flex-row items-center" style={{ gap: 4 }}>
            <SymbolView name="star.fill" size={12} tintColor={colors.warning} />
            <Text className="type-caption text-ink">{`${averageText(gym.rating.average)} · ${countText(gym.rating.count)}`}</Text>
          </View>
        ) : null}
        {gymTypesText(gym.types) ? <Text className="type-caption text-primary-text" numberOfLines={1}>{gymTypesText(gym.types)}</Text> : null}
        {gym.facilities.length > 0 && <Text className="type-caption text-muted" numberOfLines={1}>{facilitiesLine(gym.facilities)}</Text>}
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text className="type-body" style={{ color: gym.fromPrice === null ? colors.muted : colors.ink }}>
            {gym.fromPrice === null ? fromPriceText(null) : `From ${priceText(gym.fromPrice)}/month`}
          </Text>
          <View className="flex-row items-center" style={{ gap: 2 }}>
            <Text className="auth__note-link">View details</Text>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={12} tintColor={colors.leaf} />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

// Filters: facilities (every one ticked must be there), the cheapest plan a month, and the order
function FiltersSheet({ filters, priceCaps, canSortByDistance, onApply, onClose }: { filters: Filters; priceCaps: number[]; canSortByDistance: boolean; onApply: (f: Filters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(filters);
  const Chip = ({ label, on, onPress, disabled = false }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled} className={on ? "admin-chip admin-chip--on" : "admin-chip"} style={{ opacity: disabled ? 0.45 : 1 }} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }} accessibilityLabel={label}>
      <Text className={on ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{label}</Text>
    </Pressable>
  );
  const toggle = (id: FacilityId) => setDraft((d) => ({ ...d, facilities: d.facilities.includes(id) ? d.facilities.filter((f) => f !== id) : [...d.facilities, id] }));
  return (
    <BottomSheet onClose={onClose}>
      {(dismiss) => (
        <ScrollView contentContainerStyle={{ gap: 16 }} showsVerticalScrollIndicator={false}>
          <Text className="type-headline text-forest-ink">Filters</Text>
          <View className="gap-2">
            <Text className="type-subhead text-forest-ink">Sort by</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Relevance" on={draft.sort === "relevance"} onPress={() => setDraft((d) => ({ ...d, sort: "relevance" }))} />
              <Chip label="Nearest first" on={draft.sort === "distance"} disabled={!canSortByDistance} onPress={() => setDraft((d) => ({ ...d, sort: "distance" }))} />
            </View>
            {!canSortByDistance && <Text className="meta-text">Turn on Near me to sort by distance.</Text>}
          </View>
          <View className="gap-2">
            <Text className="type-subhead text-forest-ink">Plans from</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Any price" on={draft.maxPrice === null} onPress={() => setDraft((d) => ({ ...d, maxPrice: null }))} />
              {priceCaps.map((cap) => <Chip key={cap} label={`Up to ${priceText(cap)}/month`} on={draft.maxPrice === cap} onPress={() => setDraft((d) => ({ ...d, maxPrice: cap }))} />)}
            </View>
          </View>
          <View className="gap-2">
            <Text className="type-subhead text-forest-ink">Kind of gym</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              <Chip label="Any" on={draft.type === null} onPress={() => setDraft((d) => ({ ...d, type: null }))} />
              {GYM_TYPES.map((t) => <Chip key={t.id} label={t.label} on={draft.type === t.id} onPress={() => setDraft((d) => ({ ...d, type: t.id }))} />)}
            </View>
            <Text className="type-subhead text-forest-ink">Trainers</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              <Chip label="Any gym" on={!draft.trainers} onPress={() => setDraft((d) => ({ ...d, trainers: false }))} />
              <Chip label="Has trainers" on={draft.trainers} onPress={() => setDraft((d) => ({ ...d, trainers: true }))} />
            </View>
            <Text className="type-subhead text-forest-ink">Facilities</Text>
            <View className="flex-row flex-wrap gap-2">
              {FACILITIES.map((f) => <Chip key={f.id} label={f.label} on={draft.facilities.includes(f.id)} onPress={() => toggle(f.id)} />)}
            </View>
          </View>
          <PrimaryButton label="Show gyms" onPress={() => { onApply(draft); dismiss(); }} />
          <Pressable onPress={() => setDraft({ ...NO_FILTERS, sort: canSortByDistance ? "distance" : "relevance" })} className="self-center" hitSlop={10} accessibilityRole="button">
            <Text className="auth__note-link">Clear filters</Text>
          </Pressable>
        </ScrollView>
      )}
    </BottomSheet>
  );
}
