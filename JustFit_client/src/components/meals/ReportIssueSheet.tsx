import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";

import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { PressableScale } from "@/components/PressableScale";
import { ISSUE_CATEGORY_LABEL } from "@/data/issues";
import { pickCatalogImage, type MemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import { issuesApi, type Issue, type IssueCategory } from "@/lib/issuesApi";
import { showActions } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

// Report a problem with an order or the meal plan (Meal Operations phase 6): what went wrong, what
// happened (10-600 characters) and an optional photo (camera or gallery). justFit's team sees it and
// answers on the order or plan.
export function ReportIssueSheet({ target, categories, onSent, onClose }: {
  target: { orderId: string } | { subscriptionId: string };
  categories: IssueCategory[];
  onSent: (issue: Issue) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [category, setCategory] = useState<IssueCategory>(categories[0]);
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<MemberPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = description.trim().length >= 10;

  const choosePhoto = () => {
    const pick = async (source: PhotoSource) => {
      const picked = await pickCatalogImage(source);
      if (picked.ok) setPhoto(picked.photo);
      else if (!("cancelled" in picked)) setError(picked.error);
    };
    showActions({
      title: "Add a photo",
      actions: [
        ...(Platform.OS === "web" ? [] : [{ label: "Take photo", onPress: () => pick("camera") }]),
        { label: "Choose from gallery", onPress: () => pick("library") },
        ...(photo ? [{ label: "Remove photo", destructive: true, onPress: () => setPhoto(null) }] : []),
      ],
    });
  };

  const send = async (dismiss: () => void) => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    const answer = await issuesApi.send(await getToken(), { ...target, category, description: description.trim(), ...(photo ? { photo: { data: photo.data, mediaType: photo.mediaType } } : {}) });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    onSent(answer.data.issue);
    dismiss();
  };

  return (
    <BottomSheet onClose={onClose} locked={busy}>
      {(dismiss) => (
        <KeyboardAvoider fill={false}>
          <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text className="type-headline text-forest-ink">Report a problem</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {categories.map((c) => {
                const on = c === category;
                return (
                  <PressableScale key={c} haptic="select" onPress={() => setCategory(c)} className={on ? "meal-chip meal-chip--on" : "meal-chip"} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={ISSUE_CATEGORY_LABEL[c]}>
                    <Text className={on ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{ISSUE_CATEGORY_LABEL[c]}</Text>
                  </PressableScale>
                );
              })}
            </View>
            <TextInput
              className="admin__input"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={600}
              placeholder="Tell us what happened"
              placeholderTextColor={colors.faint}
              style={{ minHeight: 96, textAlignVertical: "top" }}
              accessibilityLabel="What happened"
            />
            <Pressable onPress={choosePhoto} className="flex-row items-center" style={{ gap: 10 }} accessibilityRole="button">
              {photo ? <Image source={{ uri: photo.previewUri }} contentFit="cover" style={{ width: 56, height: 56, borderRadius: 10 }} /> : null}
              <Text className="meal-link">{photo ? "Change photo" : "Add a photo (optional)"}</Text>
            </Pressable>
            {error ? <FormAlert message={error} /> : null}
            <PressableScale haptic="tap" onPress={() => send(dismiss)} disabled={!ready || busy} className="sub-cta" style={!ready ? { opacity: 0.5 } : undefined} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.white} /> : null}
              <Text className="sub-cta__label">Send</Text>
            </PressableScale>
          </ScrollView>
        </KeyboardAvoider>
      )}
    </BottomSheet>
  );
}
