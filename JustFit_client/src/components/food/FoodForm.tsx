import { Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { Chip } from "@/components/setup/Chip";
import { OptionCard } from "@/components/setup/OptionCard";
import { SetupField } from "@/components/setup/SetupField";
import { cuisineOptions, dietOptions, mealsPerDayOptions } from "@/data/setup";
import { haptic } from "@/lib/haptics";
import type { FoodAnswers } from "@/lib/profile";
import { useThemeColors } from "@/theme";

// The food answers, asked in the AI Coach intake's Food step and on Profile › Food preferences
// (2026-11-10; setup used to ask them): diet, the food the member usually eats (checkboxes),
// allergies, dislikes and meals per day. Diet and meals per day are required (foodComplete).
export function FoodForm({ value, onChange }: { value: FoodAnswers; onChange: (changes: Partial<FoodAnswers>) => void }) {
  const colors = useThemeColors();
  const toggle = (cuisine: string) => {
    haptic.select();
    onChange({ cuisines: value.cuisines.includes(cuisine) ? value.cuisines.filter((c) => c !== cuisine) : [...value.cuisines, cuisine] });
  };

  return (
    <View className="gap-6">
      <View className="gap-2.5">
        <Text className="setup__section">Diet type</Text>
        {[dietOptions.slice(0, 2), dietOptions.slice(2)].map((row, i) => (
          <View key={i} className="flex-row gap-2.5">
            {row.map((diet) => (
              <OptionCard key={diet.id} layout="tile" label={diet.label} icon={diet.icon} selected={value.diet === diet.id} onPress={() => onChange({ diet: diet.id })} />
            ))}
          </View>
        ))}
      </View>

      <View className="gap-2.5">
        <Text className="setup__section">
          Food you usually eat <Text className="setup__optional">(tick all that apply)</Text>
        </Text>
        <View className="flex-row flex-wrap gap-2.5">
          {cuisineOptions.map((cuisine) => {
            const on = value.cuisines.includes(cuisine);
            return (
              <Pressable
                key={cuisine}
                onPress={() => toggle(cuisine)}
                className={on ? "coach__option coach__option--selected" : "coach__option"}
                style={{ flexBasis: "47%", flexGrow: 1, paddingVertical: 12 }}
                accessibilityRole="checkbox"
                aria-checked={on}
                accessibilityLabel={cuisine}
              >
                <View className={on ? "coach__tick coach__tick--on" : "coach__tick"}>
                  {on && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={13} tintColor={colors.white} />}
                </View>
                <Text className="coach__option-title flex-1">{cuisine}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-3">
        <SetupField
          label="Allergies / avoid (optional)"
          icon={{ ios: "exclamationmark.shield", android: "warning", web: "warning" }}
          placeholder="e.g. nuts, gluten, dairy"
          value={value.allergies}
          onChangeText={(allergies) => onChange({ allergies: allergies.slice(0, 500) })}
        />
        <SetupField
          label="Foods you dislike (optional)"
          icon={{ ios: "hand.thumbsdown", android: "thumb_down", web: "thumb_down" }}
          placeholder="e.g. mushrooms, brinjal"
          value={value.dislikes}
          onChangeText={(dislikes) => onChange({ dislikes: dislikes.slice(0, 500) })}
        />
      </View>

      <View className="gap-2.5">
        <Text className="setup__section">Meals per day</Text>
        <View className="flex-row gap-2">
          {mealsPerDayOptions.map((option) => (
            <Chip key={option.id} grow label={option.label} selected={value.mealsPerDay === option.id} onPress={() => onChange({ mealsPerDay: option.id })} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** Diet and meals per day are needed; the rest is optional */
export const foodComplete = (value: FoodAnswers) => value.diet !== null && value.mealsPerDay !== null;
