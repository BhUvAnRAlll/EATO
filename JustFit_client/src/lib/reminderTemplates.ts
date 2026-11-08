// Reminder Templates (2026-11-08): the four messages a gym can reword, their default text and the
// {placeholders} each may use. Pure, unit-tested (lib/__tests__/reminderTemplates.test.ts). The
// server checks a saved text with the same lists (JustFit_server/gym/templateRules.js); keep the
// two in step. The defaults are the wording Send Reminder and the enquiry WhatsApp button used
// before, so a branch that never edits anything sends exactly what it sent before.

export type TemplateKind = "due" | "expiry" | "expired" | "enquiry";
export type Placeholder = "name" | "gym" | "amount" | "dueBy" | "date" | "code";
// What a branch has saved: a kind with null uses the default
export type CustomTemplates = Record<TemplateKind, string | null>;

export const TEMPLATE_KINDS: TemplateKind[] = ["due", "expiry", "expired", "enquiry"];
export const TEMPLATE_MIN = 10;
export const TEMPLATE_MAX = 300;

export const TEMPLATE_INFO: Record<TemplateKind, { label: string; usedFor: string }> = {
  due: { label: "Payment due", usedFor: "Members with a payment due" },
  expiry: { label: "Membership expiring", usedFor: "Members whose plan is still running" },
  expired: { label: "Membership expired", usedFor: "Members whose plan has ended" },
  enquiry: { label: "Enquiry follow-up", usedFor: "WhatsApp on an enquiry card" },
};

export const PLACEHOLDERS: Record<TemplateKind, Placeholder[]> = {
  due: ["name", "gym", "amount", "dueBy", "code"],
  expiry: ["name", "gym", "date", "code"],
  expired: ["name", "gym", "date", "code"],
  enquiry: ["name", "gym"],
};

export const PLACEHOLDER_LABEL: Record<Placeholder, string> = {
  name: "First name",
  gym: "Gym and branch",
  amount: "Amount due",
  dueBy: "Due date",
  date: "Plan end date",
  code: "Member ID",
};

export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  due: "Hi {name}, this is {gym}. A payment of {amount} is due {dueBy} for your membership ({code}). You can pay at the front desk or online. Thank you!",
  expiry: "Hi {name}, your {gym} membership ends on {date}. Renew to keep training with us. See you soon!",
  expired: "Hi {name}, your {gym} membership ended on {date}. Renew to keep training with us. See you soon!",
  enquiry: "Hi {name}, this is {gym}. Thanks for asking about joining us! Would you like to visit for a session this week? Reply here and we'll help you pick a plan.",
};

// The preview's member (as the SMS previews use)
export const SAMPLE_VALUES: Record<Placeholder, string> = {
  name: "Priya",
  gym: "Forma (Tumkur)",
  amount: "₹1,500",
  dueBy: "by 15 Nov 2026",
  date: "30 Nov 2026",
  code: "FOR-TUM-0001",
};

// The branch's text for a kind, or the default
export const templateText = (kind: TemplateKind, custom?: CustomTemplates | null) => custom?.[kind] ?? DEFAULT_TEMPLATES[kind];

// The text with its placeholders filled in. A value may be empty ({dueBy} without a due date), so
// the doubled space or the space before a comma it leaves is tidied away; line breaks stay.
export function fillTemplate(text: string, values: Partial<Record<Placeholder, string>>) {
  return text
    .replace(/\{([A-Za-z]+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? values[key as Placeholder] ?? "" : whole))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?)])/g, "$1")
    .replace(/\( +/g, "(")
    .trim();
}

// Why a text can't be saved, or null (the server says the same; this is the hint while typing)
export function templateProblem(kind: TemplateKind, text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < TEMPLATE_MIN) return `Write at least ${TEMPLATE_MIN} characters.`;
  if (trimmed.length > TEMPLATE_MAX) return `Keep the message to ${TEMPLATE_MAX} characters.`;
  const allowed: string[] = PLACEHOLDERS[kind];
  const unknown = [...trimmed.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).find((name) => !allowed.includes(name));
  if (unknown !== undefined) return `{${unknown.slice(0, 20)}} isn't a placeholder this message can use.`;
  if (/[{}]/.test(trimmed.replace(/\{[^{}]*\}/g, ""))) return "A placeholder is missing its { or }.";
  return null;
}
