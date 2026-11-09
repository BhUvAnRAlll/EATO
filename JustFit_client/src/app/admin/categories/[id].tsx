import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { CategoryForm } from "@/components/admin/CategoryForm";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPrograms, type AdminSection, type SectionFields } from "@/lib/adminPrograms";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";
import { confirmChoice } from "@/lib/nativeSheets";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; section: AdminSection };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/categories"));
const fieldsOf = (s: AdminSection): SectionFields => ({ title: s.title, note: s.note, layout: s.layout, published: s.published });
const sameFields = (a: SectionFields, b: SectionFields) => (Object.keys(a) as (keyof SectionFields)[]).every((k) => a[k] === b[k]);

// Super Admin › Programs › Categories › one category: its name, line, cards and whether members see
// it (Save). A category the admin made can be deleted once no program is in it; the built-in six
// can only be hidden.
export default function AdminCategoryScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [form, setForm] = useState<SectionFields | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // The fields the form was last set from, and the form as it is: a read (coming back, a pull)
  // only replaces the form when nothing has been edited in it
  const saved = useRef<SectionFields | null>(null);
  const formNow = useRef<SectionFields | null>(null);
  const changeForm = (next: SectionFields | null) => {
    formNow.current = next;
    setForm(next);
  };
  const show = (section: AdminSection) => {
    saved.current = fieldsOf(section);
    changeForm(saved.current);
  };

  const refresh = useCallback(async () => {
    const result = await adminPrograms.sections(await getToken().catch(() => null));
    if (!result.ok) return setLoad({ state: "failed", error: result.error });
    const section = result.data.sections.find((s) => s.id === String(id));
    if (!section) return setLoad({ state: "failed", error: "That category doesn't exist." });
    setLoad({ state: "ready", section });
    const edited = formNow.current && saved.current && !sameFields(formNow.current, saved.current);
    if (!edited) {
      saved.current = fieldsOf(section);
      formNow.current = saved.current;
      setForm(saved.current);
    }
  }, [getToken, id]);
  const { refreshControl } = usePullToRefresh(refresh);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const save = async (section: AdminSection) => {
    if (!form) return;
    setBusy("save");
    setMessage(null);
    const result = await adminPrograms.updateSection(await getToken().catch(() => null), section.id, form);
    setBusy(null);
    if (!result.ok) return setMessage({ text: result.error, error: true });
    setLoad({ state: "ready", section: { ...section, ...result.data } });
    show(result.data);
    setMessage({ text: "Saved.", error: false });
  };

  const remove = async (section: AdminSection) => {
    setBusy("delete");
    setMessage(null);
    const result = await adminPrograms.deleteSection(await getToken().catch(() => null), section.id);
    setBusy(null);
    if (!result.ok) return setMessage({ text: result.error, error: true });
    back();
  };

  const confirmDelete = (section: AdminSection) => {
    const text = `Members won't see “${section.title}” any more. This can't be undone.`;
    confirmChoice({ title: `Delete ${section.title}?`, message: text, confirmLabel: "Delete" }).then((ok) => {
      if (ok) remove(section);
    });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Category</Text>
          <View className="screen-bar__spacer" />
        </View>

        {load.state === "failed" ? (
          <View className="px-4">
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the category" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          </View>
        ) : load.state === "loading" || !form ? (
          <View className="px-4"><ScreenSkeleton cards={2} label="Loading the category" /></View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} automaticallyAdjustKeyboardInsets refreshControl={refreshControl}>
            {message && <Text className="meta-text" style={{ color: message.error ? colors.danger : colors.success }}>{message.text}</Text>}
            <CategoryForm value={form} onChange={changeForm} disabled={busy !== null} />
            <Pressable onPress={() => save(load.section)} disabled={busy !== null} className="btn-forest" style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Save category">
              {busy === "save" ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text className="btn-forest__label">Save</Text>}
            </Pressable>
            <Text className="meta-text">{`${load.section.programCount} ${load.section.programCount === 1 ? "program" : "programs"} in this category`}</Text>
            {load.section.builtIn ? (
              <Text className="admin__hint">{"A built-in category can't be deleted. Hide it instead."}</Text>
            ) : load.section.programCount > 0 ? (
              <Text className="admin__hint">To delete this category, move its programs to another one first (open each program and choose its Category).</Text>
            ) : (
              <Pressable onPress={() => confirmDelete(load.section)} disabled={busy !== null} className="btn-outline flex-row items-center justify-center" style={{ gap: 8, opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Delete category">
                {busy === "delete" ? <ActivityIndicator size="small" color={colors.danger} /> : <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={16} tintColor={colors.danger} />}
                <Text className="btn-outline__label" style={{ color: colors.danger }}>Delete category</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
