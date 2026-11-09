import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";

import { isoToday } from "@/components/admin/AdminPickers";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { kitchenApi, mealImage, type AdminBanner } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
/** "Live · till 15 Nov", "Starts 20 Nov", "Ended 3 Nov", "Off" */
function bannerState(b: AdminBanner) {
  const today = isoToday();
  if (!b.active) return "Off";
  if (b.live) return b.endsOn ? `Live · till ${day(b.endsOn)}` : "Live";
  if (b.startsOn && b.startsOn > today) return `Starts ${day(b.startsOn)}`;
  if (b.endsOn && b.endsOn < today) return `Ended ${day(b.endsOn)}`;
  return "Off";
}

// Super Admin › Meals › Banners: the Meals tab's carousel slides in their order, each with when
// it shows. Tap one to edit it; New banner adds one.
export default function AdminBanners() {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const { result, retry, refresh } = useGymData(kitchenApi.banners);
  const banners = result.state === "ready" ? result.data.banners : [];
  const openNew = () => router.push({ pathname: "/admin/meals/banners/[id]", params: { id: "new" } });
  return (
    <AdminScreen title="Banners" onRefresh={refresh}>
      <View style={{ gap: 14 }}>
        <Pressable onPress={openNew} className="btn-forest" accessibilityRole="button">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.onPrimary} />
          <Text className="btn-forest__label">New banner</Text>
        </Pressable>
        {result.state === "loading" && <ScreenSkeleton label="Loading banners" />}
        {result.state === "failed" && <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load banners" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />}
        {result.state === "ready" && banners.length === 0 && (
          <DashedBlock icon={{ ios: "photo.on.rectangle", android: "view_carousel", web: "view_carousel" }} title="No banners yet" text="Add a slide like “Specials of the Week” with a photo, dates and where its button goes." onPress={openNew} />
        )}
        {banners.map((b) => (
          <Pressable key={b.id} onPress={() => router.push({ pathname: "/admin/meals/banners/[id]", params: { id: String(b.id) } })} className="card" style={{ padding: 0, overflow: "hidden", opacity: b.live ? 1 : 0.65 }} accessibilityRole="button" accessibilityLabel={`Edit ${b.title}`}>
            <View style={{ aspectRatio: 16 / 7, backgroundColor: colors.creamDeep }}>
              {b.imageUrl && <Image source={mealImage(b.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} />}
            </View>
            <View style={{ padding: 12, gap: 2 }}>
              <Text className="card__title" numberOfLines={1}>{b.title}</Text>
              <Text className="meta-text" numberOfLines={1}>{`${bannerState(b)} · ${b.ctaLabel} → ${b.target.kind === "tag" ? "a tag" : b.target.kind}`}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </AdminScreen>
  );
}
