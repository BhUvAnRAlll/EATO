import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useUser } from "@clerk/expo";

import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { SelectSheet } from "@/components/setup/SelectSheet";
import { SetupField } from "@/components/setup/SetupField";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { genderOptions } from "@/data/setup";
import { ageFromDob, dobLimits, formatDob, parseDob, toDobString } from "@/lib/date";
import { inRange, toNumberText } from "@/lib/numberInput";
import { useSetupStore } from "@/store/setup";

export default function PersonalDetails() {
  const { user } = useUser();
  const { profile, update } = useSetupStore();
  const [isGenderOpen, setIsGenderOpen] = useState(false);
  const [isDobOpen, setIsDobOpen] = useState(false);
  const { minimumDate, maximumDate } = dobLimits();

  // The email is the account's and can't be changed here: the server saves the address
  // Clerk holds for the signed-in user, whatever the app sends
  const accountEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  // Start with the name from the account; the email always mirrors the account
  useEffect(() => {
    if (!user) return;
    const { fullName } = useSetupStore.getState().profile;
    update({ fullName: fullName || user.fullName || "", email: accountEmail });
  }, [user, accountEmail, update]);

  const age = ageFromDob(profile.dob);
  const canContinue =
    profile.fullName.trim().length > 1 &&
    age !== null &&
    inRange(profile.heightCm, 100, 250) &&
    inRange(profile.weightKg, 30, 300) &&
    profile.phone.length === 10 &&
    profile.email.includes("@");

  const handleNext = () => {
    // The age the targets use comes from the date of birth
    if (age !== null) update({ age: String(age) });
    router.push("/setup/body-composition");
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
        {age !== null && <Text className="setup__card-text -mt-1.5 px-1">{`Age ${age}`}</Text>}
        <SetupField
          label="Height"
          icon={{ ios: "ruler", android: "height", web: "height" }}
          unit="cm"
          placeholder="170"
          value={profile.heightCm}
          onChangeText={(text) => update({ heightCm: toNumberText(text) })}
          keyboardType="number-pad"
        />
        <SetupField
          label="Gender (optional)"
          icon={{ ios: "figure.stand", android: "wc", web: "wc" }}
          placeholder="Select"
          value={genderOptions.find((g) => g.id === profile.gender)?.label ?? ""}
          onPress={() => setIsGenderOpen(true)}
        />
        <SetupField
          label="Current weight"
          icon={{ ios: "scalemass", android: "scale", web: "scale" }}
          unit="kg"
          placeholder="70"
          value={profile.weightKg}
          onChangeText={(text) => update({ weightKg: toNumberText(text, true) })}
          keyboardType="decimal-pad"
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
        <View className="gap-1.5">
          <SetupField
            label="Email address"
            icon={{ ios: "envelope", android: "mail", web: "mail" }}
            placeholder="Not available on your account"
            value={accountEmail}
            readOnly
            trailingIcon={{ ios: "lock.fill", android: "lock", web: "lock" }}
          />
          <Text className="setup__card-text px-1">
            {accountEmail ? "From your account. It can't be changed here." : "Your account has no email address, so setup can't be finished yet."}
          </Text>
        </View>
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
