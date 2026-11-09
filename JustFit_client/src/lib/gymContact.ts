import { Linking, Platform } from "react-native";

import { planLabel, rupees, shortDate } from "@/data/gymDashboard";
import type { GymInfo, GymMember, GymPayment } from "@/lib/gymApi";
import { hud } from "@/lib/hud";
import { fillTemplate, templateText, type CustomTemplates, type TemplateKind } from "@/lib/reminderTemplates";

// Reaching a member from the gym portal: the phone's own Call, SMS, WhatsApp and Email apps, with
// the message already written. justFit sends nothing itself (no SMS provider, no cost); the gym
// admin reads the message and taps send.

const noNumber = () => hud.error("No mobile number saved");
const open = (url: string, what: string) => Linking.openURL(url).catch(() => hud.error(`Couldn't open ${what}`));

// A number on its own (an enquiry), or a member's
export function callPhone(phone: string | null) {
  if (!phone) return noNumber();
  open(`tel:${phone}`, "the phone app");
}

export function whatsappPhone(phone: string | null, text = "") {
  if (!phone) return noNumber();
  open(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`, "WhatsApp");
}

export function call(member: GymMember) {
  callPhone(member.phone);
}

export function smsPhone(phone: string | null, text = "") {
  if (!phone) return noNumber();
  // iOS reads the text after "&body=", Android after "?body="
  open(`sms:${phone}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(text)}`, "Messages");
}

export function sms(member: GymMember, text = "") {
  smsPhone(member.phone, text);
}

export function whatsapp(member: GymMember, text = "") {
  whatsappPhone(member.phone, text);
}

export function emailTo(address: string | null, subject = "", body = "") {
  if (!address) return hud.error("No email saved");
  open(`mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "Mail");
}

export function email(member: GymMember, subject = "", body = "") {
  emailTo(member.email, subject, body);
}

const gymName = (gym: GymInfo) => `${gym.name} (${gym.branch})`;
const firstName = (member: GymMember) => member.name.split(" ")[0];

// The messages, in plain friendly English: the branch's own wording from Reminder Templates when it
// has one (`custom`), else justFit's default (lib/reminderTemplates.ts), with the member filled in
export function dueReminder(member: GymMember, gym: GymInfo, custom?: CustomTemplates | null) {
  return fillTemplate(templateText("due", custom), { ...memberValues(member, gym), amount: rupees(member.due), dueBy: member.dueBy ? `by ${shortDate(member.dueBy)}` : "" });
}

// Ending soon or already ended: the expiry or expired template, by the member's plan
export function expiredReminder(member: GymMember, gym: GymInfo, custom?: CustomTemplates | null) {
  return fillTemplate(templateText(membershipTemplate(member), custom), { ...memberValues(member, gym), date: shortDate(member.expiresOn) });
}

// A template the gym admin added: every member detail is there to fill in
export function addedReminder(member: GymMember, gym: GymInfo, text: string) {
  return fillTemplate(text, {
    ...memberValues(member, gym),
    amount: rupees(member.due),
    dueBy: member.dueBy ? `by ${shortDate(member.dueBy)}` : "",
    date: shortDate(member.expiresOn),
  });
}

export const membershipTemplate = (member: GymMember): TemplateKind => (member.daysLeft < 0 ? "expired" : "expiry");

const memberValues = (member: GymMember, gym: GymInfo) => ({ name: firstName(member), gym: gymName(gym), code: member.code });

export function invoice(member: GymMember, gym: GymInfo, payment: GymPayment | undefined) {
  return [
    `${gymName(gym)} receipt`,
    `${member.name} (${member.code})`,
    `Plan: ${planLabel(member.planLength.duration, member.planLength.unit)}, until ${shortDate(member.expiresOn)}`,
    ...(payment ? [`Paid: ${rupees(payment.amount)} (${payment.method === "cash" ? "Cash" : "Online"}) on ${shortDate(payment.paidOn)} for ${payment.detail}`] : []),
    member.due > 0 ? `Still due: ${rupees(member.due)}${member.dueBy ? ` by ${shortDate(member.dueBy)}` : ""}` : "Nothing due. Thank you!",
  ].join("\n");
}

// A friendly follow-up to someone who asked about joining
export function enquiryFollowUp(name: string, gym: GymInfo, custom?: CustomTemplates | null) {
  return fillTemplate(templateText("enquiry", custom), { name: name.split(" ")[0], gym: gymName(gym) });
}

// "0 days left", "1 day left", "Expired 3 days ago", "Expires today"
export function daysLeftText(days: number) {
  if (days === 0) return "Expires today";
  if (days < 0) return `Expired ${-days} ${days === -1 ? "day" : "days"} ago`;
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
