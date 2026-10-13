import { Text, View } from "react-native";
import { router } from "expo-router";

import { Chip } from "@/components/setup/Chip";
import { OptionCard } from "@/components/setup/OptionCard";
import { SetupField } from "@/components/setup/SetupField";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { cuisineOptions, dietOptions } from "@/data/setup";
import { useSetupStore } from "@/store/setup";

export default function FoodPreferences() {
  const { profile, update, toggleCuisine } = useSetupStore();

  return (
    <SetupScreen
      step="food"
      title="Food preferences"
      subtitle="Help us plan meals that suit your taste and dietary needs."
      onNext={() => router.push("/setup/lifestyle")}
      canContinue={profile.diet !== null}
    >
      <Text className="setup__section">Diet type</Text>
      <View className="mt-2.5 gap-2.5">
        {[dietOptions.slice(0, 2), dietOptions.slice(2)].map((row, i) => (
          <View key={i} className="flex-row gap-2.5">
            {row.map((diet) => (
              <OptionCard
                key={diet.id}
                layout="tile"
                label={diet.label}
                icon={diet.icon}
                selected={profile.diet === diet.id}
                onPress={() => update({ diet: diet.id })}
              />
            ))}
          </View>
        ))}
      </View>

      <Text className="setup__section mt-6">
        Preferred cuisines <Text className="setup__optional">(optional)</Text>
      </Text>
      <View className="mt-2.5 flex-row flex-wrap gap-2">
        {cuisineOptions.map((cuisine) => (
          <Chip
            key={cuisine}
            label={cuisine}
            selected={profile.cuisines.includes(cuisine)}
            onPress={() => toggleCuisine(cuisine)}
          />
        ))}
      </View>

      <View className="mt-6 gap-3">
        <SetupField
          label="Foods you dislike (optional)"
          icon={{ ios: "hand.thumbsdown", android: "thumb_down", web: "thumb_down" }}
          placeholder="e.g. mushrooms, brinjal"
          value={profile.dislikes}
          onChangeText={(dislikes) => update({ dislikes })}
        />
        <SetupField
          label="Allergies / avoid (optional)"
          icon={{ ios: "exclamationmark.shield", android: "warning", web: "warning" }}
          placeholder="e.g. nuts, gluten, dairy"
          value={profile.allergies}
          onChangeText={(allergies) => update({ allergies })}
        />
      </View>
    </SetupScreen>
  );
}
