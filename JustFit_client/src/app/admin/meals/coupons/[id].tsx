import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { DateField, OnOffRow, isoToday } from "@/components/admin/AdminPickers";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { useGymSave } from "@/lib/gymForm";
import { hud } from "@/lib/hud";
import { kitchenApi, type Coupon } from "@/lib/mealsApi";
import { confirmChoice } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals/coupons"));
const digits = (t: string) => t.replace(/[^0-9]/g, "");

// Super Admin › Meals › Coupons › New or a coupon: the code members type, a title, % off (with the
// most it can take off) or ₹ off, the minimum order, uses per member, the days it works (empty =
// from now / no end) and on or off. The server works out every discount itself.
export default function AdminCoupon() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const load = useCallback(async (token: string | null) => {
    const answer = await kitchenApi.coupons(token);
    if (!answer.ok) return answer;
    const coupon = isNew ? null : answer.data.coupons.find((c) => String(c.id) === id) ?? undefined;
    if (coupon === undefined) return { ok: false as const, error: "That coupon was deleted.", status: 404 };
    return { ok: true as const, data: coupon };
  }, [id, isNew]);
  const { result, retry } = useGymData(load);
  return (
    <AdminScreen title={isNew ? "New coupon" : "Edit coupon"}>
      {result.state === "loading" && <ScreenSkeleton label="Loading" />}
      {result.state === "failed" && <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />}
      {result.state === "ready" && <CouponForm coupon={result.data} />}
    </AdminScreen>
  );
}

function CouponForm({ coupon }: { coupon: Coupon | null }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [code, setCode] = useState(coupon?.code ?? "");
  const [title, setTitle] = useState(coupon?.title ?? "");
  const [kind, setKind] = useState<"percent" | "flat">(coupon?.kind ?? "percent");
  const [percentOff, setPercentOff] = useState(coupon?.percentOff ? String(coupon.percentOff) : "");
  const [flatOff, setFlatOff] = useState(coupon?.flatOff ? String(coupon.flatOff) : "");
  const [maxDiscount, setMaxDiscount] = useState(coupon?.maxDiscount ? String(coupon.maxDiscount) : "");
  const [minOrder, setMinOrder] = useState(coupon?.minOrder ? String(coupon.minOrder) : "");
  const [perMemberLimit, setPerMemberLimit] = useState(String(coupon?.perMemberLimit ?? 1));
  const [startsOn, setStartsOn] = useState<string | null>(coupon?.startsOn ?? null);
  const [endsOn, setEndsOn] = useState<string | null>(coupon?.endsOn ?? null);
  const [active, setActive] = useState(coupon?.active ?? true);
  const [firstOrderOnly, setFirstOrderOnly] = useState(coupon?.firstOrderOnly ?? false);
  const [deleting, setDeleting] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const { busy, error, save } = useGymSave(() => back(), coupon ? "Coupon saved" : "Coupon added");

  const pct = Number(percentOff);
  const flat = Number(flatOff);
  const uses = Number(perMemberLimit);
  const valueOk = kind === "percent" ? pct >= 1 && pct <= 90 : flat >= 1 && flat <= 2000;
  const daysWrong = !!startsOn && !!endsOn && endsOn < startsOn;
  const ready = /^[A-Z0-9]{3,16}$/.test(code) && title.trim().length >= 3 && valueOk && uses >= 1 && uses <= 20 && !daysWrong;
  // What a member will read, before saving
  const preview = kind === "percent" ? `${pct || "?"}% off${maxDiscount ? ` up to ₹${maxDiscount}` : ""}` : `₹${flat || "?"} off`;

  const submit = () => {
    if (!ready || busy) return;
    save((token) =>
      kitchenApi.saveCoupon(token, coupon?.id ?? null, {
        code, title: title.trim(), kind,
        percentOff: kind === "percent" ? pct : null,
        flatOff: kind === "flat" ? flat : null,
        maxDiscount: kind === "percent" && maxDiscount ? Number(maxDiscount) : null,
        minOrder: Number(minOrder) || 0,
        perMemberLimit: uses,
        // Sent only when on or changed, so a server before the 2027-01-28 migration still saves other coupons
        ...(firstOrderOnly || coupon?.firstOrderOnly ? { firstOrderOnly } : {}),
        startsOn, endsOn, active,
      }),
    );
  };
  const remove = async () => {
    if (!coupon || deleting) return;
    if (!(await confirmChoice({ title: `Delete ${coupon.code}?`, message: "Members can't use it any more. Orders that used it keep their discount.", confirmLabel: "Delete coupon", destructive: true }))) return;
    setDeleting(true);
    const answer = await kitchenApi.remove(await getToken(), "coupons", coupon.id);
    setDeleting(false);
    if (!answer.ok) return hud.error(answer.error);
    hud.success("Coupon deleted");
    back();
  };

  // Offer notices (marketing phase 4): one in-app notification per member, never twice for a coupon
  const announce = async () => {
    if (!coupon || announcing) return;
    const who = coupon.firstOrderOnly ? "every member who hasn't ordered yet" : "every member";
    if (!(await confirmChoice({ title: `Tell members about ${coupon.code}?`, message: `Sends ${who} a notification about this offer. Members already told aren't told again.`, confirmLabel: "Send notice" }))) return;
    setAnnouncing(true);
    const answer = await kitchenApi.announceCoupon(await getToken(), coupon.id);
    setAnnouncing(false);
    if (!answer.ok) return hud.error(answer.error);
    hud.success(answer.data.sent === 0 ? "Everyone was already told" : `Told ${answer.data.sent} members`);
  };

  return (
    <View style={{ gap: 16 }}>
      <View className="shop-coupon">
        <View className="min-w-0 flex-1">
          <Text className="card__title">{preview}</Text>
          <Text className="meta-text">{[`Code ${code || "…"}`, Number(minOrder) > 0 ? `Above ₹${minOrder}` : null].filter(Boolean).join(" | ")}</Text>
        </View>
      </View>
      <AdminField label="Code" value={code} onChangeText={(t) => setCode(t.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={16} placeholder="SAVE100" hint="3 to 16 letters and digits. Members type it in the cart." />
      <AdminField label="Title" value={title} onChangeText={setTitle} maxLength={60} placeholder="For example: 50% off your first order" />
      <ChoiceChips label="Discount" options={[{ value: "percent", label: "% off" }, { value: "flat", label: "₹ off" }]} value={kind} onChange={setKind} />
      {kind === "percent" ? (
        <View className="flex-row" style={{ gap: 10 }}>
          <View className="flex-1"><AdminField label="% off (1–90)" value={percentOff} onChangeText={(t) => setPercentOff(digits(t))} keyboardType="number-pad" maxLength={2} placeholder="50" /></View>
          <View className="flex-1"><AdminField label="Up to ₹ (optional)" value={maxDiscount} onChangeText={(t) => setMaxDiscount(digits(t))} keyboardType="number-pad" maxLength={4} placeholder="100" /></View>
        </View>
      ) : (
        <AdminField label="₹ off" value={flatOff} onChangeText={(t) => setFlatOff(digits(t))} keyboardType="number-pad" maxLength={4} placeholder="50" />
      )}
      <View className="flex-row" style={{ gap: 10 }}>
        <View className="flex-1"><AdminField label="Minimum order ₹" value={minOrder} onChangeText={(t) => setMinOrder(digits(t))} keyboardType="number-pad" maxLength={5} placeholder="149" /></View>
        <View className="flex-1"><AdminField label="Uses per member" value={perMemberLimit} onChangeText={(t) => setPerMemberLimit(digits(t))} keyboardType="number-pad" maxLength={2} placeholder="1" /></View>
      </View>
      <DateField label="Works from" value={startsOn} onChange={setStartsOn} emptyText="Now" min={isoToday(-365)} max={isoToday(365)} />
      <DateField label="Works until" value={endsOn} onChange={setEndsOn} emptyText="No end" min={startsOn ?? isoToday(-365)} max={isoToday(730)} />
      {daysWrong ? <Text className="admin__hint" style={{ color: colors.danger }}>The end day must be on or after the start day.</Text> : null}
      <OnOffRow title="First order only" line={firstOrderOnly ? "Offered only to members who have never ordered: a welcome offer." : "Any member can use it."} value={firstOrderOnly} onChange={setFirstOrderOnly} />
      <OnOffRow title="Members can use it" line={active ? "Offered on the Meals tab on its days." : "Off: no one can use it."} value={active} onChange={setActive} />
      {error ? <FormAlert message={error} /> : null}
      <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button">
        {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
        <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{coupon ? "Save changes" : "Add coupon"}</Text>
      </Pressable>
      {coupon?.state === "live" && (
        <Pressable onPress={announce} disabled={announcing} className="admin-chip self-center" style={{ paddingHorizontal: 20 }} accessibilityRole="button">
          <Text className="admin-segment__label">{announcing ? "Sending…" : "Tell members about this offer"}</Text>
        </Pressable>
      )}
      {coupon && (
        <Pressable onPress={remove} disabled={deleting} className="admin-chip self-center" style={{ paddingHorizontal: 20 }} accessibilityRole="button">
          <Text className="admin-segment__label" style={{ color: colors.danger }}>{deleting ? "Deleting…" : "Delete coupon"}</Text>
        </Pressable>
      )}
    </View>
  );
}
