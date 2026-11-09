import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymChips } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { initialsOf } from "@/data/gymDashboard";
import { STATUS_TEXT, clockTime, dayOf, durationText } from "@/lib/attendanceText";
import { gymApi, type TeamAttendance as Board, type TeamPerson, type TeamRange, type TeamVisit } from "@/lib/gymApi";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const RANGES: { value: TeamRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
];
const KIND_LABEL = { staff: "Staff", trainer: "Trainer" } as const;

type State = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; board: Board; visits: TeamVisit[]; more: boolean };

// Attendance › Staff & Trainers (2026-11-09, the gym admin only): the branch's Staff logins and
// Trainers with today's state, Check in / Check out by hand, today's numbers, then their visits
// for Today / 7 days / 30 days with a search by name. They check in themselves by scanning the
// branch's QR code (Staff from ☰ › My check-in, trainers from Profile › Gym attendance). Every
// number is the server's (GET /api/gym/team-attendance). `refreshKey` reloads it after a pull.
export function TeamAttendance({ refreshKey = 0 }: { refreshKey?: number }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [range, setRange] = useState<TeamRange>("today");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // the search, once typing pauses
  const [data, setData] = useState<State>({ state: "loading" });
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const working = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const call = ++latest.current;
    const answer = await gymApi.teamAttendance(await getToken().catch(() => null), { range, search: query });
    if (call !== latest.current) return;
    setPage(1);
    setData(answer.ok ? { state: "ready", board: answer.data, visits: answer.data.visits, more: answer.data.total > answer.data.visits.length } : { state: "failed", error: answer.error });
  }, [getToken, range, query]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const showMore = async () => {
    if (data.state !== "ready" || loadingMore) return;
    setLoadingMore(true);
    const call = latest.current;
    const answer = await gymApi.teamAttendance(await getToken().catch(() => null), { range, search: query, page: page + 1 });
    setLoadingMore(false);
    if (call !== latest.current) return;
    if (!answer.ok) return setError(answer.error);
    setPage((p) => p + 1);
    setData((current) => {
      if (current.state !== "ready") return current;
      const visits = [...current.visits, ...answer.data.visits];
      return { ...current, visits, more: answer.data.total > visits.length };
    });
  };

  // A ref, not state, so two taps in one frame can't send two changes
  const mark = async (person: TeamPerson) => {
    if (working.current) return;
    working.current = true;
    setBusyId(person.userId);
    setError("");
    const token = await getToken().catch(() => null);
    const checkingIn = person.today !== "inside";
    const answer = checkingIn ? await gymApi.teamCheckIn(token, person.userId) : await gymApi.teamCheckOut(token, person.userId);
    working.current = false;
    setBusyId(null);
    if (!answer.ok) return setError(answer.error);
    hud.success(checkingIn ? `${person.name.split(" ")[0]} checked in` : `${person.name.split(" ")[0]} checked out`);
    await load();
  };

  if (data.state === "loading") return <GymLoading label="Loading staff attendance" />;
  if (data.state === "failed") return <GymError error={data.error} onRetry={() => { setData({ state: "loading" }); load(); }} />;
  const { board } = data;
  const tiles = [
    { label: "On duty now", shown: "On duty\nnow", value: board.stats.insideNow, icon: "user-check" as const, color: colors.gymSuccess, bg: colors.gymSuccessSoft },
    { label: "Came in today", shown: "Came in\ntoday", value: board.stats.cameToday, icon: "log-in" as const, color: colors.gymPrimary, bg: colors.gymPrimarySoft },
    { label: "Not in yet", shown: "Not in\nyet", value: board.stats.absentToday, icon: "user-x" as const, color: colors.gymWarning, bg: colors.gymWarningSoft },
  ];

  return (
    <View style={{ gap: 12 }}>
      {!board.setup.location || !board.setup.qr ? (
        <PressableScale onPress={() => router.push(board.setup.location ? "/gym/attendance/qr" : "/gym/attendance/settings")} className="gym-warning" accessibilityRole="button" accessibilityLabel={board.setup.location ? "Create the attendance QR code" : "Set the gym's location"}>
          <GymIcon name="triangle-alert" size={18} color={colors.gymWarning} />
          <Text className="gym-warning__text flex-1">
            {board.setup.location ? "Create your attendance QR code: Staff and trainers scan the same code as members." : "Set your gym's location first: Staff and trainers' scans are refused until then."}
          </Text>
        </PressableScale>
      ) : null}

      <View className="flex-row" style={{ gap: 10 }}>
        {tiles.map((t) => (
          <View key={t.label} className="gym-dash-card gym-dash-stat flex-1" accessible accessibilityLabel={`${t.value} ${t.label}`}>
            <View className="gym-dash-stat__icon" style={{ backgroundColor: t.bg }}>
              <GymIcon name={t.icon} size={16} color={t.color} />
            </View>
            <Text className="gym-dash-stat__value">{t.value}</Text>
            <Text className="gym-dash-stat__label" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>{t.shown}</Text>
          </View>
        ))}
      </View>

      <Text className="gym-page-section" accessibilityRole="header">{`Today (${board.stats.teamSize})`}</Text>
      {error ? <FormAlert message={error} /> : null}
      {board.team.length === 0 ? (
        <GymEmpty icon="user-cog" title="No Staff or Trainers yet" text="Add them on Staff / Admin Login. They check in by scanning this branch's QR code." />
      ) : (
        <View style={{ gap: 10 }}>
          {board.team.map((person) => (
            <PersonRow key={person.userId} person={person} busy={busyId === person.userId} onMark={() => mark(person)} />
          ))}
          {board.stats.avgMinutes !== null ? <Text className="gym-tx__meta">{`Average finished shift today: ${durationText(board.stats.avgMinutes)}`}</Text> : null}
        </View>
      )}

      <Text className="gym-page-section" accessibilityRole="header">Staff & trainer history</Text>
      <GymChips options={RANGES} value={range} onChange={setRange} />
      <View className="gym-field--icon">
        <GymIcon name="search" size={18} color={colors.gymMuted} />
        <TextInput
          value={search}
          onChangeText={(text) => setSearch(text.slice(0, 60))}
          placeholder="Search by name"
          placeholderTextColor={colors.gymFaint}
          className="gym-field__icon-input"
          accessibilityLabel="Search staff and trainer attendance by name"
          returnKeyType="search"
          autoCorrect={false}
        />
      </View>
      <Text className="gym-tx__meta">{`${board.total} ${board.total === 1 ? "visit" : "visits"}`}</Text>
      {data.visits.length === 0 ? (
        <GymEmpty icon="scan-qr-code" title="No visits" text={query ? "No one by that name checked in in this range." : "No Staff or Trainer checked in in this range."} />
      ) : (
        <View style={{ gap: 10 }}>
          {data.visits.map((visit) => <TeamVisitRow key={visit.id} visit={visit} showDate={range !== "today"} />)}
          {data.more ? (
            <PressableScale onPress={showMore} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Show more visits">
              {loadingMore && <ActivityIndicator size="small" color={colors.gymPrimary} />}
              <Text className="gym-btn__label gym-btn__label--outline">Show more</Text>
            </PressableScale>
          ) : null}
        </View>
      )}
    </View>
  );
}

// One person on the team today: initials, name and Staff / Trainer, then where they are today
// (in since …, left at … with the time worked, or not in yet), and Check in / Check out by hand
function PersonRow({ person, busy, onMark }: { person: TeamPerson; busy: boolean; onMark: () => void }) {
  const colors = useThemeColors();
  const inside = person.today === "inside";
  const tone = inside ? { text: colors.gymSuccess, bg: colors.gymSuccessSoft, label: "On duty" } : person.today === "left" ? { text: colors.gymPrimary, bg: colors.gymPrimarySoft, label: "Left" } : { text: colors.gymWarning, bg: colors.gymWarningSoft, label: "Not in" };
  const line = inside
    ? `In since ${clockTime(person.firstInAt ?? "")}${person.minutesToday > 0 ? ` · ${durationText(person.minutesToday)} so far` : ""}`
    : person.today === "left"
      ? `${clockTime(person.firstInAt ?? "")} → ${person.lastOutAt ? clockTime(person.lastOutAt) : "—"} · ${durationText(person.minutesToday)}`
      : "Not checked in today";
  return (
    // The row and its button are siblings: a button inside a button isn't allowed on the web
    <View className="gym-card flex-row items-center" style={{ gap: 12, padding: 12 }}>
      <View className="flex-1 flex-row items-center" style={{ gap: 12 }} accessible accessibilityLabel={`${person.name}, ${KIND_LABEL[person.kind]}. ${tone.label}. ${line}`}>
        <View className="gym-avatar">
          <Text className="gym-avatar__label">{initialsOf(person.name)}</Text>
        </View>
        <View className="flex-1" style={{ gap: 2 }}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Text className="gym-tx__name flex-shrink" numberOfLines={1}>{person.name}</Text>
            <View className="gym-tag" style={{ backgroundColor: tone.bg }}>
              <Text className="gym-tag__label" style={{ color: tone.text }}>{tone.label}</Text>
            </View>
          </View>
          <Text className="gym-tx__meta" numberOfLines={1}>{person.phone ? `${KIND_LABEL[person.kind]} · ${person.phone}` : KIND_LABEL[person.kind]}</Text>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <GymIcon name="clock" size={13} color={colors.gymMuted} />
            <Text className="gym-tx__meta flex-shrink" numberOfLines={1}>{line}</Text>
          </View>
        </View>
      </View>
      <PressableScale onPress={onMark} disabled={busy} haptic="tap" className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={`${inside ? "Check out" : "Check in"} ${person.name}`} accessibilityState={{ busy }}>
        {busy ? <ActivityIndicator size="small" color={colors.gymPrimary} /> : <GymIcon name={inside ? "log-out" : "log-in"} size={14} color={colors.gymPrimary} />}
        <Text className="gym-choice__label">{inside ? "Check out" : "Check in"}</Text>
      </PressableScale>
    </View>
  );
}

// One visit in the history: who, Staff / Trainer, the times, how long, and how it was recorded
function TeamVisitRow({ visit, showDate }: { visit: TeamVisit; showDate: boolean }) {
  const colors = useThemeColors();
  const tone = visit.status === "inside" ? { text: colors.gymSuccess, bg: colors.gymSuccessSoft } : visit.status === "completed" ? { text: colors.gymPrimary, bg: colors.gymPrimarySoft } : { text: colors.gymWarning, bg: colors.gymWarningSoft };
  const times = `${showDate ? `${dayOf(visit.checkedInAt)} · ` : ""}${clockTime(visit.checkedInAt)} → ${visit.checkedOutAt ? clockTime(visit.checkedOutAt) : visit.status === "inside" ? "now" : "—"}`;
  const length = visit.status === "no_checkout" ? "No check-out" : `${durationText(visit.durationMin)}${visit.status === "inside" ? " so far" : ""}`;
  const how = visit.inSource === "qr" ? "QR scan" : "By the gym admin";
  const who = visit.kind ? KIND_LABEL[visit.kind] : "Left the team";
  return (
    <View className="gym-card flex-row items-center" style={{ gap: 12, padding: 12 }} accessible accessibilityLabel={`${visit.name}, ${who}. ${STATUS_TEXT[visit.status]}. ${times}. ${length}. ${how}`}>
      <View className="gym-avatar">
        <Text className="gym-avatar__label">{initialsOf(visit.name)}</Text>
      </View>
      <View className="flex-1" style={{ gap: 2 }}>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="gym-tx__name flex-shrink" numberOfLines={1}>{visit.name}</Text>
          <View className="gym-tag" style={{ backgroundColor: tone.bg }}>
            <Text className="gym-tag__label" style={{ color: tone.text }}>{STATUS_TEXT[visit.status]}</Text>
          </View>
        </View>
        <Text className="gym-tx__meta" numberOfLines={1}>{`${who} · ${how}`}</Text>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <GymIcon name="clock" size={13} color={colors.gymMuted} />
          <Text className="gym-tx__meta flex-shrink" numberOfLines={1}>{`${times} · ${length}`}</Text>
        </View>
      </View>
    </View>
  );
}
