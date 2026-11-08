import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { GymField } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { phoneInput } from "@/data/gymDashboard";
import { gymApi, type GymDashboard, type InvoiceDetails } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › Branch details: the open branch's name, area and city (shown on Home's header). The
// gym's own name is the justFit team's to change. They see every change on the branch's page and
// in their activity log. (The admin's own name was removed from here on 2026-11-07.) Under it,
// for the gym admin only, Invoice details (2026-11-07): the address, mobile number and GSTIN
// printed on every invoice, each optional, saved on their own.
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
  const [address, setAddress] = useState(saved.address ?? "");
  const [phone, setPhone] = useState(saved.phone ?? "");
  const [gstin, setGstin] = useState(saved.gstin ?? "");
  const [current, setCurrent] = useState(saved);
  const [done, setDone] = useState(false);
  const { busy, error, save } = useGymSave((data: InvoiceDetails) => {
    setCurrent(data);
    setDone(true);
  });

  // Only what changed is sent; an emptied field clears it
  const cleanGstin = gstin.replace(/\s+/g, "").toUpperCase();
  const changes: Partial<Record<keyof InvoiceDetails, string>> = {};
  if (address.trim() !== (current.address ?? "")) changes.address = address.trim();
  if (phone.trim() !== (current.phone ?? "")) changes.phone = phone.trim();
  if (cleanGstin !== (current.gstin ?? "")) changes.gstin = cleanGstin;
  const phoneOk = phone.trim() === "" || /^[6-9]\d{9}$/.test(phone.trim());
  const gstinOk = cleanGstin === "" || GSTIN.test(cleanGstin);
  const ready = phoneOk && gstinOk && Object.keys(changes).length > 0;

  return (
    <>
      <Text className="gym-section-title" style={{ marginTop: 8 }}>Invoice details</Text>
      <Text className="gym-tx__meta">Printed on every invoice. Leave a field empty to keep it off the invoice.</Text>
      <GymField label="Address" value={address} onChangeText={(t) => { setAddress(t); setDone(false); }} maxLength={160} placeholder="For example: 12, 1st Main Road, SS Puram" />
      <GymField label="Mobile number" value={phone} onChangeText={(t) => { setPhone(phoneInput(t)); setDone(false); }} keyboardType="phone-pad" placeholder="10 digits" hint={phoneOk ? undefined : "Enter a 10-digit Indian mobile number."} />
      <GymField label="GSTIN" value={gstin} onChangeText={(t) => { setGstin(t); setDone(false); }} autoCapitalize="characters" maxLength={15} placeholder="For example: 29ABCDE1234F1Z5" hint={gstinOk ? undefined : "A GSTIN is 15 characters, like 29ABCDE1234F1Z5."} />
      {error ? <FormAlert message={error} /> : null}
      {done && !error ? <Text className="gym-tx__meta" style={{ textAlign: "center" }}>Saved. New invoices carry these details.</Text> : null}
      <SaveButton label="Save invoice details" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateInvoiceDetails(token, changes))} />
    </>
  );
}

function DetailsForm({ gym }: { gym: GymDashboard["gym"] }) {
  const [branch, setBranch] = useState(gym.branch);
  const [area, setArea] = useState(gym.area);
  const [city, setCity] = useState(gym.city);
  const { busy, error, save } = useGymSave(() => router.back());

  // Only what changed is sent
  const changes: { branch?: string; area?: string; city?: string } = {};
  if (branch.trim() !== gym.branch) changes.branch = branch.trim();
  if (area.trim() !== gym.area) changes.area = area.trim();
  if (city.trim() !== gym.city) changes.city = city.trim();
  const valid = [branch, area, city].every((v) => v.trim().length >= 2);
  const ready = valid && Object.keys(changes).length > 0;

  return (
    <>
      <Text className="gym-section-title">{`${gym.name} branch`}</Text>
      <GymField label="Branch name" value={branch} onChangeText={setBranch} maxLength={80} placeholder="For example: Tumkur" />
      <GymField label="Area" value={area} onChangeText={setArea} maxLength={80} placeholder="For example: Anna Nagar" />
      <GymField label="City" value={city} onChangeText={setCity} maxLength={60} placeholder="For example: Chennai" />
      {error ? <FormAlert message={error} /> : null}
      <SaveButton label="Save" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateDetails(token, changes))} />
    </>
  );
}
