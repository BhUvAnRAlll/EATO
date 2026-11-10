import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { BENEFIT_MAX, BENEFITS_MAX, CATALOG_KINDS, CATALOG_STATUS, PLAN_PRESETS, planLabel, rupees } from "@/data/gymDashboard";
import { gymApi, type CatalogFields, type CatalogItem, type CatalogKind, type CatalogStatus } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { pickCatalogImage, type MemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import { DETAILS_MAX } from "@/lib/gymProfile";
import { notice } from "@/lib/gymPortal";
import { useSwitchColors, useThemeColors } from "@/theme";

// The server's limits for a plan's eligibility and terms (gym/rules.js)
const ELIGIBILITY_MAX = 120;
const TERMS_MAX = 600;

const TITLE: Record<CatalogKind, string> = { plan: "Plan", pt: "PT Package", service: "Service", product: "Product" };

// Plans / Catalogue › Add Plan (the user's design): a bottom sheet with the name, for a plan or a
// PT package its Duration in whole months (1-24; the Days option went on 2026-11-07, and an item
// saved in days before that opens with the Duration empty, to be set in months), the amount, for a product how many
// are in stock (optional: left empty, stock isn't counted), and an optional image or brochure photo
// (camera or gallery, any shape; 2026-11-07). Editing an item opens the same sheet with Delete.
// Saving first asks to confirm the details (Edit or Confirm), then calls back with the branch's
// updated list. Plans and PT packages also say what's included (Gym Hub, 2026-11-09: members see
// it when they compare a gym's plans; optional, 300 characters). The image is uploaded once the item is saved (PUT /api/gym/catalog/:id/image); if
// only the image fails, the item stays saved and the gym admin is told. Gym Profile phase 2
// (2026-11-09): quick lengths (Monthly, Quarterly, Half-yearly, Annual, or any 1-24 months),
// benefits as a list members see ticked, the gym's own Best value plan (one a branch), and on an
// edit the status: Active, Inactive (hidden for now) or Archived.
export function CatalogSheet({ kind, item, onClose, onSaved }: { kind: CatalogKind; item: CatalogItem | null; onClose: () => void; onSaved: (items: CatalogItem[]) => void }) {
  const colors = useThemeColors();
  const meta = CATALOG_KINDS.find((k) => k.id === kind)!;
  // Plans and PT packages have a length; products a stock count
  const isPlan = kind === "plan" || kind === "pt";
  const isProduct = kind === "product";
  const [name, setName] = useState(item?.name ?? "");
  const [duration, setDuration] = useState(item?.duration && item.unit === "months" ? String(item.duration) : "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [stock, setStock] = useState(item?.stock !== null && item?.stock !== undefined ? String(item.stock) : "");
  const [details, setDetails] = useState(item?.details ?? "");
  const [benefits, setBenefits] = useState<string[]>(item?.benefits ?? []);
  const [eligibility, setEligibility] = useState(item?.eligibility ?? "");
  const [terms, setTerms] = useState(item?.terms ?? "");
  const [benefit, setBenefit] = useState("");
  const [bestValue, setBestValue] = useState(item?.bestValue ?? false);
  const [status, setStatus] = useState<CatalogStatus>(item?.status ?? "active");
  const switchColors = useSwitchColors();
  // null: the image as it is; "remove": take the saved one off; a MemberPhoto: a new one to upload
  const [image, setImage] = useState<MemberPhoto | "remove" | null>(null);
  const [imageError, setImageError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, save } = useGymSave((data: { items: CatalogItem[] }) => onSaved(data.items));

  const length = durationValue(duration);
  const amount = rupeesFromText(price);
  const stockValue = stock === "" ? null : Number(stock);
  const ready = name.trim().length >= 2 && amount >= 1 && (!isPlan || length !== null) && (stockValue === null || stockValue <= 100000);
  const benefitText = benefit.trim().replace(/\s+/g, " ");
  const benefitProblem = benefitText.length === 0 ? null : benefitText.length < 2 ? "At least 2 characters." : benefits.some((b) => b.toLowerCase() === benefitText.toLowerCase()) ? "Already listed." : null;
  const addBenefit = () => {
    if (!benefitText || benefitProblem || benefits.length >= BENEFITS_MAX) return;
    setBenefits((list) => [...list, benefitText]);
    setBenefit("");
  };
  const title = `${item ? "Edit" : "Add"} ${TITLE[kind]}`;
  const hasImage = image === "remove" ? false : image !== null || (item?.imageUrl ?? null) !== null;

  const chooseImage = async (source: PhotoSource) => {
    setImageError("");
    const picked = await pickCatalogImage(source).catch(() => ({ ok: false as const, error: "That photo couldn't be read. Please try another." }));
    if (picked.ok) setImage(picked.photo);
    else if ("error" in picked) setImageError(picked.error);
  };

  const submit = () => {
    setConfirming(false);
    save(async (token) => {
      const fields = {
        name: name.trim(),
        price: amount,
        ...(isPlan && length !== null ? { duration: length } : {}),
        // Cleared on an edit: no longer counted
        ...(isProduct && (stockValue !== null || item) ? { stock: stockValue ?? ("" as const) } : {}),
        // Sent only when it changed, so the catalogue keeps saving before its migration
        ...(isPlan && details.trim() !== (item?.details ?? "") ? { details: details.trim() } : {}),
        // Gym Profile phase 2: only what changed, so the catalogue keeps saving before its migration
        ...(isPlan && benefits.join("\n") !== (item?.benefits ?? []).join("\n") ? { benefits } : {}),
        // Who may buy it and its rules (G17): only when changed, so saving works before the migration
        ...(isPlan && eligibility.trim() !== (item?.eligibility ?? "") ? { eligibility: eligibility.trim() } : {}),
        ...(isPlan && terms.trim() !== (item?.terms ?? "") ? { terms: terms.trim() } : {}),
        ...(kind === "plan" && bestValue !== (item?.bestValue ?? false) ? { bestValue: bestValue && status === "active" } : {}),
        ...(item && status !== (item.status ?? "active") ? { status } : {}),
      } satisfies CatalogFields;
      const saved = item ? await gymApi.editItem(token, item.id, fields) : await gymApi.addItem(token, { kind, ...fields });
      if (!saved.ok || image === null) return saved;
      // The item just saved: the one edited, or the newest with this name
      const savedId = item?.id ?? saved.data.items.filter((i) => i.kind === kind && i.name === fields.name).sort((a, b) => b.id - a.id)[0]?.id;
      if (savedId === undefined) return saved;
      const withImage = image === "remove" ? await gymApi.removeItemImage(token, savedId) : await gymApi.setItemImage(token, savedId, image);
      if (withImage.ok) return withImage;
      notice(`${TITLE[kind]} saved`, `${fields.name} was saved, but the image couldn't be ${image === "remove" ? "removed" : "saved"}: ${withImage.error}`);
      return saved;
    });
  };
  const rows: [string, string][] = [
    ["Name", name.trim()],
    ...(isPlan && length !== null ? [["Duration", planLabel(length)] as [string, string]] : []),
    ["Amount", rupees(amount)],
    ...(isPlan && details.trim() ? [["Included", details.trim()] as [string, string]] : []),
    ...(isPlan && benefits.length ? [["Benefits", benefits.join(", ")] as [string, string]] : []),
    ...(isPlan && eligibility.trim() ? [["Who can join", eligibility.trim()] as [string, string]] : []),
    ...(isPlan && terms.trim() ? [["Terms", terms.trim()] as [string, string]] : []),
    ...(kind === "plan" && bestValue && status === "active" ? [["Best value", "Yes"] as [string, string]] : []),
    ...(item && status !== (item.status ?? "active") ? [["Status", CATALOG_STATUS.find((c) => c.id === status)!.label] as [string, string]] : []),
    ...(isProduct ? [["Stock", stockValue === null ? "Not counted" : `${stockValue} in stock`] as [string, string]] : []),
    ...(image !== null || item?.imageUrl ? [["Image", image === "remove" ? "Removed" : image ? "Added" : "Kept"] as [string, string]] : []),
  ];

  return (
    <GymSheet
      title={title}
      subtitle={`${item ? "Change" : "Add"} a ${meta.noun} for the outlet.`}
      onClose={onClose}
      overlay={confirming ? <ConfirmDialog rows={rows} onEdit={() => setConfirming(false)} onConfirm={submit} /> : null}
      onDismissOverlay={() => setConfirming(false)}
    >
      <GymField label={`${TITLE[kind]} name`} icon="pencil-line" value={name} onChangeText={setName} maxLength={80} placeholder={`${TITLE[kind]} Name (Eg. ${kind === "plan" ? "6 Months" : meta.example})`} />
      {isPlan && (
        <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Quick lengths">
          {PLAN_PRESETS.map((p) => {
            const on = length === p.months;
            return (
              <PressableScale key={p.months} onPress={() => setDuration(String(p.months))} haptic="select" className={on ? "gym-choice gym-choice--selected" : "gym-choice"} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${p.label}, ${planLabel(p.months)}`}>
                <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{p.label}</Text>
              </PressableScale>
            );
          })}
        </View>
      )}
      {isPlan && <PlanLengthFields duration={duration} onDuration={setDuration} />}
      <GymField label={`${TITLE[kind]} amount`} icon="banknote" value={price} onChangeText={(t) => setPrice(amountInput(t))} keyboardType="number-pad" placeholder={`${TITLE[kind]} Amount (Eg. 500)`} />
      {isPlan && (
        <GymField
          label="What's included (optional)"
          icon="clipboard-list"
            value={details}
          onChangeText={(t) => setDetails(t.slice(0, DETAILS_MAX))}
          maxLength={DETAILS_MAX}
          placeholder="Eg. Steam bath, 1 diet consult. Morning batch only."
          multiline
          style={{ minHeight: 72, textAlignVertical: "top" }}
          hint="Benefits and any limits. Members see this when they compare plans."
        />
      )}
      {isPlan && (
        <View style={{ gap: 8 }}>
          <Text className="gym-field__label">{`Benefits (${benefits.length} of ${BENEFITS_MAX})`}</Text>
          {benefits.map((b, i) => (
            <View key={b} className="flex-row items-center" style={{ gap: 8 }}>
              <GymIcon name="check" size={14} color={colors.gymSuccess} />
              <Text className="gym-tx__meta min-w-0 flex-1" style={{ color: colors.gymInk }}>{b}</Text>
              <PressableScale onPress={() => setBenefits((list) => list.filter((_, k) => k !== i))} className="gym-icon-btn" hitSlop={4} accessibilityRole="button" accessibilityLabel={`Remove the benefit ${b}`}>
                <GymIcon name="x" size={14} color={colors.gymDanger} />
              </PressableScale>
            </View>
          ))}
          {benefits.length < BENEFITS_MAX && (
            <>
              <GymField
                label="Add a benefit"
                icon="square-plus"
                value={benefit}
                onChangeText={(t) => setBenefit(t.slice(0, BENEFIT_MAX))}
                maxLength={BENEFIT_MAX}
                placeholder="Eg. Steam bath, Locker, 1 diet consult"
                returnKeyType="done"
                onSubmitEditing={addBenefit}
                hint={benefitProblem ?? "Members see each one with a tick."}
              />
              <PressableScale onPress={addBenefit} disabled={!benefitText || Boolean(benefitProblem)} className="gym-choice flex-row items-center self-start" style={{ gap: 6, opacity: !benefitText || benefitProblem ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="Add this benefit">
                <GymIcon name="plus" size={16} color={colors.gymPrimary} />
                <Text className="gym-choice__label">Add benefit</Text>
              </PressableScale>
            </>
          )}
        </View>
      )}
      {isPlan && (
        <GymField
          label="Who can join (optional)"
          icon="user-check"
          value={eligibility}
          onChangeText={(t) => setEligibility(t.slice(0, ELIGIBILITY_MAX))}
          maxLength={ELIGIBILITY_MAX}
          placeholder="Eg. Women only, Students with a college ID"
          hint="One line members read before they ask about it."
        />
      )}
      {isPlan && (
        <GymField
          label="Terms (optional)"
          icon="file-text"
          value={terms}
          onChangeText={(t) => setTerms(t.slice(0, TERMS_MAX))}
          maxLength={TERMS_MAX}
          placeholder="Eg. Weekdays 10 am to 4 pm. One freeze a year. No refunds."
          multiline
          style={{ minHeight: 72, textAlignVertical: "top" }}
          hint="Access hours, freezes, transfers, refunds. Members can open these on your page."
        />
      )}
      {kind === "plan" && (
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <View className="min-w-0 flex-1">
            <Text className="gym-field__label">Best value</Text>
            <Text className="gym-tx__meta">{status === "active" ? "Members see this plan marked Best value. Only one plan can be." : "Only an active plan can be the best value."}</Text>
          </View>
          <Switch
            value={bestValue && status === "active"}
            disabled={status !== "active"}
            onValueChange={setBestValue}
            {...switchColors}
            trackColor={{ false: switchColors.trackColor.false, true: colors.gymPrimary }}
            accessibilityLabel="Mark as the best value plan"
          />
        </View>
      )}
      {item && (
        <View style={{ gap: 8 }}>
          <Text className="gym-field__label">Status</Text>
          <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Status">
            {CATALOG_STATUS.map((c) => {
              const on = status === c.id;
              return (
                <PressableScale key={c.id} onPress={() => setStatus(c.id)} haptic="select" className={on ? "gym-choice gym-choice--selected" : "gym-choice"} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={c.label}>
                  <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{c.label}</Text>
                </PressableScale>
              );
            })}
          </View>
          <Text className="gym-tx__meta">{CATALOG_STATUS.find((c) => c.id === status)!.line}</Text>
        </View>
      )}
      {isProduct && (
        <GymField label="In stock" icon="boxes" value={stock} onChangeText={(t) => setStock(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="In Stock (Eg. 20, optional)" hint={stockValue !== null && stockValue > 100000 ? "Up to 1,00,000." : "Selling to a member takes them out of stock."} />
      )}
      <View style={{ gap: 8 }}>
        <Text className="gym-field__label">Image or brochure (optional)</Text>
        <View className="gym-item-image" accessible accessibilityLabel={hasImage ? "Item image, chosen" : "Item image, none yet"}>
          <GymIcon name="image" size={28} color={colors.gymMuted} />
          <Text className="gym-item-image__hint">A photo of the plan, a brochure or the product</Text>
          {image === "remove" ? null : image ? <MemberPhotoImage uri={image.previewUri} /> : <MemberPhotoImage url={item?.imageUrl} />}
        </View>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <PressableScale onPress={() => chooseImage("camera")} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={hasImage ? "Retake the photo" : "Take a photo"}>
            <GymIcon name="camera" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">{hasImage ? "Retake" : "Camera"}</Text>
          </PressableScale>
          <PressableScale onPress={() => chooseImage("library")} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Choose a photo from the gallery">
            <GymIcon name="image" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Gallery</Text>
          </PressableScale>
          {hasImage && (
            <PressableScale onPress={() => { setImage(item?.imageUrl ? "remove" : null); setImageError(""); }} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Remove the image">
              <GymIcon name="x" size={16} color={colors.gymPrimary} />
              <Text className="gym-choice__label">Remove</Text>
            </PressableScale>
          )}
        </View>
        {imageError ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{imageError}</Text> : null}
      </View>
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label={item ? "Save changes" : title} ready={ready} busy={busy} onPress={() => setConfirming(true)} />
      {item &&
        (confirmDelete ? (
          <PressableScale onPress={() => save((token) => gymApi.deleteItem(token, item.id))} disabled={busy} className="gym-btn gym-btn--outline" style={{ borderColor: colors.gymDanger }} accessibilityRole="button" accessibilityLabel={`Yes, delete ${item.name}`}>
            <Text className="gym-btn__label" style={{ color: colors.gymDanger }}>Yes, delete it</Text>
          </PressableScale>
        ) : (
          <PressableScale onPress={() => setConfirmDelete(true)} className="self-center" hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`}>
            <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{`Delete this ${meta.noun}`}</Text>
          </PressableScale>
        ))}
    </GymSheet>
  );
}
