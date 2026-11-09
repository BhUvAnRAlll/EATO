import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { DateField, OnOffRow, PhotoBox, isoToday, photoPayload, type PhotoChoice } from "@/components/admin/AdminPickers";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { hud } from "@/lib/hud";
import { TAG_LIST_TITLE, type Tag } from "@/lib/mealRules";
import { kitchenApi, type AdminBanner, type AdminCategory, type AdminMeal, type BannerTarget } from "@/lib/mealsApi";
import { confirmChoice } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals/banners"));

// Super Admin › Meals › Banners › New or a banner: the wide photo, heading, short text, badge, the
// button's words and where it goes (a category, a meal or a tag's list), the days it shows (empty =
// from now / no end), on or off, and its order.
export default function AdminBannerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const load = useCallback(async (token: string | null) => {
    const [banners, cats, meals] = await Promise.all([kitchenApi.banners(token), kitchenApi.categories(token), kitchenApi.meals(token)]);
    for (const a of [banners, cats, meals]) if (!a.ok) return a as { ok: false; error: string; status?: number };
    if (!banners.ok || !cats.ok || !meals.ok) return { ok: false as const, error: "Could not load." };
    const banner = isNew ? null : banners.data.banners.find((b) => String(b.id) === id) ?? undefined;
    if (banner === undefined) return { ok: false as const, error: "That banner was deleted.", status: 404 };
    return { ok: true as const, data: { banner, categories: cats.data.categories, meals: meals.data.meals } };
  }, [id, isNew]);
  const { result, retry } = useGymData(load);
  return (
    <AdminScreen title={isNew ? "New banner" : "Edit banner"}>
      {result.state === "loading" && <ScreenSkeleton label="Loading" />}
      {result.state === "failed" && <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />}
      {result.state === "ready" && <BannerForm {...result.data} />}
    </AdminScreen>
  );
}

function BannerForm({ banner, categories, meals }: { banner: AdminBanner | null; categories: AdminCategory[]; meals: AdminMeal[] }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [title, setTitle] = useState(banner?.title ?? "");
  const [description, setDescription] = useState(banner?.description ?? "");
  const [badge, setBadge] = useState(banner?.badge ?? "");
  const [ctaLabel, setCtaLabel] = useState(banner?.ctaLabel ?? "Explore now");
  const [target, setTarget] = useState<BannerTarget>(banner?.target ?? { kind: "tag", ref: "special" });
  const [startsOn, setStartsOn] = useState<string | null>(banner?.startsOn ?? null);
  const [endsOn, setEndsOn] = useState<string | null>(banner?.endsOn ?? null);
  const [active, setActive] = useState(banner?.active ?? true);
  const [sortOrder, setSortOrder] = useState(String(banner?.sortOrder ?? 0));
  const [photo, setPhoto] = useState<PhotoChoice>({ picked: null, removed: false });
  const [deleting, setDeleting] = useState(false);
  const { busy, error, save } = useGymSave(() => back(), banner ? "Banner saved" : "Banner added");

  const daysWrong = !!startsOn && !!endsOn && endsOn < startsOn;
  const targetOk = target.kind === "category" ? categories.some((c) => String(c.id) === target.ref) : target.kind === "meal" ? meals.some((m) => m.id === target.ref) : target.ref in TAG_LIST_TITLE;
  const ready = title.trim().length >= 3 && targetOk && !daysWrong;
  const submit = () => {
    if (!ready || busy) return;
    save((token) =>
      kitchenApi.saveBanner(token, banner?.id ?? null, {
        title: title.trim(), description: description.trim(), badge: badge.trim(), ctaLabel: ctaLabel.trim() || "Explore now", target, startsOn, endsOn, active,
        sortOrder: Math.min(999, Number(sortOrder) || 0), ...photoPayload(photo, !!banner?.imageUrl),
      }),
    );
  };
  const remove = async () => {
    if (!banner || deleting) return;
    if (!(await confirmChoice({ title: `Delete ${banner.title}?`, message: "It leaves the carousel now.", confirmLabel: "Delete banner", destructive: true }))) return;
    setDeleting(true);
    const answer = await kitchenApi.remove(await getToken(), "banners", banner.id);
    setDeleting(false);
    if (!answer.ok) return hud.error(answer.error);
    hud.success("Banner deleted");
    back();
  };

  const choice = (on: boolean, label: string, onPress: () => void, key: string) => (
    <Pressable key={key} onPress={onPress} className={on ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: on }}>
      <Text className={on ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 16 }}>
      <PhotoBox label="Banner photo" hint="Wide, at least 600 × 300; the words sit on its lower part" aspect={16 / 9} currentUrl={banner?.imageUrl ?? null} choice={photo} onChange={setPhoto} />
      <AdminField label="Heading" value={title} onChangeText={setTitle} maxLength={60} placeholder="For example: Specials of the Week" />
      <AdminField label="Short text (optional)" value={description} onChangeText={setDescription} maxLength={140} multiline placeholder="For example: High-protein Indian meals, cooked fresh every day" />
      <AdminField label="Badge (optional)" value={badge} onChangeText={setBadge} maxLength={20} placeholder="For example: Limited time" />
      <AdminField label="Button" value={ctaLabel} onChangeText={setCtaLabel} maxLength={20} placeholder="Explore now" />
      <ChoiceChips
        label="The button opens"
        options={[{ value: "tag", label: "A tag's list" }, { value: "category", label: "A category" }, { value: "meal", label: "A meal" }]}
        value={target.kind}
        onChange={(kind) => setTarget({ kind, ref: kind === "tag" ? "special" : kind === "category" ? String(categories[0]?.id ?? "") : meals[0]?.id ?? "" })}
      />
      <View className="flex-row flex-wrap gap-2">
        {target.kind === "tag" && (Object.keys(TAG_LIST_TITLE) as Tag[]).map((t) => choice(target.ref === t, TAG_LIST_TITLE[t], () => setTarget({ kind: "tag", ref: t }), t))}
        {target.kind === "category" && (categories.length ? categories.map((c) => choice(target.ref === String(c.id), c.name, () => setTarget({ kind: "category", ref: String(c.id) }), String(c.id))) : <Text className="meta-text">Add a category first.</Text>)}
        {target.kind === "meal" && (meals.length ? meals.map((m) => choice(target.ref === m.id, m.name, () => setTarget({ kind: "meal", ref: m.id }), m.id)) : <Text className="meta-text">Add a meal first.</Text>)}
      </View>
      <DateField label="Shows from" value={startsOn} onChange={setStartsOn} emptyText="Now" min={isoToday(-365)} max={isoToday(365)} />
      <DateField label="Shows until" value={endsOn} onChange={setEndsOn} emptyText="No end" min={startsOn ?? isoToday(-365)} max={isoToday(730)} />
      {daysWrong ? <Text className="admin__hint" style={{ color: colors.danger }}>The end day must be on or after the start day.</Text> : null}
      <OnOffRow title="Members see it" line={active ? "In the carousel on its days." : "Off: hidden from members."} value={active} onChange={setActive} />
      <AdminField label="Order (lower comes first)" value={sortOrder} onChangeText={(t) => setSortOrder(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" maxLength={3} placeholder="0" />
      {error ? <FormAlert message={error} /> : null}
      <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button">
        {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
        <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{banner ? "Save changes" : "Add banner"}</Text>
      </Pressable>
      {banner && (
        <Pressable onPress={remove} disabled={deleting} className="admin-chip flex-row self-center" style={{ paddingHorizontal: 20, gap: 6 }} accessibilityRole="button">
          <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={14} tintColor={colors.danger} />
          <Text className="admin-segment__label" style={{ color: colors.danger }}>{deleting ? "Deleting…" : "Delete banner"}</Text>
        </Pressable>
      )}
    </View>
  );
}
