import { useCallback } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
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
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

const KINDS: PaymentKind[] = ["admission", "renewal", "due", "pt", "service", "sale"];

// One period's money: the total, online and cash, and each type; with `spent` (a login with the
// Expenses area), what the branch spent and the net under them
function PeriodCard({ title, sums, spent, net }: { title: string; sums: GymWallet["month"]; spent?: number; net?: number }) {
  const colors = useThemeColors();
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
      {spent !== undefined && net !== undefined && (
        <View className="gym-wallet-net" style={{ gap: 10 }}>
          <View className="flex-row items-center justify-between">
            <Text className="gym-tx__meta">Expenses</Text>
            <Text className="gym-tx__name" style={{ fontSize: 14, color: colors.gymDanger }}>{spent > 0 ? `−${rupees(spent)}` : rupees(0)}</Text>
          </View>
          <View className="flex-row items-center justify-between" accessible accessibilityLabel={`Net after expenses: ${net < 0 ? "minus " : ""}${rupees(Math.abs(net))}`}>
            <Text className="gym-tx__name">Net</Text>
            <Text className="gym-tx__amount" style={net < 0 ? { color: colors.gymDanger } : undefined}>{net < 0 ? `−${rupees(-net)}` : rupees(net)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// Gym admin › Wallet: today's and this month's takings, by method and by type, what members
// still have due (GET /api/gym/wallet), and the month-end estimate (`RevenueForecastCard`,
// GET /api/gym/predictions/revenue)
export default function GymWalletTab() {
  const colors = useThemeColors();
  // Role & Permission: the forecast is Predictions and the due list Members; a login without them
  // isn't shown a card the server would refuse (each 403 also re-checked the account, QA 2026-11-07)
  const can = useCan();
  const canPredict = can("predictions.revenue");
  const { result, retry, refreshing, refresh } = useGymData(gymApi.wallet);
  // A stable `load` per answer (useGymData treats a new one as a new query)
  const loadForecast = useCallback((token: string | null) => (canPredict ? gymApi.revenueForecast(token) : Promise.resolve({ ok: false as const, error: "Your login doesn't include Predictions.", status: 403 })), [canPredict]);
  const forecast = useGymData(loadForecast);
  const refreshAll = async () => { await Promise.all([refresh(), canPredict ? forecast.reload() : Promise.resolve()]); };
  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-header">
          <Text className="gym-header__name flex-1" accessibilityRole="header">Wallet</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refreshAll} />}>
          {result.state === "loading" && <GymLoading label="Loading the wallet" />}
          {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
          {result.state === "ready" && (
            <>
              <RevenueCard online={result.data.today.online} cash={result.data.today.cash} action={{ label: "Today's payments", onPress: () => router.push("/gym/transactions?today=1") }} />
              <PeriodCard title="This month" sums={result.data.month} spent={result.data.expenses?.month} net={result.data.net?.month} />
              {canPredict && <RevenueForecastCard result={forecast.result} onRetry={forecast.retry} />}
              {/* An older server answers without `due`: leave the card out rather than crash */}
              {result.data.due && can("members.view") && <PressableScale onPress={() => router.push("/gym/members?filter=due")} className="gym-card gym-tx" accessibilityRole="button" accessibilityLabel={`Due from members: ${rupees(result.data.due.total)}, ${result.data.due.members} members`}>
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
