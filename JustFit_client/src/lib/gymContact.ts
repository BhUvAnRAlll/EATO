import { Alert, Linking, Platform } from "react-native";

import { planLabel, rupees, shortDate } from "@/data/gymDashboard";
import type { GymInfo, GymMember, GymPayment } from "@/lib/gymApi";

// Reaching a member from the gym portal: the phone's own Call, SMS, WhatsApp and Email apps, with
// the message already written. justFit sends nothing itself (no SMS provider, no cost); the gym
// admin reads the message and taps send.

const noNumber = () => Alert.alert("No mobile number", "Add the member's mobile number to reach them.");
const open = (url: string, what: string) =>
  Linking.openURL(url).catch(() => Alert.alert(`Couldn't open ${what}`, `${what} isn't available on this phone.`));

export function call(member: GymMember) {
  if (!member.phone) return noNumber();
  open(`tel:${member.phone}`, "the phone app");
}

export function sms(member: GymMember, text = "") {
  if (!member.phone) return noNumber();
  // iOS reads the text after "&body=", Android after "?body="
  open(`sms:${member.phone}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(text)}`, "Messages");
}

export function whatsapp(member: GymMember, text = "") {
  if (!member.phone) return noNumber();
  open(`https://wa.me/${member.phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`, "WhatsApp");
}

export function email(member: GymMember, subject = "", body = "") {
  if (!member.email) return Alert.alert("No email", "Add the member's email to write to them.");
  open(`mailto:${member.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "Mail");
}

const gymName = (gym: GymInfo) => `${gym.name} (${gym.branch})`;
const firstName = (member: GymMember) => member.name.split(" ")[0];

// The messages, in plain friendly English
export function dueReminder(member: GymMember, gym: GymInfo) {
  return `Hi ${firstName(member)}, this is ${gymName(gym)}. A payment of ${rupees(member.due)} is due${member.dueBy ? ` by ${shortDate(member.dueBy)}` : ""} for your membership (${member.code}). You can pay at the front desk or online. Thank you!`;
}

export function expiredReminder(member: GymMember, gym: GymInfo) {
  const ended = member.daysLeft < 0;
  return `Hi ${firstName(member)}, your ${gymName(gym)} membership ${ended ? "ended" : "ends"} on ${shortDate(member.expiresOn)}. Renew to keep training with us. See you soon!`;
}

export function invoice(member: GymMember, gym: GymInfo, payment: GymPayment | undefined) {
  return [
    `${gymName(gym)} receipt`,
    `${member.name} (${member.code})`,
    `Plan: ${planLabel(member.planLength.duration, member.planLength.unit)}, until ${shortDate(member.expiresOn)}`,
    ...(payment ? [`Paid: ${rupees(payment.amount)} (${payment.method === "cash" ? "Cash" : "Online"}) on ${shortDate(payment.paidOn)} for ${payment.detail}`] : []),
    member.due > 0 ? `Still due: ${rupees(member.due)}${member.dueBy ? ` by ${shortDate(member.dueBy)}` : ""}` : "Nothing due. Thank you!",
  ].join("\n");
}

// "0 days left", "1 day left", "Expired 3 days ago", "Expires today"
export function daysLeftText(days: number) {
  if (days === 0) return "Expires today";
  if (days < 0) return `Expired ${-days} ${days === -1 ? "day" : "days"} ago`;
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
