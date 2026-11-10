import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminScans, type AdminScanSummary } from "@/lib/bodyScansApi";
import { scanWhen } from "@/lib/bodyScanText";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; scans: AdminScanSummary[]; total: number; nextPage: number | null };

// Super Admin › Body scans (2026-11-10): every member's kept body scans, newest first, searched by
// name or phone number, 30 a page. A row opens the scan: its photos and report.
export default function AdminBodyScans() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Only the newest read may land: an older search's answer arriving late can't overwrite it
  const latest = useRef(0);
  const read = useCallback(async () => {
    const ticket = ++latest.current;
    const result = await adminScans.list(await getToken().catch(() => null), query, 1);
    if (ticket !== latest.current) return;
    setLoad(result.ok ? { state: "ready", scans: result.data.scans, total: result.data.total, nextPage: result.data.nextPage } : { state: "failed", error: result.error });
  }, [getToken, query]);

  // A new search keeps the old list on screen until its answer arrives
  useEffect(() => {
    void read();
  }, [read]);

  const refresh = async () => {
    setRefreshing(true);
    await read();
    setRefreshing(false);
  };

  const showMore = async () => {
    if (load.state !== "ready" || !load.nextPage || more) return;
    setMore(true);
    const result = await adminScans.list(await getToken().catch(() => null), query, load.nextPage);
    setMore(false);
    if (result.ok) setLoad({ state: "ready", scans: [...load.scans, ...result.data.scans], total: result.data.total, nextPage: result.data.nextPage });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Body scans" subtitle={load.state === "ready" ? `${load.total} kept` : undefined} fallback="/admin/more" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} />} showsVerticalScrollIndicator={false}>
          <View className="search search--pill search--on-page">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
            <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Name or phone" placeholderTextColor={colors.faint} autoCorrect={false} autoCapitalize="none" maxLength={80} accessibilityLabel="Search body scans" />
          </View>
          {load.state === "loading" ? <ScreenSkeleton cards={3} label="Loading body scans" /> : null}
          {load.state === "failed" ? <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load body scans" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={refresh} /> : null}
          {load.state === "ready" && load.scans.length === 0 ? (
            <DashedBlock icon={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }} title={query ? "Nobody matches" : "No scans yet"} text={query ? `No scan matches "${query}".` : "Scans members take from the AI Coach or Profile show here."} />
          ) : null}
          {load.state === "ready" && load.scans.length > 0 ? (
            <View className="admin-list">
              {load.scans.map((scan, i) => (
                <Pressable key={scan.id} onPress={() => router.push({ pathname: "/admin/body-scans/[id]", params: { id: scan.id } })} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="button" accessibilityLabel={`${scan.member.name}, ${scan.bodyFatPercent}% body fat, ${scanWhen(scan.at)}`}>
                  <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                    <Text className="card__title" numberOfLines={1}>{scan.member.name}</Text>
                    <Text className="meta-text" numberOfLines={1}>{`${scan.bodyFatPercent}% body fat · ${scan.weightKg} kg · ${scan.heightCm} cm`}</Text>
                    <Text className="meta-text" numberOfLines={1}>{scanWhen(scan.at)}</Text>
                  </View>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                </Pressable>
              ))}
            </View>
          ) : null}
          {load.state === "ready" && load.nextPage ? (
            <Pressable onPress={showMore} disabled={more} className="btn-outline" accessibilityRole="button">
              <Text className="btn-outline__label">{more ? "Loading…" : "Show more"}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
