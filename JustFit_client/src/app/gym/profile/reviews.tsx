import { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymField } from "@/components/gym/GymField";
import { FilterChip } from "@/components/gym/GymChip";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymSheet } from "@/components/gym/GymSheet";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { gymApi, type GymReview, type ReviewView } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { HIDE_REASONS, REPLY_MAX, averageText, countText, hideReasonText, ratingLabel, reviewDateText, starShares } from "@/lib/gymReviews";
import { haptic } from "@/lib/haptics";
import { confirmChoice, showActions } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

const VIEWS: { id: ReviewView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unreplied", label: "Not replied" },
  { id: "hidden", label: "Hidden" },
];

// Gym Profile › Reviews (phase 4, 2026-11-09): members' reviews of this branch, newest change
// first, 20 at a time. With Gym Profile › Reviews (the gym admin always) a review can be answered
// (one reply, changed or removed) and its words hidden from members with a reason, or shown again.
// No one at the gym can change or remove a rating: a hidden review's stars still count.
export default function GymReviews() {
  const colors = useThemeColors();
  const can = useCan();
  const getToken = useSessionToken();
  const [view, setView] = useState<ReviewView>("all");
  const [more, setMore] = useState<{ items: GymReview[]; next: number | null; loading: boolean }>({ items: [], next: null, loading: false });
  const [replying, setReplying] = useState<GymReview | null>(null);
  const listKey = useRef(0);
  const canChange = can("profile.reviews");

  const load = useCallback(async (token: string | null) => {
    const key = ++listKey.current;
    const answer = await gymApi.reviews(token, view);
    if (answer.ok && key === listKey.current) setMore({ items: [], next: answer.data.nextPage, loading: false });
    return answer;
  }, [view]);
  const { result, retry, reload, refreshing, refresh, update } = useGymData(load);
  const data = result.state === "ready" ? result.data : null;
  const reviews = data ? [...data.reviews, ...more.items] : [];

  const showMore = async () => {
    if (more.loading || !more.next) return;
    const key = listKey.current;
    setMore((m) => ({ ...m, loading: true }));
    const answer = await gymApi.reviews(await getToken().catch(() => null), view, more.next);
    if (key !== listKey.current) return;
    setMore((m) => (answer.ok ? { items: [...m.items, ...answer.data.reviews], next: answer.data.nextPage, loading: false } : { ...m, loading: false }));
  };

  // One review changed: shown at once, then the counts read again
  const changed = (review: GymReview) => {
    update((d) => ({ ...d, reviews: d.reviews.map((r) => (r.id === review.id ? review : r)) }));
    setMore((m) => ({ ...m, items: m.items.map((r) => (r.id === review.id ? review : r)) }));
    reload();
  };
  const action = useGymSave((data: { review: GymReview }) => changed(data.review));

  const manage = (r: GymReview) => {
    showActions({
      title: `${r.name} · ${r.rating} ${r.rating === 1 ? "star" : "stars"}`,
      actions: [
        { label: r.reply ? "Edit reply" : "Reply", onPress: () => setReplying(r) },
        ...(r.reply ? [{ label: "Remove reply", destructive: true, onPress: () => action.save((t) => gymApi.removeReviewReply(t, r.id)) }] : []),
        ...(r.hiddenReason
          ? [{ label: "Show the words again", onPress: () => action.save((t) => gymApi.showReview(t, r.id)) }]
          : r.comment
            ? [{ label: "Hide the words", destructive: true, onPress: () => setTimeout(() => hide(r), 350) }]
            : []),
      ],
    });
  };
  const hide = (r: GymReview) =>
    showActions({
      title: "Why hide these words?",
      message: "Members will see the stars without the words. The rating still counts.",
      actions: HIDE_REASONS.map((reason) => ({ label: reason.label, destructive: true, onPress: () => action.save((t) => gymApi.hideReview(t, r.id, reason.id)) })),
    });

  return (
    <GymScreen title="Reviews" refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}>
      {result.state === "loading" && <GymLoading label="Loading the reviews" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {data && (
        <>
          <Summary summary={data.summary} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {VIEWS.map((v) => (
              <FilterChip key={v.id} label={v.label} count={data.counts[v.id]} selected={view === v.id} onPress={() => { if (view !== v.id) { haptic.select(); setView(v.id); } }} accessibilityLabel={`${v.label}, ${data.counts[v.id]}`} />
            ))}
          </ScrollView>
          {action.error ? <FormAlert message={action.error} /> : null}
          {reviews.length === 0 ? (
            <GymEmpty icon="star" title={view === "all" ? "No reviews yet" : view === "hidden" ? "Nothing hidden" : "Every review has a reply"} text={view === "all" ? "Members of this branch, now or before, can review it from the justFit app." : "Pick All to see every review."} />
          ) : (
            <View style={{ gap: 10 }}>
              {reviews.map((r) => (
                <View key={r.id} className="gym-dash-card" style={{ padding: 14, gap: 8 }}>
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <View className="min-w-0 flex-1">
                      <Text className="gym-dash-row__title" numberOfLines={1}>{r.name}</Text>
                      <Text className="gym-tx__meta">{reviewDateText(r.date)}</Text>
                    </View>
                    <GymStars rating={r.rating} />
                    {canChange && (
                      <PressableScale onPress={() => manage(r)} disabled={action.busy} hitSlop={8} className="gym-plain-btn" accessibilityRole="button" accessibilityLabel={`Options for ${r.name}'s review`}>
                        <GymIcon name="ellipsis" size={18} color={colors.gymMuted} />
                      </PressableScale>
                    )}
                  </View>
                  {r.comment ? <Text className="gym-tx__meta" style={{ color: r.hiddenReason ? colors.gymFaint : colors.gymInk }}>{r.comment}</Text> : <Text className="gym-tx__meta">Rating only</Text>}
                  {r.hiddenReason && (
                    <View className="gym-tag self-start" style={{ backgroundColor: colors.gymWarningSoft }}>
                      <Text className="gym-tag__label" style={{ color: colors.gymWarningInk }}>{`Hidden from members · ${hideReasonText(r.hiddenReason)}`}</Text>
                    </View>
                  )}
                  {r.reply ? (
                    <View style={{ gap: 2, padding: 10, borderRadius: 12, backgroundColor: colors.gymPrimarySoft }}>
                      <Text className="gym-tx__meta">{`Your reply · ${reviewDateText(r.reply.date)}`}</Text>
                      <Text className="gym-tx__meta" style={{ color: colors.gymInk }}>{r.reply.text}</Text>
                    </View>
                  ) : canChange ? (
                    <PressableScale onPress={() => setReplying(r)} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityLabel={`Reply to ${r.name}`}>
                      <Text className="gym-choice__label">Reply</Text>
                    </PressableScale>
                  ) : null}
                </View>
              ))}
              {more.next ? (
                <PressableScale onPress={showMore} disabled={more.loading} className="gym-choice items-center" accessibilityRole="button">
                  <Text className="gym-choice__label">{more.loading ? "Loading…" : "Show more"}</Text>
                </PressableScale>
              ) : null}
            </View>
          )}
          <Text className="gym-tx__meta">{"Only members of this branch can review it. You can reply or hide words that break the rules, but ratings can't be changed or removed."}</Text>
        </>
      )}
      {replying && <ReplySheet review={replying} onClose={() => setReplying(null)} onSaved={(review) => { setReplying(null); changed(review); }} />}
    </GymScreen>
  );
}

function GymStars({ rating }: { rating: number }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row" style={{ gap: 1 }} accessible accessibilityLabel={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <GymIcon key={n} name="star" size={13} color={n <= Math.round(rating) ? colors.gymWarning : colors.gymLine} fill={n <= Math.round(rating) ? colors.gymWarning : "none"} />
      ))}
    </View>
  );
}

function Summary({ summary }: { summary: Parameters<typeof starShares>[0] }) {
  const colors = useThemeColors();
  if (summary.count === 0) return null;
  return (
    <View className="gym-dash-card flex-row items-center" style={{ padding: 16, gap: 16 }} accessible accessibilityLabel={ratingLabel(summary)}>
      <View className="items-center" style={{ gap: 4, minWidth: 72 }}>
        <Text className="gym-page-section" style={{ fontSize: 28, lineHeight: 36 }}>{averageText(summary.average)}</Text>
        <GymStars rating={summary.average ?? 0} />
        <Text className="gym-tx__meta">{countText(summary.count)}</Text>
      </View>
      <View className="min-w-0 flex-1" style={{ gap: 4 }}>
        {starShares(summary).map((s) => (
          <View key={s.stars} className="flex-row items-center" style={{ gap: 8 }}>
            <Text className="gym-tx__meta" style={{ width: 10 }}>{s.stars}</Text>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.gymLine, overflow: "hidden" }}>
              <View style={{ width: `${Math.round(s.share * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.gymWarning }} />
            </View>
            <Text className="gym-tx__meta" style={{ minWidth: 20, textAlign: "right" }}>{s.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// The gym's one reply to a review, written or changed
function ReplySheet({ review, onClose, onSaved }: { review: GymReview; onClose: () => void; onSaved: (review: GymReview) => void }) {
  const [text, setText] = useState(review.reply?.text ?? "");
  const { busy, error, save } = useGymSave((data: { review: GymReview }) => onSaved(data.review), review.reply ? "Reply updated" : "Reply posted");
  const ready = text.trim().length >= 2 && text.trim() !== (review.reply?.text ?? "");
  const close = async () => {
    if (text.trim() !== (review.reply?.text ?? "") && text.trim() && !(await confirmChoice({ title: "Discard the reply?", message: "What you wrote isn't saved.", confirmLabel: "Discard" }))) return;
    onClose();
  };
  return (
    <GymSheet title={review.reply ? "Edit reply" : "Reply"} subtitle={`To ${review.name} · ${review.rating} ${review.rating === 1 ? "star" : "stars"}`} onClose={close}>
      <View style={{ gap: 12 }}>
        {review.comment ? <Text className="gym-tx__meta" numberOfLines={4}>{`“${review.comment}”`}</Text> : null}
        <GymField label="Your reply" value={text} onChangeText={(t) => setText(t.slice(0, REPLY_MAX))} multiline maxLength={REPLY_MAX} hint={`${text.trim().length} of ${REPLY_MAX} · members see it under the review`} placeholder="Thank them, or say what you'll change" />
        {error ? <FormAlert message={error} /> : null}
        <GymPrimaryButton label={review.reply ? "Save reply" : "Post reply"} icon="send" ready={ready} busy={busy} onPress={() => { if (ready) save((t) => gymApi.replyReview(t, review.id, text)); }} />
      </View>
    </GymSheet>
  );
}
