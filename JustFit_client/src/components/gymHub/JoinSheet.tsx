import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SymbolView } from "@/components/SymbolView";
import { discoverApi, type JoinRequest } from "@/lib/discoverApi";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

const NOTE_MAX = 200;
export type JoinPick = { itemId: number | null; label: string | null };

// Gym Hub › a gym › Ask to join (phase 4, 2026-11-09): the member asks the gym to call them about
// a plan (or just about joining). The request goes to the gym's Enquiries with the member's name and
// number from their account; there is no payment. A short optional message (a good time to call).
// Once sent, the sheet says so and the gym's page shows the request.
export function JoinSheet({ gymId, gymName, pick, onClose, onSent }: { gymId: number; gymName: string; pick: JoinPick; onClose: () => void; onSent: (request: JoinRequest) => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const user = useAuthStore((state) => state.user);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  // A ref, so a double tap can't send two requests (busy is state, set a frame later)
  const sending = useRef(false);

  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const answer = await discoverApi.ask(await getToken().catch(() => null), gymId, { itemId: pick.itemId, note });
    setBusy(false);
    sending.current = false;
    if (!answer.ok) return setError(answer.error);
    hud.success("Request sent");
    setSent(true);
    onSent(answer.data.request);
  };

  return (
    <BottomSheet onClose={onClose} locked={busy}>
      {(dismiss) => (
        <KeyboardAvoider fill={false}>
        <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {sent ? (
            <>
              <View className="items-center" style={{ gap: 8 }}>
                <View className="card__icon" style={{ backgroundColor: colors.accentSoft }}>
                  <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={22} tintColor={colors.leaf} />
                </View>
                <Text className="type-headline text-forest-ink text-center">Request sent</Text>
                <Text className="meta-text text-center">{`${gymName} will call you${user?.phone ? ` on +91 ${user.phone}` : ""} to help you join. Nothing is charged in the app.`}</Text>
              </View>
              <PrimaryButton label="Done" onPress={dismiss} />
            </>
          ) : (
            <>
              <View className="gap-1">
                <Text className="type-headline text-forest-ink">{`Ask ${gymName} to call you`}</Text>
                <Text className="meta-text">{pick.label ? `About ${pick.label}` : "About joining the gym"}</Text>
              </View>
              <View className="card" style={{ gap: 6, padding: 14 }}>
                <Text className="type-caption text-muted">The gym will see</Text>
                <Text className="type-body text-ink">{user?.fullName?.trim() || "Your name"}</Text>
                <Text className="type-body text-ink">{user?.phone ? `+91 ${user.phone}` : "Your mobile number"}</Text>
                {pick.label ? <Text className="type-caption text-muted">{pick.label}</Text> : null}
              </View>
              <View className="gap-2">
                <Text className="type-subhead text-forest-ink">Message (optional)</Text>
                <View className="setup__field" style={{ minHeight: 88, alignItems: "flex-start", paddingVertical: 10 }}>
                  <TextInput
                    value={note}
                    onChangeText={(t) => setNote(t.slice(0, NOTE_MAX))}
                    placeholder="Eg. Please call after 6 pm. Is there a trial?"
                    placeholderTextColor={colors.faint}
                    multiline
                    maxLength={NOTE_MAX}
                    textAlignVertical="top"
                    style={{ flex: 1, alignSelf: "stretch", minHeight: 68, fontFamily: "Poppins-Regular", fontSize: 14, color: colors.ink, paddingVertical: 0 }}
                    accessibilityLabel="Message for the gym"
                  />
                </View>
                <Text className="type-caption text-muted">{`${note.trim().length} of ${NOTE_MAX}`}</Text>
              </View>
              {error ? <FormAlert message={error} /> : null}
              <PrimaryButton label="Send request" onPress={send} loading={busy} />
              <Text className="type-caption text-muted text-center">No payment here. You pay the gym when you join.</Text>
              <Pressable onPress={dismiss} disabled={busy} className="self-center" hitSlop={10} accessibilityRole="button">
                <Text className="auth__note-link">Not now</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
        </KeyboardAvoider>
      )}
    </BottomSheet>
  );
}
