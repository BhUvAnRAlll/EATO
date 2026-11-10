import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SymbolView } from "@/components/SymbolView";
import { discoverApi, type GymReviews, type MyReview } from "@/lib/discoverApi";
import { COMMENT_MAX, hideReasonText, starWord } from "@/lib/gymReviews";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

// Gym Hub › a gym › Write a review (Gym Profile phase 4, 2026-11-09): 1 to 5 stars and optional
// words, saved as the member's one review of the branch (the server checks they are or were a
// member there). An existing review opens to be changed or deleted. Others see the reviewer as
// "Arjun M."; the gym can reply or hide the words, but never change the stars.
export function ReviewSheet({ gymId, gymName, mine, onClose, onSaved }: { gymId: number; gymName: string; mine: MyReview | null; onClose: () => void; onSaved: (reviews: GymReviews) => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A ref, so a double tap can't send twice (busy is state, set a frame later)
  const sending = useRef(false);

  const run = async (work: () => Promise<{ ok: true; data: GymReviews } | { ok: false; error: string }>, done: string, dismiss: () => void) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const answer = await work();
    setBusy(false);
    sending.current = false;
    if (!answer.ok) return setError(answer.error);
    hud.success(done);
    onSaved(answer.data);
    dismiss();
  };
  const save = (dismiss: () => void) => {
    if (rating < 1) return setError("Pick 1 to 5 stars.");
    run(async () => discoverApi.saveReview(await getToken().catch(() => null), gymId, { rating, comment }), mine ? "Review updated" : "Review posted", dismiss);
  };
  const remove = async (dismiss: () => void) => {
    const sure = await confirmChoice({ title: "Delete your review?", message: `Your stars and words leave ${gymName}'s page.`, confirmLabel: "Delete review" });
    if (sure) run(async () => discoverApi.deleteReview(await getToken().catch(() => null), gymId), "Review deleted", dismiss);
  };

  return (
    <BottomSheet onClose={onClose} locked={busy}>
      {(dismiss) => (
        <KeyboardAvoider fill={false}>
          <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View className="gap-1">
              <Text className="type-headline text-forest-ink">{mine ? "Your review" : `Review ${gymName}`}</Text>
              <Text className="meta-text">Others see your first name and initial.</Text>
            </View>
            {mine?.hiddenReason && (
              <View className="card" style={{ padding: 12, backgroundColor: colors.surfaceAlt }}>
                <Text className="type-caption text-ink">{`${gymName} hid your words (${hideReasonText(mine.hiddenReason).toLowerCase()}). Your stars still count, and new words show again.`}</Text>
              </View>
            )}
            <View className="items-center" style={{ gap: 6 }}>
              <View className="flex-row" style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="Your rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <PressableScale
                    key={n}
                    onPress={() => { haptic.select(); setRating(n); setError(""); }}
                    hitSlop={4}
                    style={{ padding: 4 }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: rating === n }}
                    accessibilityLabel={`${n} ${n === 1 ? "star" : "stars"}, ${starWord(n)}`}
                  >
                    <SymbolView name={n <= rating ? "star.fill" : "star"} size={34} tintColor={n <= rating ? colors.warning : colors.lineStrong} />
                  </PressableScale>
                ))}
              </View>
              <Text className="type-subhead text-ink">{rating ? starWord(rating) : "Tap to rate"}</Text>
            </View>
            <View className="gap-2">
              <Text className="type-subhead text-forest-ink">Your review (optional)</Text>
              <View className="setup__field" style={{ minHeight: 108, alignItems: "flex-start", paddingVertical: 10 }}>
                <TextInput
                  value={comment}
                  onChangeText={(t) => setComment(t.slice(0, COMMENT_MAX))}
                  placeholder="What did you like? What could be better?"
                  placeholderTextColor={colors.faint}
                  multiline
                  maxLength={COMMENT_MAX}
                  textAlignVertical="top"
                  style={{ flex: 1, alignSelf: "stretch", minHeight: 88, fontFamily: "Poppins-Regular", fontSize: 14, color: colors.ink, paddingVertical: 0 }}
                  accessibilityLabel="Your review"
                />
              </View>
              <Text className="type-caption text-muted">{`${comment.trim().length} of ${COMMENT_MAX}`}</Text>
            </View>
            {error ? <FormAlert message={error} /> : null}
            <PrimaryButton label={mine ? "Save changes" : "Post review"} onPress={() => save(dismiss)} loading={busy} disabled={rating < 1} />
            {mine ? (
              <Pressable onPress={() => remove(dismiss)} disabled={busy} className="self-center" hitSlop={10} accessibilityRole="button">
                <Text className="type-subhead" style={{ color: colors.danger }}>Delete review</Text>
              </Pressable>
            ) : (
              <Pressable onPress={dismiss} disabled={busy} className="self-center" hitSlop={10} accessibilityRole="button">
                <Text className="auth__note-link">Not now</Text>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoider>
      )}
    </BottomSheet>
  );
}
