import { memo } from "react";
import { Text, View } from "react-native";

import { ProgramCarousel } from "@/components/fitness/ProgramCarousel";
import { SECTION_VARIANT } from "@/data/fitness";
import type { ProgramCardData, ProgramSection } from "@/lib/fitnessApi";

type FitnessCategorySectionProps = {
  section: ProgramSection;
  onOpen: (program: ProgramCardData) => void;
};

// One section of the Fitness tab: its title and a short line under it, then its programs in a
// carousel sized for the section (posters, tiles, or wide cards with Explore for Dance and
// Workplace Wellness). The page's side gutter lives in the carousel, so cards scroll edge to edge.
function FitnessCategorySectionBase({ section, onOpen }: FitnessCategorySectionProps) {
  return (
    <View className="gap-3" accessibilityLabel={section.title}>
      <View className="px-4">
        <Text className="setup__section" accessibilityRole="header">{section.title}</Text>
        <Text className="meta-text">{section.note}</Text>
      </View>
      <ProgramCarousel programs={section.programs} variant={SECTION_VARIANT[section.id]} onOpen={onOpen} />
    </View>
  );
}

export const FitnessCategorySection = memo(FitnessCategorySectionBase);
