import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { ScreenSkeleton } from "@/components/Skeleton";
import { AdminButton, AdminScreen } from "@/components/admin/AdminScreen";
import { ReorderButtons } from "@/components/admin/ReorderButtons";
import { PromotionSlide } from "@/components/home/PromotionSlide";
import type { Promotion } from "@/data/home";
import { adminHome, resolveImage } from "@/lib/home";
import { useResponsive } from "@/lib/responsive";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

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
// `tab` when it is the Content tab's root (no back arrow).
export default function AdminPromotions({ tab = false }: { tab?: boolean }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { width } = useResponsive();
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

  // The screen's gutter (16 each side) and the row's padding (12 each side)
  const previewWidth = width - 32 - 24;

  return (
    <AdminScreen
      title="Home Screen & Promotions"
      headerRight={<AdminButton label="New" variant="primary" onPress={() => router.push("/admin/promotions/new")} />}
      onRefresh={load}
      hideBack={tab}
    >
      <Pressable onPress={() => router.push("/admin/home-content")} className="card mb-4 flex-row items-center gap-3" accessibilityRole="button">
        <View className="card__icon">
          <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={20} tintColor={colors.leaf} />
        </View>
        <View className="flex-1">
          <Text className="card__title">Home screen settings</Text>
          <Text className="card__subtitle">Section labels, quick actions and popular meals</Text>
        </View>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
      </Pressable>

      <Text className="admin-section__title mb-2">Promotions</Text>
      <Text className="admin__hint mb-3">Members see published promotions inside their dates, in this order. Changes reach the app on its next refresh.</Text>

      {error && (
        <View className="mb-3">
          <FormAlert message={error} />
        </View>
      )}

      {promotions === null ? (
        error ? (
          <AdminButton label="Try again" onPress={load} />
        ) : (
          <ScreenSkeleton label="Loading promotions" />
        )
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
                    <Text className="card__title" numberOfLines={2}>
                      {promotion.title}
                    </Text>
                    <Text className="card__subtitle" numberOfLines={2}>
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
                  <ReorderButtons direction="column" onUp={() => move(index, -1)} onDown={() => move(index, 1)} first={index === 0} last={index === promotions.length - 1} disabled={busy} label={promotion.title} />
                </View>

                {previewId === promotion.id && (
                  <View className="admin__preview">
                    <PromotionSlide promotion={promotion} width={previewWidth} height={Math.round(previewWidth * 0.6)} />
                  </View>
                )}

                {confirmDeleteId === promotion.id ? (
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="type-callout flex-1 text-danger" style={{ minWidth: 120 }}>Delete this promotion?</Text>
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
                  // One line on every phone: three equal actions, and Delete as a round bin
                  <View className="flex-row items-center gap-2">
                    <AdminButton grow label="Edit" onPress={() => router.push(`/admin/promotions/${promotion.id}`)} disabled={busy} />
                    <AdminButton grow label={previewId === promotion.id ? "Hide" : "Preview"} onPress={() => setPreviewId(previewId === promotion.id ? null : promotion.id)} />
                    <AdminButton
                      grow
                      label={published ? "Disable" : "Publish"}
                      variant={published ? "default" : "primary"}
                      disabled={busy}
                      onPress={() => run((token) => adminHome.setPromotionStatus(token, promotion.id, published ? "disable" : "publish"))}
                    />
                    <Pressable
                      onPress={() => setConfirmDeleteId(promotion.id)}
                      disabled={busy}
                      hitSlop={4}
                      className="admin__action admin__action--danger"
                      style={{ width: 36, paddingHorizontal: 0 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${promotion.title}`}
                    >
                      <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={16} tintColor={colors.danger} />
                    </Pressable>
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
