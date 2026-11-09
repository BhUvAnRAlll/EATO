import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { addressApi, type DeliveryAddress } from "@/lib/addressApi";
import { KIND_LABEL, addressLines, phoneText } from "@/lib/addressRules";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { confirmChoice } from "@/lib/nativeSheets";
import { useAddressBook } from "@/lib/useAddressBook";
import { KIND_ICON } from "@/data/addresses";
import { useAddressDraft } from "@/store/addressDraft";
import { useThemeColors } from "@/theme";

// Profile › Delivery addresses (and Home's "Deliver to" pill): every saved address as a card, the
// selected one outlined in red. Tapping a card delivers there; Edit, Delete and Deliver here sit
// under each. ?pick=1 (from a screen that needs an address) goes back once one is chosen.
export default function SavedAddresses() {
  const insets = useSafeAreaInsets();
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const { load, reload, retry, set, getToken } = useAddressBook();
  const { refreshControl } = usePullToRefresh(reload);
  const clearDraft = useAddressDraft((state) => state.clear);
  // The address a change is running on, so its buttons wait
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const book = load.state === "ready" ? load.book : null;
  const full = book ? book.addresses.length >= book.max : false;

  const deliverHere = async (address: DeliveryAddress) => {
    if (busyId !== null) return;
    if (address.isDefault) {
      if (pick) router.back();
      return;
    }
    haptic.select();
    setBusyId(address.id);
    setError(null);
    const answer = await addressApi.select(await getToken().catch(() => null), address.id);
    setBusyId(null);
    if (!answer.ok) return setError(answer.error);
    set(answer.data);
    hud.success(`Delivering to ${KIND_LABEL[address.kind]}`);
    if (pick && router.canGoBack()) router.back();
  };

  const remove = async (address: DeliveryAddress) => {
    if (busyId !== null) return;
    const sure = await confirmChoice({
      title: `Delete this ${KIND_LABEL[address.kind]} address?`,
      message: `${address.house}, ${address.street}`,
      confirmLabel: "Delete",
    });
    if (!sure) return;
    setBusyId(address.id);
    setError(null);
    const answer = await addressApi.remove(await getToken().catch(() => null), address.id);
    setBusyId(null);
    if (!answer.ok) return setError(answer.error);
    set(answer.data);
    hud.success("Address deleted");
  };

  const addNew = () => {
    clearDraft();
    router.push("/addresses/location");
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Delivery addresses" subtitle={book && book.addresses.length > 0 ? "Tap an address to deliver there" : undefined} fallback="/profile" />

        {load.state === "loading" ? (
          <View className="p-4">
            <ScreenSkeleton cards={3} label="Loading your addresses" />
          </View>
        ) : load.state === "failed" ? (
          <View className="p-4">
            <View className="card" style={{ gap: 12 }}>
              <FormAlert message={load.error} />
              <PrimaryButton label="Try again" onPress={retry} />
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 14 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
            {error && <FormAlert message={error} />}
            {load.book.addresses.length === 0 ? (
              <EmptyState
                icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }}
                title="No saved addresses yet"
                message="Add where your meals should go: home, work or anywhere else. We'll check that justFit delivers there."
              />
            ) : (
              load.book.addresses.map((address) => (
                <AddressCard
                  key={address.id}
                  address={address}
                  busy={busyId === address.id}
                  locked={busyId !== null}
                  onPick={() => deliverHere(address)}
                  onEdit={() => {
                    // The form shows the saved pin unless a new one is picked
                    clearDraft();
                    router.push({ pathname: "/addresses/form", params: { id: String(address.id) } });
                  }}
                  onDelete={() => remove(address)}
                />
              ))
            )}
            {full && <Text className="type-caption text-muted text-center">{`You can keep ${load.book.max} addresses. Delete one to add another.`}</Text>}
          </ScrollView>
        )}

        {/* The main action stays at the bottom, above the home indicator */}
        {book && (
          <View className="address-footer" style={{ paddingBottom: insets.bottom + 12 }}>
            <PrimaryButton label="Add New Address" onPress={addNew} disabled={full} />
          </View>
        )}
      </SafeAreaView>
    </View>
  );

}

// One saved address: the details (tap to deliver there), then Edit, Delete and Deliver here. The
// actions sit beside the details, never inside their button (nested buttons break on the web).
function AddressCard({ address, busy, locked, onPick, onEdit, onDelete }: { address: DeliveryAddress; busy: boolean; locked: boolean; onPick: () => void; onEdit: () => void; onDelete: () => void }) {
  const colors = useThemeColors();
  const lines = addressLines(address);
  const selected = address.isDefault;
  return (
    <View className={selected ? "address-card address-card--selected" : "address-card"}>
      <PressableScale
        onPress={onPick}
        disabled={locked}
        accessibilityRole="radio"
        accessibilityState={{ selected, busy }}
        accessibilityLabel={`${KIND_LABEL[address.kind]}: ${address.house}, ${address.street}, ${address.pincode}${selected ? ". Selected for delivery" : ""}${address.deliverable ? "" : ". justFit doesn't deliver here yet"}`}
      >
        <View className="flex-row items-start" style={{ gap: 12 }}>
          <View className={selected ? "address-kind address-kind--selected" : "address-kind"}>
            <SymbolView name={KIND_ICON[address.kind]} size={18} tintColor={selected ? colors.leaf : colors.inkSoft} />
          </View>
          <View className="min-w-0 flex-1" style={{ gap: 2 }}>
            <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
              <Text className="card__title">{KIND_LABEL[address.kind]}</Text>
              {selected && (
                <View className="address-tag">
                  <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={12} tintColor={colors.leaf} />
                  <Text className="address-tag__label">Selected</Text>
                </View>
              )}
            </View>
            <Text className="type-body text-ink">{lines.first}</Text>
            <Text className="type-caption text-muted">{lines.second}</Text>
            {lines.landmark && <Text className="type-caption text-muted">{lines.landmark}</Text>}
            <Text className="type-caption text-muted">{`${address.receiverName} · ${phoneText(address.receiverPhone)}`}</Text>
            {!address.deliverable && (
              <View className="address-tag address-tag--warning mt-1">
                <SymbolView name={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }} size={12} tintColor={colors.warning} />
                <Text className="address-tag__label" style={{ color: colors.warning }}>{`Not delivering to ${address.pincode} yet`}</Text>
              </View>
            )}
          </View>
        </View>
      </PressableScale>
        <View className="address-card__actions">
          <PressableScale onPress={onEdit} disabled={locked} className="address-action" accessibilityRole="button" accessibilityLabel={`Edit ${KIND_LABEL[address.kind]} address`}>
            <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={14} tintColor={colors.ink} />
            <Text className="address-action__label">Edit</Text>
          </PressableScale>
          <PressableScale onPress={onDelete} disabled={locked} className="address-action" accessibilityRole="button" accessibilityLabel={`Delete ${KIND_LABEL[address.kind]} address`}>
            <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={14} tintColor={colors.danger} />
            <Text className="address-action__label" style={{ color: colors.danger }}>Delete</Text>
          </PressableScale>
          {!selected && (
            <PressableScale onPress={onPick} disabled={locked} className="address-action" accessibilityRole="button" accessibilityLabel={`Deliver to ${KIND_LABEL[address.kind]} address`}>
              <SymbolView name={{ ios: "checkmark.circle", android: "radio_button_unchecked", web: "radio_button_unchecked" }} size={14} tintColor={colors.leaf} />
              <Text className="address-action__label" style={{ color: colors.primaryText }}>{busy ? "Selecting…" : "Deliver here"}</Text>
            </PressableScale>
          )}
        </View>
    </View>
  );
}
