import { memo } from "react";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { ProgramCarousel } from "@/components/fitness/ProgramCarousel";
import { SECTION_VARIANT } from "@/data/fitness";
import type { ProgramCardData, ProgramSection } from "@/lib/fitnessApi";
import { useThemeColors } from "@/theme";

type FitnessCategorySectionProps = {
  section: ProgramSection;
  onOpen: (program: ProgramCardData) => void;
  // Opens the category's own screen, every program in a grid
  onSeeAll: (section: ProgramSection) => void;
};

// One section of the Fitness tab: its title and a short line under it with See All on the right,
// then its programs in a carousel sized for the section (posters, tiles, or wide cards with Explore;
// the admin picks each category's layout). The page's side gutter lives in the carousel, so cards
// scroll edge to edge.
function FitnessCategorySectionBase({ section, onOpen, onSeeAll }: FitnessCategorySectionProps) {
  const colors = useThemeColors();
  return (
    <View className="gap-3" accessibilityLabel={section.title}>
      <View className="flex-row items-center gap-3 px-4">
        <View className="min-w-0 flex-1">
          <Text className="fitness-section__title" accessibilityRole="header">{section.title}</Text>
          <Text className="fitness-section__note">{section.note}</Text>
        </View>
        <PressableScale onPress={() => onSeeAll(section)} hitSlop={8} className="flex-row items-center" style={{ gap: 2, paddingVertical: 4 }} accessibilityRole="link" accessibilityLabel={`See all ${section.title}`}>
          <Text className="fitness-section__link">See All</Text>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.primaryText} />
        </PressableScale>
      </View>
      <ProgramCarousel programs={section.programs} variant={section.layout ?? SECTION_VARIANT[section.id] ?? "tile"} onOpen={onOpen} />
    </View>
  );
}

export const FitnessCategorySection = memo(FitnessCategorySectionBase);
