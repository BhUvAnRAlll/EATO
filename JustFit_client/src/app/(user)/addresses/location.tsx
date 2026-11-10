import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { AddressMap, addressMapAvailable, type MapFocus } from "@/components/AddressMap";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SymbolView } from "@/components/SymbolView";
import { KIND_ICON } from "@/data/addresses";
import { addressApi, type DeliveryAddress, type Serviceable } from "@/lib/addressApi";
import { KIND_LABEL, addressLines, type LatLng, type PickedPlace } from "@/lib/addressRules";
import { findMe, nameOf, openLocationSettings, searchPlaces } from "@/lib/deliveryLocation";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { useAddressBook } from "@/lib/useAddressBook";
import { useAddressDraft } from "@/store/addressDraft";
import { useThemeColors } from "@/theme";

type Problem = { text: string; settings: boolean } | null;

const number = (value: string | undefined) => (value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null);

// Select Delivery Location: the map with the pin in the middle (move the map to place it), a search
// by the phone's geocoder, "Use current location", the address under the pin and whether justFit
// delivers there, the saved addresses, and a fixed Confirm Location that opens the address form.
// ?then=back (Change on the form) hands the place back instead; ?lat=&lng= start the map there.
export default function SelectLocation() {
  const params = useLocalSearchParams<{ then?: string; lat?: string; lng?: string }>();
  const handBack = params.then === "back";
  const lat = number(params.lat);
  const lng = number(params.lng);
  const startAt = useMemo<LatLng | null>(() => (lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null), [lat, lng]);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const setDraft = useAddressDraft((state) => state.setPlace);
  const { load, set: setBook, getToken } = useAddressBook();

  const [start, setStart] = useState<LatLng | null>(startAt);
  // Whether the map may draw yet: it waits for a start point (params, the selected address or GPS)
  const [started, setStarted] = useState(startAt !== null);
  const [focus, setFocus] = useState<MapFocus>(null);
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [naming, setNaming] = useState(false);
  const [service, setService] = useState<Serviceable | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const settleCount = useRef(0);
  const focusKey = useRef(0);

  const book = load.state === "ready" ? load.book : null;

  // Names the place under the pin (the latest settle wins) and asks whether justFit delivers there
  const settle = useCallback(async (at: LatLng) => {
    const turn = ++settleCount.current;
    setNaming(true);
    setService(null);
    const { place: found, named } = await nameOf(at);
    if (turn !== settleCount.current) return;
    setPlace(found);
    setNaming(false);
    if (!named && Platform.OS !== "web") setProblem({ text: "We couldn't read the address here (no connection?). You can still type it on the next screen.", settings: false });
    if (found.pincode) {
      const answer = await addressApi.serviceable(await getToken().catch(() => null), found.pincode);
      if (turn === settleCount.current && answer.ok) setService(answer.data);
    }
  }, [getToken]);

  // Where the map opens: the link's point (Change on the form), else the member's current location,
  // found straight away (2026-11-09, the user's request: adding an address detects where you are;
  // the permission is asked for here). If that fails, the selected address or India, with the reason.
  // The address book as it is now, for the fallback (read once GPS has answered)
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    (async () => {
      // The link's point (the web build has no map to settle, so it is named straight away)
      if (startAt) {
        if (!addressMapAvailable) settle(startAt);
        return;
      }
      setLocating(true);
      const here = await findMe();
      setLocating(false);
      if (here.ok) {
        setStart(here.at);
        setStarted(true);
        if (!addressMapAvailable) settle(here.at);
        return;
      }
      setProblem({ text: here.message, settings: here.settings });
      const book = loadRef.current.state === "ready" ? loadRef.current.book : null;
      const selected = book?.addresses.find((a) => a.isDefault);
      if (selected) {
        const at = { latitude: selected.latitude, longitude: selected.longitude };
        setStart(at);
        setStarted(true);
        if (!addressMapAvailable) settle(at);
        return;
      }
      setStarted(true);
    })();
  }, [settle, startAt]);

  const goTo = (at: LatLng) => {
    focusKey.current += 1;
    setFocus({ at, key: focusKey.current });
    if (!addressMapAvailable) settle(at);
  };

  const useMine = async () => {
    if (locating) return;
    haptic.select();
    Keyboard.dismiss();
    setLocating(true);
    setProblem(null);
    const here = await findMe();
    setLocating(false);
    if (!here.ok) return setProblem({ text: here.message, settings: here.settings });
    setResults(null);
    goTo(here.at);
  };

  const search = async () => {
    const text = query.trim();
    if (text.length < 3 || searching) return;
    Keyboard.dismiss();
    setSearching(true);
    setProblem(null);
    const answer = await searchPlaces(text);
    setSearching(false);
    if (!answer.ok) {
      setResults(null);
      return setProblem({ text: answer.message, settings: false });
    }
    setResults(answer.places);
  };

  const pickResult = (found: PickedPlace) => {
    haptic.select();
    setResults(null);
    setQuery("");
    setPlace(found);
    goTo(found);
  };

  const confirm = () => {
    if (!place || naming) return;
    setDraft(place);
    if (handBack && router.canGoBack()) return router.back();
    router.push({ pathname: "/addresses/form", params: { from: "map" } });
  };

  // A saved address: deliver there, and back to where the member came from
  const deliverTo = async (address: DeliveryAddress) => {
    if (busyId !== null) return;
    haptic.select();
    if (!address.isDefault) {
      setBusyId(address.id);
      const answer = await addressApi.select(await getToken().catch(() => null), address.id);
      setBusyId(null);
      if (!answer.ok) return setProblem({ text: answer.error, settings: false });
      setBook(answer.data);
      hud.success(`Delivering to ${KIND_LABEL[address.kind]}`);
    }
    if (router.canGoBack()) router.back();
    else router.replace("/addresses");
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Select delivery location" fallback="/addresses" />

        {/* The map, with the search over its top and "Use current location" over its bottom */}
        <View className="address-map">
          {started ? (
            <AddressMap start={start} focus={focus} onMove={() => { setNaming(true); setProblem(null); }} onSettle={settle} />
          ) : (
            <View className="address-map__loading">
              <ActivityIndicator color={colors.leaf} />
              <Text className="type-caption text-muted">Finding your current location…</Text>
            </View>
          )}

          <View className="absolute" style={{ top: 12, left: 16, right: 16, gap: 8 }}>
            <View className="address-search">
              <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
              <TextInput
                value={query}
                onChangeText={(text) => { setQuery(text.slice(0, 80)); if (results) setResults(null); }}
                onSubmitEditing={search}
                placeholder="Search for an area, street or landmark"
                placeholderTextColor={colors.faint}
                returnKeyType="search"
                autoCorrect={false}
                style={{ flex: 1, minHeight: 44, fontFamily: "Poppins-Regular", fontSize: 14, color: colors.ink, paddingVertical: 0 }}
                accessibilityLabel="Search for an area, street or landmark"
              />
              {searching ? (
                <ActivityIndicator size="small" color={colors.leaf} />
              ) : query.trim().length >= 3 ? (
                <PressableScale onPress={search} hitSlop={8} accessibilityRole="button" accessibilityLabel="Search">
                  <Text className="address-locate__label">Search</Text>
                </PressableScale>
              ) : null}
            </View>
            {results && results.length > 0 && (
              <View className="address-results">
                <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
                  {results.map((found, index) => (
                    <PressableScale key={`${found.latitude},${found.longitude},${index}`} onPress={() => pickResult(found)} className="address-result" style={index === results.length - 1 ? { borderBottomWidth: 0 } : undefined} accessibilityRole="button" accessibilityLabel={found.formattedAddress}>
                      <SymbolView name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} size={18} tintColor={colors.muted} />
                      <View className="min-w-0 flex-1">
                        <Text className="card__title" numberOfLines={1}>{found.title}</Text>
                        <Text className="type-caption text-muted" numberOfLines={2}>{found.formattedAddress}</Text>
                      </View>
                    </PressableScale>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <View className="absolute items-center" style={{ left: 0, right: 0, bottom: 32 }} pointerEvents="box-none">
            <PressableScale onPress={useMine} disabled={locating} className="address-locate" accessibilityRole="button" accessibilityLabel="Use current location" accessibilityState={{ busy: locating }}>
              {locating ? <ActivityIndicator size="small" color={colors.leaf} /> : <SymbolView name={{ ios: "location.fill", android: "my_location", web: "my_location" }} size={15} tintColor={colors.leaf} />}
              <Text className="address-locate__label">{locating ? "Finding you…" : "Use current location"}</Text>
            </PressableScale>
          </View>
        </View>

        {/* The address under the pin and the saved addresses. It shrinks (and scrolls) before the map
            goes under its minimum, so Confirm is never pushed off a small phone */}
        <View className="address-panel" style={{ maxHeight: "48%", flexShrink: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text className="type-overline text-muted">Deliver to</Text>
            <View className="flex-row items-start" style={{ gap: 12 }}>
              <View className="address-kind address-kind--selected">
                <SymbolView name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} size={18} tintColor={colors.leaf} />
              </View>
              <View className="min-w-0 flex-1" style={{ gap: 2 }} accessibilityLiveRegion="polite">
                {naming || !place ? (
                  <>
                    <Text className="card__title">{place || naming ? "Finding the address…" : "No place picked yet"}</Text>
                    <Text className="type-caption text-muted">{addressMapAvailable ? "Move the map to put the pin on your building" : "Use your current location to start"}</Text>
                  </>
                ) : (
                  <>
                    <Text className="card__title" numberOfLines={1}>{place.title}</Text>
                    <Text className="type-caption text-muted" numberOfLines={3}>{place.formattedAddress}</Text>
                  </>
                )}
              </View>
            </View>
            {!naming && service && (
              service.deliverable ? (
                <View className="address-tag address-tag--success">
                  <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={12} tintColor={colors.success} />
                  <Text className="address-tag__label" style={{ color: colors.success }}>justFit delivers here</Text>
                </View>
              ) : (
                <View className="address-tag address-tag--warning">
                  <SymbolView name={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }} size={12} tintColor={colors.warning} />
                  <Text className="address-tag__label" style={{ color: colors.warning }}>{`Not delivering to ${service.pincode} yet`}</Text>
                </View>
              )
            )}
            {problem && (
              <View style={{ gap: 6 }}>
                <Text className="type-caption text-muted">{problem.text}</Text>
                {problem.settings && (
                  <PressableScale onPress={openLocationSettings} className="address-action self-start" accessibilityRole="button" accessibilityLabel="Open Settings">
                    <Text className="address-action__label" style={{ color: colors.primaryText }}>Open Settings</Text>
                  </PressableScale>
                )}
              </View>
            )}

            {!handBack && book && book.addresses.length > 0 && (
              <View style={{ gap: 4 }} className="mt-2">
                <Text className="type-overline text-muted">Saved addresses</Text>
                {book.addresses.slice(0, 6).map((address) => {
                  const lines = addressLines(address);
                  return (
                    <PressableScale key={address.id} onPress={() => deliverTo(address)} disabled={busyId !== null} className="list-row" accessibilityRole="button" accessibilityLabel={`Deliver to ${KIND_LABEL[address.kind]}: ${lines.first}, ${lines.second}`} accessibilityState={{ selected: address.isDefault, busy: busyId === address.id }}>
                      <View className={address.isDefault ? "address-kind address-kind--selected" : "address-kind"}>
                        <SymbolView name={KIND_ICON[address.kind]} size={16} tintColor={address.isDefault ? colors.leaf : colors.inkSoft} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="card__title">{KIND_LABEL[address.kind]}</Text>
                        <Text className="type-caption text-muted" numberOfLines={1}>{`${lines.first}, ${lines.second}`}</Text>
                      </View>
                      {busyId === address.id ? (
                        <ActivityIndicator size="small" color={colors.leaf} />
                      ) : address.isDefault ? (
                        <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={18} tintColor={colors.leaf} />
                      ) : null}
                    </PressableScale>
                  );
                })}
                <PressableScale onPress={() => router.push("/addresses")} className="address-action self-start mt-1" accessibilityRole="button" accessibilityLabel="Manage saved addresses">
                  <Text className="address-action__label" style={{ color: colors.primaryText }}>Manage addresses</Text>
                </PressableScale>
              </View>
            )}
          </ScrollView>
        </View>

        <View className="address-footer" style={{ paddingBottom: insets.bottom + 12 }}>
          <PrimaryButton label="Confirm Location" onPress={confirm} disabled={!place || naming} />
        </View>
      </SafeAreaView>
    </View>
  );
}
