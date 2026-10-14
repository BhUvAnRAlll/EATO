// Date of birth is stored as "DD/MM/YYYY"

const pad = (n: number) => String(n).padStart(2, "0");

export function toDobString(date: Date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function parseDob(dob: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob);
  if (!match) return null;
  const [, dd, mm, yyyy] = match.map(Number);
  const date = new Date(yyyy, mm - 1, dd);
  return date.getDate() === dd && date.getMonth() === mm - 1 ? date : null;
}

// "12 Apr 2002"
export function formatDob(dob: string) {
  const date = parseDob(dob);
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

// Birthdays allowed by the picker: ages 13 to 100
export function dobLimits(today = new Date()) {
  const maximumYear = today.getFullYear() - 13;
  const maximumDay = Math.min(today.getDate(), new Date(maximumYear, today.getMonth() + 1, 0).getDate());
  return {
    minimumDate: new Date(today.getFullYear() - 100, today.getMonth(), today.getDate()),
    maximumDate: new Date(maximumYear, today.getMonth(), maximumDay),
  };
}

// Age in whole years from a DD/MM/YYYY date of birth, or null if the date isn't valid
export function ageFromDob(dob: string): number | null {
  const birth = parseDob(dob);
  if (!birth) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthday =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthday) age--;
  return age;
}

// "Mon, 13 Oct" for the home screen's Today card
export function formatShortDate(date = new Date()) {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  return `${weekday}, ${date.getDate()} ${date.toLocaleDateString("en-GB", { month: "short" })}`;
}

// Admin scheduling fields use local "YYYY-MM-DD HH:mm"; the server stores ISO (UTC)

export function parseLocalDateTime(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  const date = new Date(y, m - 1, d, h, min);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === min ? date : null;
}

export function formatLocalDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
