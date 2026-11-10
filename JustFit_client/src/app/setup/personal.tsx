import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { SelectSheet } from "@/components/setup/SelectSheet";
import { SetupField } from "@/components/setup/SetupField";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { genderOptions } from "@/data/setup";
import { goHome } from "@/lib/auth";
import { ageFromDob, dobLimits, formatDob, parseDob, toDobString } from "@/lib/date";
import { EMAIL_MAX, isValidEmail } from "@/lib/email";
import { inRange, toNumberText } from "@/lib/numberInput";
import { formatIndianMobile } from "@/lib/phone";
import { saveProfile } from "@/lib/profile";
import { SESSION_EXPIRED_MESSAGE, isSessionExpired, returnToSignIn, useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useSetupStore } from "@/store/setup";

// Setup's one screen (since 2026-11-10, the user's choice): the personal details, saved with
// Finish. Goal, activity, the health check and food come later, in the AI Coach intake or
// Profile; Home and Macro show "Finish your profile" until the targets exist.
export default function PersonalDetails() {
  const user = useAuthStore((state) => state.user);
  const getToken = useSessionToken();
  const { profile, update, reset } = useSetupStore();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isGenderOpen, setIsGenderOpen] = useState(false);
  const [isDobOpen, setIsDobOpen] = useState(false);
  const { minimumDate, maximumDate } = dobLimits();

  // The mobile number is the one this account signs in with and can't be changed here (the
  // server keeps its own copy whatever the app sends). The email is optional: a contact address,
  // never checked and never used to sign in
  const accountPhone = (user?.phone ?? "").replace(/^\+91/, "");
  const accountEmail = user?.email ?? "";

  // Start with the name and email from the account; the number always mirrors the account
  useEffect(() => {
    if (!user) return;
    const { fullName, email } = useSetupStore.getState().profile;
    update({ fullName: fullName || user.fullName || "", phone: accountPhone, email: email || accountEmail });
  }, [user, accountPhone, accountEmail, update]);

  const email = profile.email.trim();
  const emailOk = email === "" || isValidEmail(email);

  const age = ageFromDob(profile.dob);
  const canContinue =
    profile.fullName.trim().length > 1 &&
    age !== null &&
    inRange(profile.heightCm, 100, 250) &&
    inRange(profile.weightKg, 30, 300) &&
    profile.phone.length === 10 &&
    emailOk;

  // Saves the personal details (no targets yet); the account is then set up and opens Home.
  // `isSaving` disables the button, so a double tap can't send two requests
  const handleFinish = async () => {
    if (isSaving || age === null) return;
    if (!user) {
      setSessionExpired(true);
      return setError(SESSION_EXPIRED_MESSAGE);
    }
    setError(null);
    setSessionExpired(false);
    setIsSaving(true);
    const saved = await saveProfile(await getToken(), { profile: { ...profile, age: String(age) } });
    setIsSaving(false);
    if (!saved.ok) {
      setSessionExpired(isSessionExpired(saved));
      return setError(isSessionExpired(saved) ? SESSION_EXPIRED_MESSAGE : saved.error);
    }
    useAuthStore.getState().updateUser({ profileComplete: true, fullName: profile.fullName.trim(), email: email.toLowerCase() || null });
    goHome();
    reset();
  };

  return (
    <SetupScreen
      step="personal"
      title="Let's get to know you"
      subtitle="Tell us a few details to personalize your experience."
      onNext={handleFinish}
      nextLabel="Finish"
      canContinue={canContinue}
      loading={isSaving}
    >
      {error && (
        <View className="mb-3">
          <FormAlert message={error} />
          {sessionExpired && (
            <Pressable onPress={() => returnToSignIn()} className="btn-outline mt-3" accessibilityRole="button">
              <Text className="btn-outline__label">Sign in again</Text>
            </Pressable>
          )}
        </View>
      )}
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
          invalid={profile.heightCm !== "" && !inRange(profile.heightCm, 100, 250)}
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
          invalid={profile.weightKg !== "" && !inRange(profile.weightKg, 30, 300)}
        />
        <Text className="setup__card-text -mt-1.5 px-1">Height 100–250 cm, weight 30–300 kg.</Text>
        <View className="gap-1.5">
          <SetupField
            label="Mobile number"
            icon={{ ios: "phone", android: "call", web: "call" }}
            placeholder="+91 98765 43210"
            value={profile.phone ? `+91 ${formatIndianMobile(profile.phone)}` : ""}
            readOnly
            trailingIcon={{ ios: "lock.fill", android: "lock", web: "lock" }}
          />
          <Text className="setup__card-text px-1">The number you log in with. It can&apos;t be changed here.</Text>
        </View>
        <View className="gap-1.5">
          <SetupField
            label="Email (optional)"
            icon={{ ios: "envelope", android: "mail", web: "mail" }}
            placeholder="you@example.com"
            value={profile.email}
            onChangeText={(text) => update({ email: text.replace(/\s/g, "").slice(0, EMAIL_MAX) })}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            maxLength={EMAIL_MAX}
            invalid={!emailOk}
          />
          <Text className="setup__card-text px-1">
            {emailOk ? "For receipts and updates. You still log in with your number." : "Enter a valid email address, or leave it empty."}
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
