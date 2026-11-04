import { dueReminder, expiredReminder, sms } from "@/lib/gymContact";
import type { GymInfo, GymMember, SmsKind } from "@/lib/gymApi";

// Send Bulk SMS helpers. The messages themselves are written by the server (DLT templates in
// JustFit_server/gym/smsRules.js); the app only picks which one and shows the server's previews.

export const SMS_KIND_LABEL: Record<SmsKind, string> = {
  expiry: "Expiry reminder",
  expired: "Expired reminder",
  due: "Due reminder",
  birthday: "Birthday wish",
};

// The member list's membership reminder: expired once the plan has ended, else its end
export const membershipKind = (member: GymMember): SmsKind => (member.daysLeft < 0 ? "expired" : "expiry");

// While justFit can't send SMS (switched off on the server), the phone's own SMS app opens with
// the same reminder written
export function textFromPhone(member: GymMember, gym: GymInfo, kind: SmsKind) {
  sms(member, kind === "due" ? dueReminder(member, gym) : expiredReminder(member, gym));
}
