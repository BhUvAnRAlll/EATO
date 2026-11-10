// Delivery addresses' words and checks (pure, unit-tested; no React Native): the place under the
// map pin as the phone's geocoder read it, the form's hints (the server checks everything again)
// and the lines an address card shows. The pin is only a starting point: the house or flat, the
// street and the pincode are always typed or checked by the member.
export type AddressKind = "home" | "work" | "other";

export const KIND_LABEL: Record<AddressKind, string> = { home: "Home", work: "Work", other: "Other" };
export const KINDS: AddressKind[] = ["home", "work", "other"];

export type LatLng = { latitude: number; longitude: number };

// What the phone's geocoder returns for a point (expo-location's LocationGeocodedAddress)
export type GeocodedPlace = {
  name?: string | null;
  streetNumber?: string | null;
  street?: string | null;
  district?: string | null;
  subregion?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  formattedAddress?: string | null;
};

// The place under the pin, ready for the form
export type PickedPlace = LatLng & {
  title: string; // "Batawadi" — the most specific name the geocoder gave
  formattedAddress: string; // the full line shown under the map
  street: string; // a starting point for "Apartment, street and area"
  city: string;
  pincode: string;
};

const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const unique = (parts: string[]) => parts.filter((part, i) => part && parts.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === i);

export function placeFromGeocode(found: GeocodedPlace | null | undefined, at: LatLng): PickedPlace {
  const street = unique([clean(found?.street), clean(found?.district)]).join(", ");
  const city = clean(found?.city) || clean(found?.subregion);
  const pin = clean(found?.postalCode).replace(/\s/g, "");
  const pincode = PINCODE.test(pin) ? pin : "";
  // A plain number or a plus code ("7JCQ+4X") makes a poor title: skip to the street or area
  const name = clean(found?.name);
  const usableName = name && !/^[\d\s/-]+$/.test(name) && !/^[23456789CFGHJMPQRVWX]{4,8}\+/i.test(name) ? name : "";
  const title = usableName || clean(found?.district) || clean(found?.street) || city || "Pinned location";
  const formatted =
    clean(found?.formattedAddress) ||
    unique([usableName, clean(found?.street), clean(found?.district), city, clean(found?.region), pincode]).join(", ") ||
    `${at.latitude.toFixed(5)}, ${at.longitude.toFixed(5)}`;
  return { latitude: at.latitude, longitude: at.longitude, title, formattedAddress: formatted.slice(0, 300), street: street.slice(0, 160), city: city.slice(0, 80), pincode };
}

// The pin's place when the phone couldn't name it (offline, the web build): coordinates only
export const unnamedPlace = (at: LatLng): PickedPlace => placeFromGeocode(null, at);

export const PINCODE = /^[1-9][0-9]{5}$/;
export const MOBILE = /^[6-9][0-9]{9}$/;

// What was typed as a mobile number, kept to its 10 digits ("+91 98765 43210" → "9876543210")
export function phoneDigits(text: string): string {
  let digits = text.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

// A contact's numbers from the phone's address book, kept only when they are Indian mobiles
// ("+91 98765 43210", "098765 43210", "98765-43210"), once each, in the contact's order. Stricter
// than phoneDigits: a foreign or landline number is left out rather than cut to 10 digits.
export function contactMobiles(numbers: readonly { number?: string | null; label?: string | null }[]): { digits: string; label: string }[] {
  const seen = new Set<string>();
  const found: { digits: string; label: string }[] = [];
  for (const entry of numbers) {
    let digits = (entry.number ?? "").replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (!MOBILE.test(digits) || seen.has(digits)) continue;
    seen.add(digits);
    found.push({ digits, label: (entry.label ?? "").trim() });
  }
  return found;
}

// "9876543210" → "+91 98765 43210"
export const phoneText = (digits: string) => (MOBILE.test(digits) ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

export type AddressForm = {
  receiverName: string;
  receiverPhone: string;
  house: string;
  street: string;
  landmark: string;
  city: string;
  pincode: string;
  instructions: string;
};

// The form's first problem, in the order the fields appear (null: ready to save)
export function formProblem(f: AddressForm): string | null {
  const name = f.receiverName.trim();
  if (name.length < 2) return "Add the receiver's name.";
  if (name.length > 60) return "Keep the name to 60 characters.";
  if (!MOBILE.test(f.receiverPhone)) return "Enter the receiver's 10-digit mobile number.";
  if (f.house.trim().length < 1) return "Add the house, flat or building.";
  if (f.street.trim().length < 3) return "Add the apartment, street and area.";
  if (!PINCODE.test(f.pincode)) return "Enter the 6-digit pincode.";
  if (f.landmark.trim().length === 1) return "The landmark is too short.";
  if (f.instructions.trim().length === 1) return "The delivery instructions are too short.";
  return null;
}

// An address card's lines: "Flat 4B, Sai Residency" then "MG Road, Batawadi, Tumakuru 572103"
export function addressLines(a: { house: string; street: string; landmark: string | null; city: string | null; pincode: string }) {
  return {
    first: a.house,
    second: `${a.city && !a.street.toLowerCase().includes(a.city.toLowerCase()) ? `${a.street}, ${a.city}` : a.street} ${a.pincode}`,
    landmark: a.landmark ? `Near ${a.landmark}` : null,
  };
}
