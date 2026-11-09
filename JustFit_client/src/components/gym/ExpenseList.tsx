import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { ExpenseDetailsSheet } from "@/components/gym/ExpenseDetailsSheet";
import { ExpenseSheet } from "@/components/gym/ExpenseSheet";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { ReceiptViewer } from "@/components/gym/ReceiptViewer";
import { EXPENSE_CATEGORIES, EXPENSE_ICON, EXPENSE_LABEL, EXPENSE_MONTHS_BACK, expenseTitle, monthLabel, rupees, shiftMonth, shortDate, todayIso } from "@/data/gymDashboard";
import { gymApi, type ExpenseCategory, type GymExpense } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { useCenteredChip } from "@/lib/useCenteredChip";
import { listPerf } from "@/lib/listPerf";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

type Filter = ExpenseCategory | "all";
const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, ...EXPENSE_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))];

// Manage › Expense (2026-11-08): the branch's spending a month at a time (‹ Nov 2026 ›, up to 24
// months back), the month's total split into online and cash, category chips with their counts,
// search by what it was, who was paid or the note, and a card per expense (newest first, 50 a page,
// Show more). A card opens the expense's details first (ExpenseDetailsSheet), whose Edit opens the
// Edit sheet; its Bill chip opens the photo. The round + adds one.
// `addOnOpen`: open Add Expense at once (Home's + › Add Expense, ☰ › Expenses).
export function ExpenseList({ addOnOpen = false }: { addOnOpen?: boolean }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const thisMonth = todayIso().slice(0, 7);
  const firstMonth = shiftMonth(thisMonth, -EXPENSE_MONTHS_BACK);
  const [month, setMonth] = useState(thisMonth);
  const [filter, setFilter] = useState<Filter>("all");
  // The selected chip stays in view (lib/useCenteredChip.ts)
  const { setRow, onRowLayout, onChipLayout } = useCenteredChip(filter);
  const [searchOpen, setSearchOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  // null: closed; "new": Add Expense; an expense: edit it
  // Role & Permission: adding and editing are Expenses › Add and edit expenses
  const canEdit = useCan()("expenses.edit");
  const [editing, setEditing] = useState<GymExpense | "new" | null>(addOnOpen && canEdit ? "new" : null);
  const [viewing, setViewing] = useState<GymExpense | null>(null);
  // The expense whose details are open (a card's tap); Edit moves on to the Edit sheet
  const [showing, setShowing] = useState<GymExpense | null>(null);
  const editShown = () => {
    const item = showing;
    setShowing(null);
    // One sheet closes before the next opens (as Home's + does)
    if (item) setTimeout(() => setEditing(item), 250);
  };

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  // The first page comes with the answer, Show more appends the next ones; an answer for an earlier
  // month, filter or search is dropped, never appended (as on Members)
  const [more, setMore] = useState<{ items: GymExpense[]; next: number | null; loading: boolean; error: string }>({ items: [], next: null, loading: false, error: "" });
  const listKey = useRef(0);
  const load = useCallback(
    async (token: string | null) => {
      const key = ++listKey.current;
      const answer = await gymApi.expenses(token, { month, category: filter, search });
      if (answer.ok && key === listKey.current) setMore({ items: [], next: answer.data.nextPage, loading: false, error: "" });
      return answer;
    },
    [month, filter, search],
  );
  const { result, retry, reload, refreshing, refresh } = useGymData(load);
  const data = result.state === "ready" ? result.data : null;
  const expenses = useMemo(() => (data ? [...data.expenses, ...more.items] : []), [data, more.items]);

  const showMore = async () => {
    if (more.loading || !more.next) return;
    const key = listKey.current;
    setMore((m) => ({ ...m, loading: true, error: "" }));
    const answer = await gymApi.expenses(await getToken().catch(() => null), { month, category: filter, search, page: more.next });
    if (key !== listKey.current) return;
    setMore((m) => (answer.ok ? { items: [...m.items, ...answer.data.expenses], next: answer.data.nextPage, loading: false, error: "" } : { ...m, loading: false, error: answer.error }));
  };

  const moveMonth = (count: number) => {
    const next = shiftMonth(month, count);
    if (next > thisMonth || next < firstMonth) return;
    haptic.select();
    setMonth(next);
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      <View className="flex-row items-center justify-between">
        <PressableScale onPress={() => moveMonth(-1)} disabled={month <= firstMonth} hitSlop={8} className="gym-plain-btn" style={month <= firstMonth ? { opacity: 0.3 } : undefined} accessibilityRole="button" accessibilityLabel="Previous month">
          <GymIcon name="chevron-left" size={22} color={colors.gymInkSoft} />
        </PressableScale>
        <Text className="gym-section-title" accessibilityRole="header">{monthLabel(month)}</Text>
        <PressableScale onPress={() => moveMonth(1)} disabled={month >= thisMonth} hitSlop={8} className="gym-plain-btn" style={month >= thisMonth ? { opacity: 0.3 } : undefined} accessibilityRole="button" accessibilityLabel="Next month">
          <GymIcon name="chevron-right" size={22} color={colors.gymInkSoft} />
        </PressableScale>
      </View>
      {data && (
        <View className="gym-card p-4" style={{ gap: 10 }} accessible accessibilityLabel={`Spent in ${monthLabel(month)}: ${rupees(data.summary.total)}, online ${rupees(data.summary.online)}, cash ${rupees(data.summary.cash)}`}>
          <View className="flex-row items-center justify-between">
            <Text className="gym-tx__meta">{`Spent in ${monthLabel(month)}`}</Text>
            <Text className="gym-tx__meta">{`${data.summary.count} ${data.summary.count === 1 ? "expense" : "expenses"}`}</Text>
          </View>
          <Text className="gym-tx__amount" style={{ fontSize: 24, lineHeight: 32, color: colors.gymInk }}>{rupees(data.summary.total)}</Text>
          <View className="flex-row" style={{ gap: 10 }}>
            <View className="gym-summary flex-1">
              <Text className="gym-tx__meta">Online</Text>
              <Text className="gym-tx__name">{rupees(data.summary.online)}</Text>
            </View>
            <View className="gym-summary flex-1">
              <Text className="gym-tx__meta">Cash</Text>
              <Text className="gym-tx__name">{rupees(data.summary.cash)}</Text>
            </View>
          </View>
        </View>
      )}
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <ScrollView ref={setRow} onLayout={onRowLayout} horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {FILTERS.map((f) => {
            const selected = f.id === filter;
            const count = data?.counts[f.id];
            return (
              <PressableScale
                key={f.id}
                onLayout={onChipLayout(f.id)}
                onPress={() => { if (!selected) haptic.select(); setFilter(f.id); }}
                className={selected ? "gym-kind gym-kind--selected" : "gym-kind"}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${f.label}${count !== undefined ? `, ${count}` : ""}`}
              >
                {selected && <GradientFill radius={999} />}
                <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{count !== undefined ? `${f.label} · ${count}` : f.label}</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
        <PressableScale onPress={() => { setSearchOpen((o) => !o); if (searchOpen) setTyped(""); }} hitSlop={8} className="gym-plain-btn" accessibilityRole="button" accessibilityLabel={searchOpen ? "Close search" : "Search expenses"}>
          <GymIcon name={searchOpen ? "x" : "search"} size={22} color={colors.gymInkSoft} />
        </PressableScale>
      </View>
      {searchOpen && (
        <View className="gym-field__input flex-row items-center" style={{ gap: 8 }}>
          <GymIcon name="search" size={16} color={colors.gymFaint} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Search by what, who was paid or a note"
            placeholderTextColor={colors.gymFaint}
            autoFocus
            autoCorrect={false}
            maxLength={60}
            style={{ flex: 1, fontFamily: "Poppins-Regular", fontSize: 15, color: colors.gymInk, paddingVertical: 0 }}
            accessibilityLabel="Search expenses"
          />
        </View>
      )}
    </View>
  );

  return (
    <>
      <FlatList
        {...listPerf}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}
        data={expenses}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        ListHeaderComponent={header}
        ListFooterComponent={
          more.next || more.error ? (
            <View style={{ gap: 8, paddingTop: 4 }}>
              {more.error ? <Text className="gym-tx__meta">{more.error}</Text> : null}
              {more.next ? (
                <PressableScale onPress={showMore} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Show more expenses">
                  {more.loading && <ActivityIndicator size="small" color={colors.gymPrimary} />}
                  <Text className="gym-btn__label gym-btn__label--outline">Show more</Text>
                </PressableScale>
              ) : null}
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          result.state === "loading" ? (
            <GymLoading label="Loading expenses" />
          ) : result.state === "failed" ? (
            <GymError error={result.error} onRetry={retry} />
          ) : search || filter !== "all" ? (
            <GymEmpty icon="receipt" title="No expenses match" text="Try another search or category." />
          ) : (
            <GymEmpty icon="receipt" title={`Nothing spent in ${monthLabel(month)}`} text="Tap + to record rent, salaries, bills and other spending." />
          )
        }
        renderItem={({ item }) => {
          const meta = [item.paidTo ? `Paid to ${item.paidTo}` : null, shortDate(item.spentOn)].filter(Boolean).join(" · ");
          // The date sits under the amount (as on a payment row), so a long "Paid to" never hides it
          const cash = item.method === "cash";
          return (
            // The card opens the expense; the Bill chip sits under it (no button inside a button)
            <View className="gym-card p-3" style={{ gap: 8 }}>
              <PressableScale
                onPress={() => setShowing(item)}
                className="flex-row items-center"
                style={{ gap: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`${expenseTitle(item)}, ${EXPENSE_LABEL[item.category]}, ${rupees(item.amount)}, ${cash ? "cash" : "online"}, ${meta}. Details`}
              >
                <View className="gym-avatar">
                  <GymIcon name={EXPENSE_ICON[item.category]} size={20} color={colors.gymPrimary} />
                </View>
                <View className="min-w-0 flex-1" style={{ gap: 3 }}>
                  <Text className="gym-tx__name" numberOfLines={1}>{expenseTitle(item)}</Text>
                  {item.paidTo ? <Text className="gym-tx__meta" numberOfLines={1}>{`Paid to ${item.paidTo}`}</Text> : null}
                  <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
                    {item.title ? (
                      <View className="gym-chip" style={{ backgroundColor: colors.gymPrimarySoft, borderColor: colors.gymPrimaryLine }}>
                        <Text className="gym-chip__label" style={{ color: colors.gymPrimaryText }}>{EXPENSE_LABEL[item.category]}</Text>
                      </View>
                    ) : null}
                    <View className="gym-chip" style={cash ? { backgroundColor: colors.gymSuccessSoft, borderColor: colors.gymSuccessLine } : { backgroundColor: colors.gymPage, borderColor: colors.gymLine }}>
                      <Text className="gym-chip__label" style={{ color: cash ? colors.gymSuccess : colors.gymInkSoft }}>{cash ? "Cash" : "Online"}</Text>
                    </View>
                  </View>
                  {item.note ? <Text className="gym-tx__meta" numberOfLines={2}>{item.note}</Text> : null}
                </View>
                <View className="items-end" style={{ gap: 3 }}>
                  <Text className="gym-tx__amount" style={{ color: colors.gymDanger }}>{`−${rupees(item.amount)}`}</Text>
                  <Text className="gym-tx__date">{shortDate(item.spentOn)}</Text>
                </View>
              </PressableScale>
              {item.billUrl && (
                <View className="flex-row" style={{ paddingLeft: 56 }}>
                  <PressableScale onPress={() => setViewing(item)} className="gym-chip flex-row items-center" style={{ gap: 4, backgroundColor: colors.gymPrimarySoft, borderColor: colors.gymPrimaryLine }} accessibilityRole="button" accessibilityLabel={`View the bill for ${expenseTitle(item)}`}>
                    <GymIcon name="receipt-text" size={12} color={colors.gymPrimaryText} />
                    <Text className="gym-chip__label" style={{ color: colors.gymPrimaryText }}>Bill</Text>
                  </PressableScale>
                </View>
              )}
            </View>
          );
        }}
      />
      {canEdit && <View className="absolute" style={{ right: 16, bottom: 16 }}>
        <PressableScale onPress={() => setEditing("new")} haptic="tap" className="gym-fab-round" accessibilityRole="button" accessibilityLabel="Add an expense">
          <GradientFill radius={26} />
          <GymIcon name="plus" size={22} color={colors.white} />
        </PressableScale>
      </View>}
      {editing && (
        <ExpenseSheet
          expense={editing === "new" ? null : editing}
          canDelete={data?.canDelete ?? false}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {showing && <ExpenseDetailsSheet expense={showing} onClose={() => setShowing(null)} onEdit={canEdit ? editShown : undefined} />}
      {viewing?.billUrl && <ReceiptViewer url={viewing.billUrl} title={`${expenseTitle(viewing)} · ${shortDate(viewing.spentOn)}`} onClose={() => setViewing(null)} />}
    </>
  );
}
