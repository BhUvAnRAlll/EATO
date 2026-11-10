import { Linking, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { LEGAL_DOCS, LEGAL_UPDATED, isLegalDoc } from "@/data/legal";

// /legal/terms and /legal/privacy: the Terms & Conditions and the Privacy Policy (text in
// data/legal.ts). Outside every role's guard, so they open signed in or out: from sign-in,
// sign-up, checkout, Profile, the gym portal and the Super Admin.
export default function LegalScreen() {
  const insets = useSafeAreaInsets();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const id = isLegalDoc(doc) ? doc : null;
  const content = id ? LEGAL_DOCS[id] : null;
  const other = id === "terms" ? "privacy" : "terms";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
        <ScreenHeader title={content?.title ?? "justFit"} />
        {!content ? (
          <View className="px-4 pt-4">
            <EmptyState icon={{ ios: "doc.text", android: "description", web: "description" }} title="Page not found" message="This page doesn't exist." />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 + insets.bottom, gap: 16 }} showsVerticalScrollIndicator={false}>
            <View className="card" style={{ gap: 8 }}>
              <Text className="type-caption text-muted">{`Last updated ${LEGAL_UPDATED}`}</Text>
              <Text className="type-body text-ink">{content.intro}</Text>
            </View>

            {content.sections.map((section) => (
              <View key={section.heading} style={{ gap: 6 }}>
                <Text className="type-headline text-ink" accessibilityRole="header">{section.heading}</Text>
                {section.paragraphs.map((paragraph, index) => (
                  <Text key={index} className="type-body text-muted">{paragraph}</Text>
                ))}
                {section.links?.map((link) => (
                  <Text key={link.url} className="type-body auth__note-link" onPress={() => Linking.openURL(link.url).catch(() => {})} accessibilityRole="link">
                    {link.label}
                  </Text>
                ))}
              </View>
            ))}

            <Text className="type-body auth__note-link text-center" onPress={() => router.replace(`/legal/${other}`)} accessibilityRole="link">
              {`Read our ${LEGAL_DOCS[other].title}`}
            </Text>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
