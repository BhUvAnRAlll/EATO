import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { RevenueCard } from "@/components/gym/RevenueCard";
import { RevenueForecastCard } from "@/components/gym/RevenueForecastCard";
import { KIND_LABEL, rupees } from "@/data/gymDashboard";
import { gymApi, type GymWallet, type PaymentKind } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";

const KINDS: PaymentKind[] = ["admission", "renewal", "due", "pt", "service", "sale"];

// One period's money: the total, online and cash, and each type
function PeriodCard({ title, sums }: { title: string; sums: GymWallet["month"] }) {
  return (
    <View className="gym-card p-4" style={{ gap: 10 }}>
      <View className="flex-row items-center justify-between">
        <Text className="gym-section-title">{title}</Text>
        <Text className="gym-tx__amount">{rupees(sums.total)}</Text>
      </View>
      <View className="flex-row" style={{ gap: 10 }}>
        <View className="gym-summary flex-1">
          <Text className="gym-tx__meta">Online</Text>
          <Text className="gym-tx__name">{rupees(sums.online)}</Text>
        </View>
        <View className="gym-summary flex-1">
          <Text className="gym-tx__meta">Cash</Text>
          <Text className="gym-tx__name">{rupees(sums.cash)}</Text>
        </View>
      </View>
      {KINDS.map((kind) => (
        <View key={kind} className="flex-row items-center justify-between">
          <Text className="gym-tx__meta">{KIND_LABEL[kind]}</Text>
          <Text className="gym-tx__name" style={{ fontSize: 14 }}>{rupees(sums.byKind[kind])}</Text>
        </View>
      ))}
    </View>
  );
}

// Gym admin › Wallet: today's and this month's takings, by method and by type, what members
// still have due (GET /api/gym/wallet), and the month-end estimate (`RevenueForecastCard`,
// GET /api/gym/predictions/revenue)
export default function GymWalletTab() {
  const { result, retry } = useGymData(gymApi.wallet);
  const forecast = useGymData(gymApi.revenueForecast);
  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-header">
          <Text className="gym-header__name flex-1" accessibilityRole="header">Wallet</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }} showsVerticalScrollIndicator={false}>
          {result.state === "loading" && <GymLoading label="Loading the wallet" />}
          {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
          {result.state === "ready" && (
            <>
              <RevenueCard online={result.data.today.online} cash={result.data.today.cash} action={{ label: "Today's payments", onPress: () => router.push("/gym/transactions?today=1") }} />
              <PeriodCard title="This month" sums={result.data.month} />
              <RevenueForecastCard result={forecast.result} onRetry={forecast.retry} />
              {/* An older server answers without `due`: leave the card out rather than crash */}
              {result.data.due && <PressableScale onPress={() => router.push("/gym/members?filter=due")} className="gym-card gym-tx" accessibilityRole="button" accessibilityLabel={`Due from members: ${rupees(result.data.due.total)}, ${result.data.due.members} members`}>
                <View className="min-w-0 flex-1">
                  <Text className="gym-tx__name">Due from members</Text>
                  <Text className="gym-tx__meta">{`${result.data.due.members} ${result.data.due.members === 1 ? "member has a due" : "members have dues"}`}</Text>
                </View>
                <Text className="gym-tx__amount">{rupees(result.data.due.total)}</Text>
              </PressableScale>}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
