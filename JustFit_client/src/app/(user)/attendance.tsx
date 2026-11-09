import { QrAttendance } from "@/components/attendance/QrAttendance";

// Profile › Gym attendance (members, and a gym's trainers checking in for work): the scanner is
// shared with the gym portal's ☰ › My check-in (components/attendance/QrAttendance.tsx)
export default function GymAttendance() {
  return <QrAttendance fallback="/profile" />;
}
