import { useCallback, useEffect, useState, type RefObject } from "react";
import { ActivityIndicator, Modal, Pressable, Switch, Text, TextInput, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { timeAgo } from "@/lib/community";
import { gyms, type Announcement } from "@/lib/gyms";
import { colors, switchColors } from "@/theme";

const input = { borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.forestInk } as const;

// composeSignal: bump it (the page's "New announcement" button) to open a blank editor
// reloadRef: the page hands it to ManageShell's pull to refresh, which reads the list again
type Props = { gymId: string; getToken: () => Promise<string | null>; composeSignal?: number; reloadRef?: RefObject<(() => Promise<unknown>) | null> };

// Announcements: write one (optionally pinned), edit, pin or unpin, delete. They show at the top
// of the gym feed, pinned first. The editor opens in a sheet.
export function GymAnnouncementsManager({ gymId, getToken, composeSignal = 0, reloadRef }: Props) {
  const [composing, setComposing] = useState(false);
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await gyms.announcements(await getToken(), gymId);
    if (result.ok) setItems(result.data.announcements);
    else setError(result.error);
  }, [gymId, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (reloadRef) reloadRef.current = load;
  }, [reloadRef, load]);

  const reset = () => {
    setEditing(null);
    setTitle("");
    setBody("");
    setPinned(false);
    setComposing(false);
    setError(null);
  };

  // The page's button opens a blank editor
  useEffect(() => {
    if (composeSignal === 0) return;
    const timer = setTimeout(() => {
      setEditing(null);
      setTitle("");
      setBody("");
      setPinned(false);
      setComposing(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [composeSignal]);

  const edit = (item: Announcement) => {
    setEditing(item);
    setTitle(item.title);
    setBody(item.body);
    setPinned(item.pinned);
    setComposing(true);
  };

  const save = async () => {
    if (!title.trim() || !body.trim()) return setError("An announcement needs a title and some text.");
    setSaving(true);
    setError(null);
    const token = await getToken();
    const values = { title: title.trim(), body: body.trim(), pinned };
    const result = editing ? await gyms.updateAnnouncement(token, gymId, editing.id, values) : await gyms.createAnnouncement(token, gymId, values);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    reset();
    await load();
  };

  const togglePin = async (item: Announcement) => {
    setBusy(item.id);
    const result = await gyms.updateAnnouncement(await getToken(), gymId, item.id, { pinned: !item.pinned });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    await load();
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.id);
    const result = await gyms.deleteAnnouncement(await getToken(), gymId, deleting.id);
    setBusy(null);
    setDeleting(null);
    if (!result.ok) return setError(result.error);
    if (editing?.id === deleting.id) reset();
    await load();
  };

  return (
    <View className="gap-3">
      <Text className="home__note">Announcements appear at the top of the gym feed. Pinned ones always show first.</Text>
      {error && !composing && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
      {items === null ? (
        <ActivityIndicator color={colors.forest} />
      ) : items.length === 0 ? (
        <EmptyState icon={{ ios: "megaphone", android: "campaign", web: "campaign" }} title="No announcements" text="Opening hours, new equipment, holiday closures: post them here." />
      ) : (
        items.map((item) => (
          <View key={item.id} className="gap-1">
            <View className="gym-note">
              <View className="flex-row items-center gap-2">
                <SymbolView name={{ ios: "megaphone", android: "campaign", web: "campaign" }} size={15} tintColor={colors.inkSoft} />
                <Text className="gym-note__kicker flex-1">Announcement</Text>
                {item.pinned && (
                  <View className="gym-badge gym-badge--staff flex-row items-center gap-1" style={{ height: 22 }}>
                    <SymbolView name={{ ios: "pin", android: "push_pin", web: "push_pin" }} size={11} tintColor={colors.white} />
                    <Text className="gym-badge__label gym-badge__label--staff" style={{ fontSize: 12 }}>Pinned</Text>
                  </View>
                )}
              </View>
              <Text className="join-card__title mt-2">{item.title}</Text>
              <Text className="post__body mt-1">{item.body}</Text>
              <Text className="gym-card__meta mt-2">{[item.author?.name, timeAgo(item.updatedAt)].filter(Boolean).join(" · ")}</Text>
            </View>
            <View className="flex-row gap-5 px-3 py-1">
              <Pressable onPress={() => togglePin(item)} disabled={busy === item.id} className="flex-row items-center gap-1.5" accessibilityRole="button" accessibilityLabel={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}>
                <SymbolView name={item.pinned ? { ios: "pin.slash", android: "push_pin", web: "push_pin" } : { ios: "pin", android: "push_pin", web: "push_pin" }} size={15} tintColor={colors.inkSoft} />
                <Text className="gym-share__shortcut">{item.pinned ? "Unpin" : "Pin"}</Text>
              </Pressable>
              <Pressable onPress={() => edit(item)} className="flex-row items-center gap-1.5" accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`}>
                <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={15} tintColor={colors.inkSoft} />
                <Text className="gym-share__shortcut">Edit</Text>
              </Pressable>
              <Pressable onPress={() => setDeleting(item)} className="flex-row items-center gap-1.5" accessibilityRole="button" accessibilityLabel={`Delete ${item.title}`}>
                <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={15} tintColor={colors.inkSoft} />
                <Text className="gym-share__shortcut">Delete</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
      <Modal visible={composing} transparent animationType="fade" onRequestClose={reset}>
        <Pressable className="verify__backdrop" onPress={reset} accessibilityLabel="Close">
          <Pressable className="verify__sheet gap-3" onPress={() => {}} accessibilityViewIsModal>
            <Text className="setup__section text-center">{editing ? "Edit announcement" : "New announcement"}</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.faint} maxLength={120} accessibilityLabel="Announcement title" style={input} />
            <TextInput value={body} onChangeText={setBody} placeholder="What members should know" placeholderTextColor={colors.faint} multiline maxLength={1000} accessibilityLabel="Announcement text" style={{ ...input, minHeight: 96, textAlignVertical: "top" }} />
            <View className="flex-row items-center justify-between">
              <Text className="auth__label">Pin to the top</Text>
              <Switch {...switchColors} value={pinned} onValueChange={setPinned} accessibilityLabel="Pin to the top" />
            </View>
            {error && <FormAlert message={error} />}
            <View className="flex-row gap-2">
              <Pressable onPress={reset} className="btn-outline flex-1" accessibilityRole="button" accessibilityLabel="Cancel editing">
                <Text className="btn-outline__label">Cancel</Text>
              </Pressable>
              <Pressable onPress={save} disabled={saving} className="btn-forest flex-1" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={editing ? "Save announcement" : "Post announcement"}>
                {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{editing ? "Save" : "Post"}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <ConfirmSheet visible={deleting !== null} title="Delete this announcement?" text="It disappears from the gym feed." confirmLabel="Delete" busy={busy !== null} onConfirm={remove} onCancel={() => setDeleting(null)} />
    </View>
  );
}
