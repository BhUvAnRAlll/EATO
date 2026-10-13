import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useUser } from "@clerk/expo";

import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { SelectSheet } from "@/components/setup/SelectSheet";
import { SetupField } from "@/components/setup/SetupField";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { genderOptions } from "@/data/setup";
import { ageFromDob, dobLimits, formatDob, parseDob, toDobString } from "@/lib/date";
import { useSetupStore } from "@/store/setup";

export default function PersonalDetails() {
  const { user } = useUser();
  const { profile, update } = useSetupStore();
  const [isGenderOpen, setIsGenderOpen] = useState(false);
  const [isDobOpen, setIsDobOpen] = useState(false);
  const { minimumDate, maximumDate } = dobLimits();

  // Start with the name and email from the account
  useEffect(() => {
    if (!user) return;
    const { fullName, email } = useSetupStore.getState().profile;
    update({
      fullName: fullName || user.fullName || "",
      email: email || user.primaryEmailAddress?.emailAddress || "",
    });
  }, [user, update]);

  const age = ageFromDob(profile.dob);
  const canContinue =
    profile.fullName.trim().length > 1 && age !== null && profile.phone.length === 10 && profile.email.includes("@");

  const handleNext = () => {
    // Pre-fill the age on the body step from the date of birth
    if (age !== null) update({ age: String(age) });
    router.push("/setup/goal");
  };

  return (
    <SetupScreen
      step="personal"
      title="Let's get to know you"
      subtitle="Tell us a few details to personalize your experience."
      onNext={handleNext}
      canContinue={canContinue}
    >
      <View className="gap-3">
        <SetupField
          label="Full name"
          icon={{ ios: "person", android: "person", web: "person" }}
          placeholder="Your full name"
          value={profile.fullName}
          onChangeText={(fullName) => update({ fullName })}
          autoCapitalize="words"
          autoComplete="name"
        />
        <SetupField
          label="Date of birth"
          icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
          placeholder="Select your birthday"
          value={formatDob(profile.dob)}
          onPress={() => setIsDobOpen(true)}
          trailingIcon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
        />
        <SetupField
          label="Gender (optional)"
          icon={{ ios: "figure.stand", android: "wc", web: "wc" }}
          placeholder="Select"
          value={genderOptions.find((g) => g.id === profile.gender)?.label ?? ""}
          onPress={() => setIsGenderOpen(true)}
        />
        <SetupField
          label="Mobile number"
          icon={{ ios: "phone", android: "call", web: "call" }}
          prefix="+91"
          placeholder="98765 43210"
          value={profile.phone}
          onChangeText={(text) => update({ phone: text.replace(/\D/g, "").slice(0, 10) })}
          keyboardType="number-pad"
          autoComplete="tel"
        />
        <SetupField
          label="Email address"
          icon={{ ios: "envelope", android: "mail", web: "mail" }}
          placeholder="you@email.com"
          value={profile.email}
          onChangeText={(email) => update({ email: email.trim() })}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>

      <DatePickerSheet
        visible={isDobOpen}
        title="Date of birth"
        value={parseDob(profile.dob) ?? maximumDate}
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        onSelect={(date) => update({ dob: toDobString(date) })}
        onClose={() => setIsDobOpen(false)}
      />

      <SelectSheet
        visible={isGenderOpen}
        title="Gender"
        options={genderOptions}
        selected={profile.gender}
        onSelect={(gender) => update({ gender })}
        onClose={() => setIsGenderOpen(false)}
      />
    </SetupScreen>
  );
}
