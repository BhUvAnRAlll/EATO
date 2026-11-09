// Gym Hub › Discover Gyms and a gym's page (phase 3; pure, unit-tested, no React Native): prices,
// distances, today's opening hours in India's time, and the link that opens directions.
import { DAYS, FACILITIES, timeLabel, type Day, type FacilityId, type OpeningHours } from "./gymProfile.ts";

const IST_OFFSET_MS = 330 * 60_000;
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// "From ₹1,000/month" or "No plans listed yet"
export const fromPriceText = (price: number | null) => (price === null ? "No plans listed yet" : `From ${rupees(price)}/month`);
// "₹1,500" and "₹1,000 a month"
export const priceText = rupees;
export const perMonthText = (n: number | null) => (n === null ? "" : `${rupees(n)} a month`);
// "3 Months", "1 Month", "15 Days"
export const planLengthText = (months: number | null, days: number | null = null) =>
  months ? `${months} ${months === 1 ? "Month" : "Months"}` : days ? `${days} ${days === 1 ? "Day" : "Days"}` : "";

// "450 m", "3.2 km", "24 km"
export function distanceText(km: number | null): string {
  if (km === null) return "";
  if (km < 1) return `${Math.max(100, Math.round(km * 10) * 100)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export const facilityLabel = (id: FacilityId) => FACILITIES.find((f) => f.id === id)?.label ?? id;

// The first few facilities, then "+N more"
export function facilitiesLine(ids: FacilityId[], show = 3): string {
  if (ids.length === 0) return "";
  const shown = ids.slice(0, show).map(facilityLabel).join(" · ");
  return ids.length > show ? `${shown} · +${ids.length - show} more` : shown;
}

// India's weekday and minutes past midnight right now
export function indiaNow(nowMs: number): { day: Day; minutes: number } {
  const t = new Date(nowMs + IST_OFFSET_MS);
  return { day: DAYS[(t.getUTCDay() + 6) % 7].id, minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// Whether the gym is open now, and the line that says so
export function openNow(hours: OpeningHours | null, nowMs: number): { open: boolean; line: string } | null {
  if (!hours) return null;
  const { day, minutes } = indiaNow(nowMs);
  const sessions = hours[day];
  for (const [open, close] of sessions) {
    if (minutes >= toMinutes(open) && minutes < toMinutes(close)) return { open: true, line: `Open now · closes ${timeLabel(close)}` };
  }
  const next = sessions.find(([open]) => toMinutes(open) > minutes);
  if (next) return { open: false, line: `Closed now · opens ${timeLabel(next[0])}` };
  return { open: false, line: sessions.length === 0 ? "Closed today" : "Closed for today" };
}

// Directions in the phone's maps: by the gym's place on the map, else its address
export function directionsUrl(gym: { name: string; branch: string; area: string; city: string; location: { latitude: number; longitude: number } | null; contact: { address: string | null } }): string {
  if (gym.location) return `https://www.google.com/maps/dir/?api=1&destination=${gym.location.latitude},${gym.location.longitude}`;
  const where = [gym.contact.address, gym.area, gym.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gym.name} ${gym.branch}, ${where}`)}`;
}
