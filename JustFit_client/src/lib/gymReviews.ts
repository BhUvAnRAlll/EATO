import type { HideReason, ReviewSummary } from "@/lib/discoverApi";

// Gym reviews' words (Gym Profile phase 4, 2026-11-09; pure, unit-tested): used by the member's gym
// page, the review sheet and the gym's Reviews screen. The limits match JustFit_server/gym/reviewRules.js.
export const COMMENT_MAX = 500;
export const REPLY_MAX = 500;

export const HIDE_REASONS: { id: HideReason; label: string }[] = [
  { id: "abusive", label: "Abusive or offensive" },
  { id: "spam", label: "Spam or advertising" },
  { id: "personal", label: "Shares personal details" },
  { id: "not_member", label: "Not about this gym" },
  { id: "other", label: "Something else" },
];
export const hideReasonText = (id: HideReason | null) => HIDE_REASONS.find((r) => r.id === id)?.label ?? "Hidden";

// The five rating words a member picks from (1 to 5 stars)
export const STAR_WORDS = ["Poor", "Below average", "Good", "Very good", "Excellent"];
export const starWord = (rating: number) => STAR_WORDS[rating - 1] ?? "";

// "4.3", "4.0"; no reviews: null
export const averageText = (average: number | null) => (average === null ? null : average.toFixed(1));
// "1 review", "12 reviews"
export const countText = (count: number) => `${count.toLocaleString("en-IN")} ${count === 1 ? "review" : "reviews"}`;
// For a screen reader: "Rated 4.3 out of 5 from 12 reviews"
export const ratingLabel = (summary: ReviewSummary) =>
  summary.count === 0 ? "No reviews yet" : `Rated ${averageText(summary.average)} out of 5 from ${countText(summary.count)}`;

// Each number of stars as a share of every review (0 to 1), 5 first, for the bars
export function starShares(summary: ReviewSummary): { stars: number; count: number; share: number }[] {
  return [5, 4, 3, 2, 1].map((stars) => {
    const count = summary.counts[String(stars) as keyof ReviewSummary["counts"]] ?? 0;
    return { stars, count, share: summary.count ? count / summary.count : 0 };
  });
}

// When a review was written or changed, in India's calendar: "Today", "Yesterday", "3 Nov 2026"
export function reviewDateText(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const india = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
  const day = india(new Date(iso).getTime());
  if (day === india(now)) return "Today";
  if (day === india(now - 86400000)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}
