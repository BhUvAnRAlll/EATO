import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { PressableScale } from "@/components/PressableScale";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { phoneInput } from "@/data/gymDashboard";
import { gymApi, type GymDashboard, type GymInfo, type InvoiceDetailFields, type InvoiceDetails } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { pickLogoImage, type PhotoSource } from "@/lib/gymPhoto";
import { useThemeColors } from "@/theme";
import { useGymData } from "@/lib/useGymData";

// Gym admin › Branch details: the open branch's name, area and city (shown on Home's header). The
// gym's own name is the justFit team's to change. They see every change on the branch's page and
// in their activity log. (The admin's own name was removed from here on 2026-11-07.) Under it,
// for the gym admin only, Invoice details (2026-11-07): the address, mobile number and GSTIN
// printed on every invoice, each optional, saved on their own, and (2026-11-08, the user's
// request) the gym's logo, printed at the top right of every invoice: picked from the camera or
// the gallery, shrunk on the phone and uploaded at once (PUT /api/gym/logo); Remove takes it off.
export default function GymDetails() {
  const { result, retry } = useGymData(gymApi.dashboard);
  return (
    <GymScreen title="Branch details">
      {result.state === "loading" && <GymLoading label="Loading your gym" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && result.data.gym.access === "owner" && <DetailsForm gym={result.data.gym} />}
      {result.state === "ready" && result.data.gym.access === "owner" && <InvoiceDetailsForm />}
      {result.state === "ready" && result.data.gym.access !== "owner" && <Text className="gym-tx__meta">Only the gym admin can change the branch details.</Text>}
    </GymScreen>
  );
}

// A GSTIN: 2 digits, the PAN (5 letters, 4 digits, 1 letter), the entity number, Z and a check character
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function InvoiceDetailsForm() {
  const { result, retry } = useGymData(gymApi.invoiceDetails);
  if (result.state === "loading") return <GymLoading label="Loading the invoice details" />;
  if (result.state === "failed") return <GymError error={result.error} onRetry={retry} />;
  return <InvoiceFields saved={result.data} />;
}

function InvoiceFields({ saved }: { saved: InvoiceDetails }) {
  const colors = useThemeColors();
  const [address, setAddress] = useState(saved.address ?? "");
  const [phone, setPhone] = useState(saved.phone ?? "");
  const [gstin, setGstin] = useState(saved.gstin ?? "");
  const [current, setCurrent] = useState(saved);
  const [done, setDone] = useState(false);
  const { busy, error, save } = useGymSave((data: InvoiceDetails) => {
    setCurrent(data);
    setDone(true);
  });
  // The logo saves on its own, as soon as it is picked. logoVersion changes the preview's URL so a
  // replaced logo isn't served from the image cache; the server ignores the query.
  const [logoVersion, setLogoVersion] = useState(0);
  const [logoNote, setLogoNote] = useState("");
  const [logoError, setLogoError] = useState("");
  const logoSave = useGymSave((data: InvoiceDetails) => {
    setCurrent(data);
    setLogoVersion((v) => v + 1);
    setLogoNote(data.logoUrl ? "Logo saved. It prints at the top right of every invoice." : "Logo removed.");
  });
  // A ref, so a double tap can't open two pickers (busy is only set once the upload starts)
  const picking = useRef(false);
  const chooseLogo = async (source: PhotoSource) => {
    if (logoSave.busy || picking.current) return;
    picking.current = true;
    setLogoError("");
    setLogoNote("");
    const picked = await pickLogoImage(source)
      .catch(() => ({ ok: false as const, error: "Couldn't open the camera or gallery. Please try again." }))
      .finally(() => {
        picking.current = false;
      });
    if (!picked.ok) {
      if (!("cancelled" in picked)) setLogoError(picked.error);
      return;
    }
    logoSave.save((token) => gymApi.setLogo(token, { data: picked.photo.data, mediaType: picked.photo.mediaType }));
  };
  const removeLogo = () => {
    if (logoSave.busy) return;
    setLogoError("");
    setLogoNote("");
    logoSave.save((token) => gymApi.removeLogo(token));
  };

  // Only what changed is sent; an emptied field clears it
  const cleanGstin = gstin.replace(/\s+/g, "").toUpperCase();
  const changes: InvoiceDetailFields = {};
  if (address.trim() !== (current.address ?? "")) changes.address = address.trim();
  if (phone.trim() !== (current.phone ?? "")) changes.phone = phone.trim();
  if (cleanGstin !== (current.gstin ?? "")) changes.gstin = cleanGstin;
  const phoneOk = phone.trim() === "" || /^[6-9]\d{9}$/.test(phone.trim());
  const gstinOk = cleanGstin === "" || GSTIN.test(cleanGstin);
  const ready = phoneOk && gstinOk && Object.keys(changes).length > 0;

  return (
    <>
      <Text className="gym-page-section" style={{ marginTop: 8 }}>Invoice details</Text>
      <Text className="gym-tx__meta">Printed on every invoice. Leave a field empty to keep it off the invoice.</Text>
      <GymField label="Address" icon="map-pin" pinLabel value={address} onChangeText={(t) => { setAddress(t); setDone(false); }} maxLength={160} placeholder="For example: 12, 1st Main Road, SS Puram" />
      <GymField label="Mobile number" icon="phone" pinLabel value={phone} onChangeText={(t) => { setPhone(phoneInput(t)); setDone(false); }} keyboardType="phone-pad" placeholder="10 digits" hint={phoneOk ? undefined : "Enter a 10-digit Indian mobile number."} />
      <GymField label="GSTIN" icon="receipt-text" pinLabel value={gstin} onChangeText={(t) => { setGstin(t); setDone(false); }} autoCapitalize="characters" maxLength={15} placeholder="For example: 29ABCDE1234F1Z5" hint={gstinOk ? undefined : "A GSTIN is 15 characters, like 29ABCDE1234F1Z5."} />
      {error ? <FormAlert message={error} /> : null}
      {done && !error ? <Text className="gym-tx__meta" style={{ textAlign: "center" }}>Saved. New invoices carry these details.</Text> : null}
      <SaveButton label="Save invoice details" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateInvoiceDetails(token, changes))} />

      <View style={{ gap: 8, marginTop: 8 }}>
        <Text className="gym-field__label">Logo (optional)</Text>
        <Text className="gym-tx__meta">Printed at the top right of every invoice, for every branch of your gym. {"Without one, the invoice shows your gym's initials."}</Text>
        <View className="gym-item-image" accessible accessibilityLabel={current.logoUrl ? "Gym logo, chosen" : "Gym logo, none yet"}>
          <GymIcon name="image" size={28} color={colors.gymMuted} />
          <Text className="gym-item-image__hint">{"Your gym's logo"}</Text>
          <MemberPhotoImage url={current.logoUrl ? `${current.logoUrl}?v=${logoVersion}` : null} fit="contain" />
        </View>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <PressableScale onPress={() => chooseLogo("camera")} disabled={logoSave.busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={current.logoUrl ? "Retake the logo" : "Take a photo of the logo"}>
            <GymIcon name="camera" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">{current.logoUrl ? "Retake" : "Camera"}</Text>
          </PressableScale>
          <PressableScale onPress={() => chooseLogo("library")} disabled={logoSave.busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Choose the logo from the gallery">
            <GymIcon name="image" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Gallery</Text>
          </PressableScale>
          {current.logoUrl && (
            <PressableScale onPress={removeLogo} disabled={logoSave.busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Remove the logo">
              <GymIcon name="x" size={16} color={colors.gymPrimary} />
              <Text className="gym-choice__label">Remove</Text>
            </PressableScale>
          )}
        </View>
        {logoSave.busy ? <Text className="gym-tx__meta">Saving the logo…</Text> : null}
        {logoError || logoSave.error ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{logoError || logoSave.error}</Text> : null}
        {logoNote && !logoSave.busy && !logoSave.error ? <Text className="gym-tx__meta">{logoNote}</Text> : null}
      </View>
    </>
  );
}

function DetailsForm({ gym }: { gym: GymDashboard["gym"] }) {
  const [branch, setBranch] = useState(gym.branch);
  const [area, setArea] = useState(gym.area);
  const [city, setCity] = useState(gym.city);
  // What the server holds now. Saving stays on this screen (a HUD line says so), so unsaved
  // invoice details below aren't lost and a screen opened from a link has nowhere to go back to
  const [current, setCurrent] = useState({ branch: gym.branch, area: gym.area, city: gym.city });
  const { busy, error, save } = useGymSave(
    (data: { gym: GymInfo }) => setCurrent({ branch: data.gym.branch, area: data.gym.area, city: data.gym.city }),
    "Branch details saved",
  );

  // Only what changed is sent
  const changes: { branch?: string; area?: string; city?: string } = {};
  if (branch.trim() !== current.branch) changes.branch = branch.trim();
  if (area.trim() !== current.area) changes.area = area.trim();
  if (city.trim() !== current.city) changes.city = city.trim();
  const valid = [branch, area, city].every((v) => v.trim().length >= 2);
  const ready = valid && Object.keys(changes).length > 0;

  return (
    <>
      <Text className="gym-page-section">{`${gym.name} branch`}</Text>
      <GymField label="Branch name" icon="store" pinLabel value={branch} onChangeText={setBranch} maxLength={80} placeholder="For example: Tumkur" />
      <GymField label="Area" icon="map-pin" pinLabel value={area} onChangeText={setArea} maxLength={80} placeholder="For example: Anna Nagar" />
      <GymField label="City" icon="layers" pinLabel value={city} onChangeText={setCity} maxLength={60} placeholder="For example: Chennai" />
      {error ? <FormAlert message={error} /> : null}
      <SaveButton label="Save" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateDetails(token, changes))} />
    </>
  );
}
