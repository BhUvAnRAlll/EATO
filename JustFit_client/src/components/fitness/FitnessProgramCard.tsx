import { memo } from "react";
import { Text, View, type DimensionValue } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { CARD_SIZE, type CardVariant } from "@/data/fitness";
import { LEVEL_TEXT, programMeta, type ProgramCardData } from "@/lib/fitnessApi";
import { useThemeColors } from "@/theme";

type FitnessProgramCardProps = {
  program: ProgramCardData;
  variant: CardVariant;
  onOpen: (program: ProgramCardData) => void;
  // A grid cell's width (a category's screen); the height keeps the variant's proportions
  width?: number;
};

// One program on the Fitness tab: the gradient art with its symbol, the level, the title, the
// subtitle (posters and wide cards) and "3 sessions · 20–25 min" with a small icon. A wide card
// (Dance, Workplace) shows an Explore button; the whole card opens the program either way.
// A card with the admin's cover photo shows only the photo: covers carry their own title and
// artwork, so nothing is written over them (screen readers still hear the whole card).
// Every program is free.
function FitnessProgramCardBase({ program, variant, onOpen, width }: FitnessProgramCardProps) {
  const colors = useThemeColors();
  const size = CARD_SIZE[variant];
  const big = variant === "poster";
  const photoOnly = Boolean(program.coverUrl);
  const style: { width: DimensionValue; height: DimensionValue } = width ? { width, height: Math.round((width * size.height) / size.width) } : size;
  // A narrow grid cell (small phones) leaves out the program's symbol and the meta's icon, so the
  // level pill and "3 sessions · 20 min" fit
  const narrow = (width ?? size.width) < 160;
  return (
    <PressableScale
      scaleTo={0.98}
      onPress={() => onOpen(program)}
      className="fitness-card"
      style={style}
      accessibilityRole="button"
      accessibilityLabel={`${program.title}. ${program.subtitle}. ${LEVEL_TEXT[program.level]}, ${programMeta(program)}. Free. Open`}
    >
      <ProgramArt palette={program.palette} icon={program.icon} iconSize={big ? 64 : variant === "wide" ? 52 : narrow ? 0 : 34} id={`${variant}-${program.id}${width ? "-grid" : ""}`} coverUrl={program.coverUrl} shade={!photoOnly} />
      {!photoOnly && (
        <>
          <View className="fitness-card__pill">
            <Text className="fitness-card__pill-label">{LEVEL_TEXT[program.level]}</Text>
          </View>
          <View className="fitness-card__body">
            <Text className={big ? "fitness-card__title fitness-card__title--big" : "fitness-card__title"} numberOfLines={2}>{program.title}</Text>
            {variant !== "tile" && program.subtitle ? <Text className="fitness-card__meta" numberOfLines={1}>{program.subtitle}</Text> : null}
            <View className="flex-row items-center" style={{ gap: 6 }}>
              {!narrow && <SymbolView name={variant === "tile" ? { ios: "play.rectangle", android: "smart_display", web: "smart_display" } : { ios: "calendar", android: "calendar_today", web: "calendar_today" }} size={13} tintColor={colors.white} />}
              <Text className="fitness-card__meta min-w-0 flex-1" numberOfLines={1}>{programMeta(program)}</Text>
            </View>
            {variant === "wide" && (
              <View className="fitness-explore">
                <Text className="fitness-explore__label">Explore</Text>
                <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={13} tintColor={colors.forestInk} />
              </View>
            )}
          </View>
        </>
      )}
    </PressableScale>
  );
}

export const FitnessProgramCard = memo(FitnessProgramCardBase);
