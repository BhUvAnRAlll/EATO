import { DashboardScreen } from "@/components/DashboardScreen";

// Home for regular users (only reachable once profile setup is finished).
// Still a placeholder: the real home (calorie ring, deliveries, streak) is built later.
export default function Home() {
  return <DashboardScreen role="user" />;
}
