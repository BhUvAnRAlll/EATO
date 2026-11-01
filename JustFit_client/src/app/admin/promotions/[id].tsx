import { useEffect, useState } from "react";
import { ActivityIndicator, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { AdminButton, AdminScreen } from "@/components/admin/AdminScreen";
import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { PromotionSlide } from "@/components/home/PromotionSlide";
import { homeImageKeys } from "@/constants/images";
import { destinations, type PromotionFields, type PromotionStatus } from "@/data/home";
import { formatLocalDateTime, parseLocalDateTime } from "@/lib/date";
import { adminHome, resolveImage } from "@/lib/home";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const emptyPromotion: PromotionFields = {
  title: "",
  eyebrow: "",
  headline: "",
  description: "",
  imageUrl: "asset:hero-bowl",
  imageAlt: null,
  ctaLabel: "Order Now",
  ctaAction: "open_screen",
  ctaDestination: "explore",
  secondaryCtaLabel: null,
  secondaryCtaAction: null,
  secondaryCtaDestination: null,
  textAlign: "left",
  imagePosition: "right",
  backgroundColor: null,
  textColor: null,
  status: "draft",
  rotationIntervalSeconds: 2,
  startsAt: null,
  endsAt: null,
};

const destinationOptions = destinations.map((destination) => ({ value: destination, label: destination }));
const imageOptions = homeImageKeys.map((key) => ({ value: `asset:${key}`, label: key }));
const NONE = "none";

// Create ("new") or edit one promotion. Everything is re-checked by the server; this
// form only keeps obvious mistakes from being sent. The preview is the real slide.
export default function EditPromotion() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const promotionId = Number(id);
  const invalidId = !isNew && (!Number.isInteger(promotionId) || promotionId < 1);
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();

  const [fields, setFields] = useState<PromotionFields | null>(isNew ? emptyPromotion : null);
  // Text as typed for the fields that aren't plain strings
  const [imageUrlText, setImageUrlText] = useState("");
  const [rotationText, setRotationText] = useState("2");
  const [startsText, setStartsText] = useState("");
  const [endsText, setEndsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || invalidId) return;
    let cancelled = false;
    (async () => {
      const result = await adminHome.getPromotion(await getToken(), promotionId);
      if (cancelled) return;
      if (!result.ok) return setError(result.error);
      const { promotion } = result.data;
      setFields(promotion);
      setImageUrlText(promotion.imageUrl.startsWith("asset:") ? "" : promotion.imageUrl);
      setRotationText(String(promotion.rotationIntervalSeconds));
      setStartsText(formatLocalDateTime(promotion.startsAt));
      setEndsText(formatLocalDateTime(promotion.endsAt));
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, invalidId, promotionId, getToken]);

  const update = (changes: Partial<PromotionFields>) => setFields((current) => (current ? { ...current, ...changes } : current));

  // Turns the typed text into the fields the server expects, or explains what's wrong
  const prepare = (status: PromotionStatus): { ok: true; fields: PromotionFields } | { ok: false; error: string } => {
    if (!fields) return { ok: false, error: "Nothing to save yet." };
    const rotation = Number(rotationText);
    if (!Number.isInteger(rotation) || rotation < 1 || rotation > 30) return { ok: false, error: "Rotation must be a whole number of seconds between 1 and 30." };
    const starts = startsText.trim() === "" ? null : parseLocalDateTime(startsText);
    const ends = endsText.trim() === "" ? null : parseLocalDateTime(endsText);
    if (startsText.trim() !== "" && !starts) return { ok: false, error: "Start date must look like 2026-10-20 09:00." };
    if (endsText.trim() !== "" && !ends) return { ok: false, error: "End date must look like 2026-10-27 18:00." };
    if (starts && ends && ends <= starts) return { ok: false, error: "The end date must be after the start date." };
    const imageUrl = imageUrlText.trim() !== "" ? imageUrlText.trim() : fields.imageUrl;
    const hasSecondary = (fields.secondaryCtaLabel ?? "").trim() !== "";
    return {
      ok: true,
      fields: {
        ...fields,
        imageUrl,
        imageAlt: fields.imageAlt?.trim() || null,
        secondaryCtaLabel: hasSecondary ? fields.secondaryCtaLabel : null,
        secondaryCtaAction: hasSecondary ? "open_screen" : null,
        secondaryCtaDestination: hasSecondary ? fields.secondaryCtaDestination : null,
        backgroundColor: fields.backgroundColor?.trim() || null,
        textColor: fields.textColor?.trim() || null,
        status,
        rotationIntervalSeconds: rotation,
        startsAt: starts ? starts.toISOString() : null,
        endsAt: ends ? ends.toISOString() : null,
      },
    };
  };

  const save = async (status: PromotionStatus) => {
    const prepared = prepare(status);
    if (!prepared.ok) return setError(prepared.error);
    setSaving(true);
    setError(null);
    const token = await getToken();
    const result = isNew
      ? await adminHome.createPromotion(token, prepared.fields)
      : await adminHome.updatePromotion(token, promotionId, prepared.fields);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    router.back();
  };

  const previewWidth = width - 32;
  // What the preview shows: the typed URL wins over the picked bundled image
  const preview = fields ? { ...fields, imageUrl: imageUrlText.trim() || fields.imageUrl } : null;

  return (
    <AdminScreen title={isNew ? "New promotion" : "Edit promotion"}>
      {invalidId ? (
        <FormAlert message="That promotion id isn't valid." />
      ) : !fields ? (
        error ? <FormAlert message={error} /> : <ActivityIndicator color={colors.leaf} className="mt-6" />
      ) : (
        <View className="gap-5">
          {preview && (
            <View>
              <Text className="setup__section mb-2">Preview</Text>
              <View className="admin__preview">
                <PromotionSlide promotion={preview} width={previewWidth} height={Math.round(previewWidth * 0.6)} />
              </View>
            </View>
          )}

          <Text className="setup__section">Content</Text>
          <AdminField label="Title (admin only)" value={fields.title} onChangeText={(title) => update({ title })} placeholder="Chef-prepared meals" maxLength={80} />
          <AdminField label="Eyebrow" value={fields.eyebrow} onChangeText={(eyebrow) => update({ eyebrow })} placeholder="CHEF-PREPARED" maxLength={40} autoCapitalize="characters" />
          <AdminField label="Headline" value={fields.headline} onChangeText={(headline) => update({ headline })} placeholder="Healthy meals for a stronger you" maxLength={80} hint="The last word is shown in green." />
          <AdminField label="Description" value={fields.description} onChangeText={(description) => update({ description })} placeholder="Nutritious, chef-prepared meals delivered to your doorstep." maxLength={160} multiline />

          <Text className="setup__section">Image</Text>
          <View className="flex-row items-center gap-3">
            <Image source={resolveImage(preview?.imageUrl)} contentFit="cover" contentPosition={fields.imagePosition === "left" ? "left" : "right"} style={{ width: 64, height: 64, borderRadius: 12 }} />
            <Text className="admin__hint flex-1">Pick a bundled image, or paste an https image URL below (it replaces the pick).</Text>
          </View>
          <ChoiceChips label="Bundled image" options={imageOptions} value={fields.imageUrl.startsWith("asset:") ? fields.imageUrl : ""} onChange={(imageUrl) => { update({ imageUrl }); setImageUrlText(""); }} />
          <AdminField label="Image URL (optional)" value={imageUrlText} onChangeText={setImageUrlText} placeholder="https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <AdminField label="Image description (accessibility)" value={fields.imageAlt ?? ""} onChangeText={(imageAlt) => update({ imageAlt })} placeholder="Grilled chicken bowl with vegetables" maxLength={160} />

          <Text className="setup__section">Button</Text>
          <AdminField label="Button label" value={fields.ctaLabel} onChangeText={(ctaLabel) => update({ ctaLabel })} placeholder="Order Now" maxLength={30} />
          <ChoiceChips label="Opens" options={destinationOptions} value={fields.ctaDestination} onChange={(ctaDestination) => update({ ctaDestination })} />
          <AdminField label="Secondary button label (optional)" value={fields.secondaryCtaLabel ?? ""} onChangeText={(secondaryCtaLabel) => update({ secondaryCtaLabel })} placeholder="Learn more" maxLength={30} />
          <ChoiceChips
            label="Secondary button opens"
            options={[{ value: NONE, label: "none" }, ...destinationOptions]}
            value={fields.secondaryCtaDestination ?? NONE}
            onChange={(value) => update({ secondaryCtaDestination: value === NONE ? null : value })}
          />

          <Text className="setup__section">Layout</Text>
          <ChoiceChips label="Text alignment" options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }]} value={fields.textAlign} onChange={(textAlign) => update({ textAlign })} />
          <ChoiceChips label="Image position" options={[{ value: "right", label: "Right" }, { value: "left", label: "Left" }]} value={fields.imagePosition} onChange={(imagePosition) => update({ imagePosition })} />
          <AdminField label="Background colour (optional)" value={fields.backgroundColor ?? ""} onChangeText={(backgroundColor) => update({ backgroundColor })} placeholder="#FDFAF4" maxLength={7} autoCapitalize="characters" hint="Hex colour. Leave empty for the page colour. Keep text readable." />
          <AdminField label="Text colour (optional)" value={fields.textColor ?? ""} onChangeText={(textColor) => update({ textColor })} placeholder="#0B0B0F" maxLength={7} autoCapitalize="characters" />

          <Text className="setup__section">Schedule and rotation</Text>
          <AdminField label="Seconds before the next slide" value={rotationText} onChangeText={setRotationText} keyboardType="number-pad" maxLength={2} hint="1 to 30 seconds; 2 is the default." />
          <AdminField label="Show from (optional)" value={startsText} onChangeText={setStartsText} placeholder="2026-10-20 09:00" autoCapitalize="none" hint="Local time, YYYY-MM-DD HH:mm." />
          <AdminField label="Show until (optional)" value={endsText} onChangeText={setEndsText} placeholder="2026-10-27 18:00" autoCapitalize="none" />

          {error && <FormAlert message={error} />}

          <View className="flex-row flex-wrap gap-2">
            <AdminButton label={isNew ? "Save draft" : fields.status === "published" ? "Save (stays published)" : "Save draft"} onPress={() => save(isNew ? "draft" : fields.status)} disabled={saving} />
            <AdminButton label={fields.status === "published" && !isNew ? "Save & republish" : "Publish"} variant="primary" onPress={() => save("published")} disabled={saving} />
            {!isNew && fields.status !== "disabled" && <AdminButton label="Save & disable" variant="danger" onPress={() => save("disabled")} disabled={saving} />}
          </View>
          {saving && <ActivityIndicator color={colors.leaf} />}
        </View>
      )}
    </AdminScreen>
  );
}
