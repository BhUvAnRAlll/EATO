import { memo, useCallback } from "react";
import { FlatList, View, type ListRenderItem } from "react-native";

import { FitnessProgramCard } from "@/components/fitness/FitnessProgramCard";
import { CARD_SIZE, type CardVariant } from "@/data/fitness";
import { useResponsive } from "@/lib/responsive";
import type { ProgramCardData } from "@/lib/fitnessApi";

type ProgramCarouselProps = {
  programs: ProgramCardData[];
  variant: CardVariant;
  onOpen: (program: ProgramCardData) => void;
};

const GAP = 12;
const Gap = () => <View style={{ width: GAP }} />;

// A horizontal row of program cards that snaps card by card. Fixed card sizes let the list skip
// measuring (getItemLayout), and the cards are memoised, so scrolling the page or a row doesn't
// redraw the others. The row scrolls sideways only, so it never fights the page's vertical scroll.
// A section with one program shows it as a wide card across the page instead of one card and an
// empty half row.
function ProgramCarouselBase({ programs, variant, onOpen }: ProgramCarouselProps) {
  const width = CARD_SIZE[variant].width;
  const { width: screenWidth } = useResponsive();
  const renderItem = useCallback<ListRenderItem<ProgramCardData>>(({ item }) => <FitnessProgramCard program={item} variant={variant} onOpen={onOpen} />, [variant, onOpen]);
  if (programs.length === 1) {
    return (
      <View className="px-4">
        <FitnessProgramCard program={programs[0]} variant="wide" onOpen={onOpen} width={Math.min(screenWidth - 32, 560)} />
      </View>
    );
  }
  return (
    <FlatList
      horizontal
      data={programs}
      keyExtractor={(p) => p.id}
      renderItem={renderItem}
      ItemSeparatorComponent={Gap}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16 }}
      snapToInterval={width + GAP}
      decelerationRate="fast"
      getItemLayout={(_, index) => ({ length: width + GAP, offset: (width + GAP) * index, index })}
      initialNumToRender={3}
      windowSize={5}
      nestedScrollEnabled
    />
  );
}

export const ProgramCarousel = memo(ProgramCarouselBase);
