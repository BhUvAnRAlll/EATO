import { memo } from "react";
import { Text, View } from "react-native";

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
};

// One program on the Fitness tab: the gradient art with its symbol, the level, the title, the
// subtitle (posters and wide cards) and "3 sessions · 20–25 min". A wide card (Dance, Workplace)
// shows an Explore button; the whole card opens the program either way. Every program is free.
function FitnessProgramCardBase({ program, variant, onOpen }: FitnessProgramCardProps) {
  const colors = useThemeColors();
  const size = CARD_SIZE[variant];
  const big = variant === "poster";
  return (
    <PressableScale
      scaleTo={0.98}
      onPress={() => onOpen(program)}
      className="fitness-card"
      style={size}
      accessibilityRole="button"
      accessibilityLabel={`${program.title}. ${program.subtitle}. ${LEVEL_TEXT[program.level]}, ${programMeta(program)}. Free. Open`}
    >
      <ProgramArt palette={program.palette} icon={program.icon} iconSize={big ? 64 : variant === "wide" ? 52 : 40} id={`${variant}-${program.id}`} />
      <View className="fitness-card__pill">
        <Text className="workout__chip-label">{LEVEL_TEXT[program.level]}</Text>
      </View>
      <View className="fitness-card__body">
        <Text className={big ? "fitness-card__title fitness-card__title--big" : "fitness-card__title"} numberOfLines={2}>{program.title}</Text>
        {variant !== "tile" && program.subtitle ? <Text className="fitness-card__meta" numberOfLines={1}>{program.subtitle}</Text> : null}
        <Text className="fitness-card__meta" numberOfLines={1}>{programMeta(program)}</Text>
        {variant === "wide" && (
          <View className="fitness-explore">
            <Text className="fitness-explore__label">Explore</Text>
            <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={13} tintColor={colors.forestInk} />
          </View>
        )}
      </View>
    </PressableScale>
  );
}

export const FitnessProgramCard = memo(FitnessProgramCardBase);
