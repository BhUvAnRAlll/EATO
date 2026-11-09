import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { DateSelect } from "@/components/gym/DateSelect";
import { GymChips } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError } from "@/components/gym/GymStates";
import { VisitRow } from "@/components/gym/VisitRow";
import { exportAttendance } from "@/lib/attendanceExport";
import { indiaDay } from "@/lib/attendanceText";
import { gymApi, type GymVisit, type VisitQuery, type VisitStatus } from "@/lib/gymApi";
import { useSessionToken } from "@/lib/session";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

type Range = "today" | "week" | "month" | "custom";
const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
  { value: "custom", label: "Custom" },
];
const STATUSES: { value: VisitStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "inside", label: "Inside" },
  { value: "completed", label: "Completed" },
  { value: "no_checkout", label: "No check-out" },
];
const startOf = (range: Range) => indiaDay(range === "week" ? -6 : range === "month" ? -29 : 0);

type Page = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; visits: GymVisit[]; total: number; page: number; pageSize: number; more: boolean };

// Attendance history: a date range, a status, a search (not for one member), the visits newest
// first 50 at a time, and Export to Excel of exactly what is filtered. `memberId` narrows it to one
// member (their history); `refreshKey` reloads it after a check-out elsewhere on the screen.
export function VisitHistory({ memberId, refreshKey = 0, defaultRange = "today" }: { memberId?: number; refreshKey?: number; defaultRange?: Range }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  // Role & Permission: Export Excel is its own option (Attendance › Export history)
  const canExport = useCan()("attendance.export");
  const today = indiaDay();
  const [range, setRange] = useState<Range>(defaultRange);
  const [from, setFrom] = useState(startOf(defaultRange));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<VisitStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // the search, once typing pauses
  const [page, setPage] = useState<Page>({ state: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const latest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useCallback((p = 1): VisitQuery => ({ from, to, status, search: query, memberId, page: p }), [from, to, status, query, memberId]);

  const load = useCallback(async () => {
    const call = ++latest.current;
    const answer = await gymApi.visits(await getToken().catch(() => null), filters(1));
    if (call !== latest.current) return;
    setPage(answer.ok ? { state: "ready", visits: answer.data.visits, total: answer.data.total, page: 1, pageSize: answer.data.pageSize, more: answer.data.total > answer.data.visits.length } : { state: "failed", error: answer.error });
  }, [filters, getToken]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const pickRange = (value: Range) => {
    setRange(value);
    if (value !== "custom") {
      setFrom(startOf(value));
      setTo(today);
    }
  };

  // Inside means today's open visits (a visit still open at midnight is closed as no check-out),
  // so picking Inside selects Today and the other ranges can't be picked until another status is
  const pickStatus = (value: VisitStatus | "all") => {
    setStatus(value);
    if (value === "inside" && range !== "today") pickRange("today");
  };
  const ranges = RANGES.map((r) => ({ ...r, disabled: status === "inside" && r.value !== "today" }));

  const [moreError, setMoreError] = useState("");
  const showMore = async () => {
    if (page.state !== "ready" || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    const next = page.page + 1;
    // The list this page belongs to: a filter changed meanwhile means the answer is for the old list
    const call = latest.current;
    const answer = await gymApi.visits(await getToken().catch(() => null), filters(next));
    setLoadingMore(false);
    if (call !== latest.current) return;
    if (!answer.ok) return setMoreError(answer.error);
    setPage((current) => {
      if (current.state !== "ready") return current;
      const visits = [...current.visits, ...answer.data.visits];
      return { ...current, visits, page: next, more: answer.data.total > visits.length };
    });
  };

  const runExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    const done = await exportAttendance(await getToken().catch(() => null), filters(1));
    setExporting(false);
    if (!done.ok) setExportError(done.error);
  };

  return (
    <View style={{ gap: 12 }}>
      <GymChips options={ranges} value={range} onChange={pickRange} />
      {range === "custom" && (
        <View style={{ gap: 8 }}>
          <DateSelect label="From" value={from} onChange={(day) => { setFrom(day); if (day > to) setTo(day); }} min={indiaDay(-365)} max={today} />
          <DateSelect label="To" value={to} onChange={(day) => { setTo(day); if (day < from) setFrom(day); }} min={indiaDay(-365)} max={today} />
        </View>
      )}
      <GymChips options={STATUSES} value={status} onChange={pickStatus} />
      {memberId ? null : (
        <View className="gym-field--icon">
          <GymIcon name="search" size={18} color={colors.gymMuted} />
          <TextInput
            value={search}
            onChangeText={(text) => setSearch(text.slice(0, 60))}
            placeholder="Search a member by name or ID"
            placeholderTextColor={colors.gymFaint}
            className="gym-field__icon-input"
            accessibilityLabel="Search attendance by member name or ID"
            returnKeyType="search"
            autoCorrect={false}
          />
        </View>
      )}

      <View className="flex-row items-center justify-between" style={{ gap: 12 }}>
        <Text className="gym-tx__meta flex-1">{page.state === "ready" ? `${page.total} ${page.total === 1 ? "visit" : "visits"}` : " "}</Text>
        {canExport && <PressableScale onPress={runExport} disabled={exporting || page.state !== "ready" || page.total === 0} className="gym-choice flex-row items-center" style={{ gap: 6, opacity: page.state === "ready" && page.total > 0 ? 1 : 0.5 }} accessibilityRole="button" accessibilityLabel="Export to Excel" accessibilityState={{ busy: exporting }}>
          {exporting ? <ActivityIndicator size="small" color={colors.gymPrimary} /> : <GymIcon name="download" size={14} color={colors.gymPrimary} />}
          <Text className="gym-choice__label">Export Excel</Text>
        </PressableScale>}
      </View>
      {exportError ? <FormAlert message={exportError} /> : null}
      {moreError ? <FormAlert message={moreError} /> : null}

      {page.state === "loading" && <ActivityIndicator color={colors.gymPrimary} accessibilityLabel="Loading attendance" />}
      {page.state === "failed" && <GymError error={page.error} onRetry={load} />}
      {page.state === "ready" &&
        (page.visits.length === 0 ? (
          <GymEmpty icon="scan-qr-code" title="No visits" text="No check-ins match these filters." />
        ) : (
          <View style={{ gap: 10 }}>
            {page.visits.map((visit) => (
              <VisitRow key={visit.id} visit={visit} showDate={range !== "today"} onPress={memberId ? undefined : () => router.push({ pathname: "/gym/attendance/member/[id]", params: { id: String(visit.memberId), name: visit.memberName } })} />
            ))}
            {page.more ? (
              <PressableScale onPress={showMore} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Show more visits">
                {loadingMore && <ActivityIndicator size="small" color={colors.gymPrimary} />}
                <Text className="gym-btn__label gym-btn__label--outline">Show more</Text>
              </PressableScale>
            ) : null}
          </View>
        ))}
    </View>
  );
}
