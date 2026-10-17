import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";

import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { gyms, type Announcement } from "@/lib/gyms";
import { colors } from "@/theme";

const input = { borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.forestInk } as const;

type Props = { gymId: string; getToken: () => Promise<string | null> };

// Manage → Announcements: write one (optionally pinned), edit, pin or unpin, delete. They show
// above the gym feed, pinned first.
export function GymAnnouncementsManager({ gymId, getToken }: Props) {
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

  const reset = () => {
    setEditing(null);
    setTitle("");
    setBody("");
    setPinned(false);
  };

  const edit = (item: Announcement) => {
    setEditing(item);
    setTitle(item.title);
    setBody(item.body);
    setPinned(item.pinned);
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
      <View className="post__card gap-3">
        <Text className="setup__section">{editing ? "Edit announcement" : "New announcement"}</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.faint} maxLength={120} accessibilityLabel="Announcement title" style={input} />
        <TextInput value={body} onChangeText={setBody} placeholder="What members should know" placeholderTextColor={colors.faint} multiline maxLength={1000} accessibilityLabel="Announcement text" style={{ ...input, minHeight: 96, textAlignVertical: "top" }} />
        <View className="flex-row items-center justify-between">
          <Text className="auth__label">Pin to the top</Text>
          <Switch value={pinned} onValueChange={setPinned} trackColor={{ true: colors.forest }} accessibilityLabel="Pin to the top" />
        </View>
        {error && <FormAlert message={error} />}
        <View className="flex-row gap-2">
          {editing && (
            <Pressable onPress={reset} className="btn-outline flex-1" accessibilityRole="button" accessibilityLabel="Cancel editing">
              <Text className="btn-outline__label">Cancel</Text>
            </Pressable>
          )}
          <Pressable onPress={save} disabled={saving} className="btn-forest flex-1" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={editing ? "Save announcement" : "Post announcement"}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{editing ? "Save" : "Post"}</Text>}
          </Pressable>
        </View>
      </View>
      {items === null ? (
        <ActivityIndicator color={colors.forest} />
      ) : items.length === 0 ? (
        <EmptyState icon={{ ios: "megaphone", android: "campaign", web: "campaign" }} title="No announcements" text="Opening hours, new equipment, holiday closures: post them here." />
      ) : (
        items.map((item) => (
          <View key={item.id} className="post__card gap-1">
            <Text className="post__time">{item.pinned ? "Pinned" : "Announcement"}</Text>
            <Text className="post__author">{item.title}</Text>
            <Text className="post__body">{item.body}</Text>
            <View className="mt-2 flex-row gap-2">
              <Pressable onPress={() => togglePin(item)} disabled={busy === item.id} className="admin__action" accessibilityRole="button" accessibilityLabel={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}>
                <Text className="admin__action-label">{item.pinned ? "Unpin" : "Pin"}</Text>
              </Pressable>
              <Pressable onPress={() => edit(item)} className="admin__action" accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`}>
                <Text className="admin__action-label">Edit</Text>
              </Pressable>
              <Pressable onPress={() => setDeleting(item)} className="admin__action" accessibilityRole="button" accessibilityLabel={`Delete ${item.title}`}>
                <Text className="admin__action-label" style={{ color: colors.danger }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
      <ConfirmSheet visible={deleting !== null} title="Delete this announcement?" text="It disappears from the gym feed." confirmLabel="Delete" busy={busy !== null} onConfirm={remove} onCancel={() => setDeleting(null)} />
    </View>
  );
}
