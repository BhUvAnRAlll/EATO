import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { CATALOG_KINDS, planLabel, rupees } from "@/data/gymDashboard";
import { gymApi, type CatalogItem, type CatalogKind } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { pickCatalogImage, type MemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import { DETAILS_MAX } from "@/lib/gymProfile";
import { notice } from "@/lib/gymPortal";
import { useThemeColors } from "@/theme";

const TITLE: Record<CatalogKind, string> = { plan: "Plan", pt: "PT Package", service: "Service", product: "Product" };

// Plans / Catalogue › Add Plan (the user's design): a bottom sheet with the name, for a plan or a
// PT package its Duration in whole months (1-24; the Days option went on 2026-11-07, and an item
// saved in days before that opens with the Duration empty, to be set in months), the amount, for a product how many
// are in stock (optional: left empty, stock isn't counted), and an optional image or brochure photo
// (camera or gallery, any shape; 2026-11-07). Editing an item opens the same sheet with Delete.
// Saving first asks to confirm the details (Edit or Confirm), then calls back with the branch's
// updated list. Plans and PT packages also say what's included (Gym Hub, 2026-11-09: members see
// it when they compare a gym's plans; optional, 300 characters). The image is uploaded once the item is saved (PUT /api/gym/catalog/:id/image); if
// only the image fails, the item stays saved and the gym admin is told.
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
      };
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
