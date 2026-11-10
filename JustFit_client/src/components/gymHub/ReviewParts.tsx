import { Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import type { PublicReview, ReviewSummary } from "@/lib/discoverApi";
import { averageText, countText, ratingLabel, reviewDateText, starShares } from "@/lib/gymReviews";
import { useThemeColors } from "@/theme";

// Gym reviews' pieces for members (Gym Profile phase 4, 2026-11-09): stars, the summary with a bar
// per number of stars, and one review with the gym's reply under it.

// Whole stars, filled up to the rating (a review's own rating is a whole number; the average rounds)
export function Stars({ rating, size = 14, color }: { rating: number; size?: number; color?: string }) {
  const colors = useThemeColors();
  const filled = Math.round(rating);
  return (
    <View className="flex-row" style={{ gap: 2 }} accessible accessibilityLabel={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <SymbolView key={n} name={n <= filled ? "star.fill" : "star"} size={size} tintColor={n <= filled ? color ?? colors.warning : colors.lineStrong} />
      ))}
    </View>
  );
}

export function ReviewSummaryCard({ summary }: { summary: ReviewSummary }) {
  const colors = useThemeColors();
  if (summary.count === 0) {
    return (
      <View className="card" style={{ gap: 4 }}>
        <Text className="card__title">No reviews yet</Text>
        <Text className="card__subtitle">Members of this gym can review it.</Text>
      </View>
    );
  }
  return (
    <View className="card flex-row items-center" style={{ gap: 16 }} accessible accessibilityLabel={ratingLabel(summary)}>
      <View className="items-center" style={{ gap: 4, minWidth: 72 }}>
        <Text className="type-display text-ink">{averageText(summary.average)}</Text>
        <Stars rating={summary.average ?? 0} size={12} />
        <Text className="type-caption text-muted">{countText(summary.count)}</Text>
      </View>
      <View className="min-w-0 flex-1" style={{ gap: 4 }}>
        {starShares(summary).map((s) => (
          <View key={s.stars} className="flex-row items-center" style={{ gap: 8 }}>
            <Text className="type-caption text-muted" style={{ width: 10 }}>{s.stars}</Text>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden" }}>
              <View style={{ width: `${Math.round(s.share * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.warning }} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ReviewCard({ review: r }: { review: PublicReview }) {
  const colors = useThemeColors();
  const date = reviewDateText(r.date);
  return (
    <View className="card" style={{ gap: 8 }}>
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="card__title min-w-0 flex-1" numberOfLines={1}>{r.isYou ? `${r.name} (you)` : r.name}</Text>
        <Text className="type-caption text-muted">{r.edited ? `${date} · edited` : date}</Text>
      </View>
      <Stars rating={r.rating} />
      {r.comment ? <Text className="type-body text-ink">{r.comment}</Text> : <Text className="type-caption text-muted">Rating only</Text>}
      {r.reply && (
        <View style={{ gap: 2, padding: 10, borderRadius: 12, backgroundColor: colors.surfaceAlt }}>
          <Text className="type-caption text-muted">Reply from the gym</Text>
          <Text className="type-body text-ink">{r.reply.text}</Text>
        </View>
      )}
    </View>
  );
}
