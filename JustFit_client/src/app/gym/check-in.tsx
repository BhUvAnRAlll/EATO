import { QrAttendance } from "@/components/attendance/QrAttendance";

// ☰ › My check-in (2026-11-09): a Staff login checks in and out for work by scanning the branch's
// attendance QR code, with the same GPS checks as members (the server records it as a day at work;
// the gym admin sees it on Attendance › Staff & Trainers)
export default function GymCheckIn() {
  return <QrAttendance fallback="/gym" forWork />;
}
