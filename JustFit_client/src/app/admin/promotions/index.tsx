import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { AdminButton, AdminScreen } from "@/components/admin/AdminScreen";
import { PromotionSlide } from "@/components/home/PromotionSlide";
import type { Promotion } from "@/data/home";
import { adminHome, resolveImage } from "@/lib/home";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Badge per status (whole class strings, so Tailwind generates them)
const statusBadge: Record<Promotion["effectiveStatus"], { badge: string; text: string; label: string }> = {
  published: { badge: "badge badge--active", text: "badge__label badge__label--active", label: "Published" },
  scheduled: { badge: "badge badge--booked", text: "badge__label badge__label--booked", label: "Scheduled" },
  ended: { badge: "badge badge--paused", text: "badge__label badge__label--paused", label: "Ended" },
  draft: { badge: "badge badge--pending", text: "badge__label badge__label--pending", label: "Draft" },
  disabled: { badge: "badge badge--expired", text: "badge__label badge__label--expired", label: "Disabled" },
};

// Home Screen & Promotions: every promotion with its status and order, and the actions
// an admin needs (new, edit, preview, publish/disable, reorder, delete with confirmation).
export default function AdminPromotions() {
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const result = await adminHome.listPromotions(await getToken());
    if (result.ok) {
      setPromotions(result.data.promotions);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [getToken]);

  // Reload whenever the list is shown again (after editing a promotion)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Runs one admin call, then refreshes the list
  const run = async (call: (token: string | null) => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await call(await getToken());
    if (!result.ok) setError(result.error ?? "Something went wrong. Please try again.");
    await load();
    setBusy(false);
  };

  const move = (index: number, direction: -1 | 1) => {
    if (!promotions) return;
    const ids = promotions.map((promotion) => promotion.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run((token) => adminHome.reorderPromotions(token, ids));
  };

  const previewWidth = width - 32;

  return (
    <AdminScreen
      title="Home Screen & Promotions"
      headerRight={<AdminButton label="New" variant="primary" onPress={() => router.push("/admin/promotions/new")} />}
    >
      <Pressable onPress={() => router.push("/admin/home-content")} className="card mb-4 flex-row items-center gap-3" accessibilityRole="button">
        <View className="card__icon">
          <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={20} tintColor={colors.forest} />
        </View>
        <View className="flex-1">
          <Text className="card__title">Home screen settings</Text>
          <Text className="card__subtitle">Section labels, quick actions and popular meals</Text>
        </View>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
      </Pressable>

      <Text className="setup__section mb-2">Promotions</Text>
      <Text className="admin__hint mb-3">Members see published promotions inside their dates, in this order. Changes reach the app on its next refresh.</Text>

      {error && (
        <View className="mb-3">
          <FormAlert message={error} />
        </View>
      )}

      {promotions === null ? (
        <ActivityIndicator color={colors.forest} className="mt-6" />
      ) : promotions.length === 0 ? (
        <View className="home__empty mx-0">
          <Text className="card__title">No promotions yet</Text>
          <Text className="placeholder__text">Tap New to create the first hero slide.</Text>
        </View>
      ) : (
        <View className="gap-3">
          {promotions.map((promotion, index) => {
            const badge = statusBadge[promotion.effectiveStatus] ?? statusBadge.draft;
            const published = promotion.status === "published";
            return (
              <View key={promotion.id} className="admin__row gap-3">
                <View className="flex-row items-center gap-3">
                  <Image source={resolveImage(promotion.imageUrl)} contentFit="cover" contentPosition={promotion.imagePosition === "left" ? "left" : "right"} style={{ width: 56, height: 56, borderRadius: 12 }} />
                  <View className="flex-1">
                    <Text className="card__title" numberOfLines={1}>
                      {promotion.title}
                    </Text>
                    <Text className="card__subtitle" numberOfLines={1}>
                      {promotion.headline}
                    </Text>
                    <View className="mt-1 flex-row items-center gap-2">
                      <View className={badge.badge}>
                        <Text className={badge.text}>{badge.label}</Text>
                      </View>
                      <Text className="admin__hint">
                        #{index + 1} · {promotion.rotationIntervalSeconds}s
                      </Text>
                    </View>
                  </View>
                  <View className="gap-1">
                    <Pressable onPress={() => move(index, -1)} disabled={busy || index === 0} hitSlop={6} accessibilityRole="button" accessibilityLabel="Move up" style={{ opacity: index === 0 ? 0.3 : 1 }}>
                      <SymbolView name={{ ios: "chevron.up", android: "arrow_upward", web: "arrow_upward" }} size={18} tintColor={colors.forestInk} />
                    </Pressable>
                    <Pressable onPress={() => move(index, 1)} disabled={busy || index === promotions.length - 1} hitSlop={6} accessibilityRole="button" accessibilityLabel="Move down" style={{ opacity: index === promotions.length - 1 ? 0.3 : 1 }}>
                      <SymbolView name={{ ios: "chevron.down", android: "arrow_downward", web: "arrow_downward" }} size={18} tintColor={colors.forestInk} />
                    </Pressable>
                  </View>
                </View>

                {previewId === promotion.id && (
                  <View className="admin__preview">
                    <PromotionSlide promotion={promotion} width={previewWidth} height={Math.round(previewWidth * 0.6)} />
                  </View>
                )}

                {confirmDeleteId === promotion.id ? (
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="type-callout flex-1 text-danger">Delete this promotion?</Text>
                    <AdminButton label="Cancel" onPress={() => setConfirmDeleteId(null)} disabled={busy} />
                    <AdminButton
                      label="Delete"
                      variant="danger"
                      disabled={busy}
                      onPress={() => {
                        setConfirmDeleteId(null);
                        run((token) => adminHome.deletePromotion(token, promotion.id));
                      }}
                    />
                  </View>
                ) : (
                  <View className="flex-row flex-wrap gap-2">
                    <AdminButton label="Edit" onPress={() => router.push(`/admin/promotions/${promotion.id}`)} disabled={busy} />
                    <AdminButton label={previewId === promotion.id ? "Hide preview" : "Preview"} onPress={() => setPreviewId(previewId === promotion.id ? null : promotion.id)} />
                    <AdminButton
                      label={published ? "Disable" : "Publish"}
                      variant={published ? "default" : "primary"}
                      disabled={busy}
                      onPress={() => run((token) => adminHome.setPromotionStatus(token, promotion.id, published ? "disable" : "publish"))}
                    />
                    <AdminButton label="Delete" variant="danger" onPress={() => setConfirmDeleteId(promotion.id)} disabled={busy} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </AdminScreen>
  );
}
