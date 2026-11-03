import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AdminField } from "@/components/admin/AdminField";
import { SymbolView } from "@/components/SymbolView";
import { watchUrl } from "@/components/fitness/youtube";
import type { SessionFields } from "@/lib/adminPrograms";
import type { ProgramSession } from "@/lib/fitnessApi";
import { useThemeColors } from "@/theme";

type ProgramSessionsProps = {
  sessions: ProgramSession[];
  // A session change is running (the buttons wait)
  busy: boolean;
  disabled?: boolean;
  onAdd: (session: SessionFields) => void;
  onEdit: (sessionId: string, session: SessionFields) => void;
  onDelete: (sessionId: string) => void;
  onMove: (sessionId: string, direction: "up" | "down") => void;
};

// Admin › Programs › a program's sessions: each one's title, minutes and YouTube video, with ↑ ↓ to
// reorder, Edit (title, minutes, video link) and Delete (asked twice). Add session opens the same
// form. Videos are YouTube links, embedded in the app; there is no uploading.
export function ProgramSessions({ sessions, busy, disabled, onAdd, onEdit, onDelete, onMove }: ProgramSessionsProps) {
  const colors = useThemeColors();
  // The session being edited ("new" for Add session), and the one asking "Delete?"
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const off = busy || disabled;

  return (
    <View className="gap-3">
      {sessions.length === 0 && <Text className="meta-text">{"No sessions yet: members see \"Coming soon\". Add the first one below."}</Text>}
      {sessions.map((s, i) => (
        <View key={s.id} className="fitness-session" style={{ gap: 8 }}>
          {editing === s.id ? (
            <SessionForm
              initial={{ title: s.title, minutes: s.minutes, youtube: watchUrl({ kind: "video", id: s.video.id }) }}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSave={(fields) => { setEditing(null); onEdit(s.id, fields); }}
            />
          ) : (
            <>
              <Text className="type-subhead text-forest-ink">{`${i + 1}. ${s.title} · ${s.minutes} min`}</Text>
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <SymbolView name={{ ios: "play.rectangle.fill", android: "smart_display", web: "smart_display" }} size={16} tintColor={colors.leaf} />
                <Text className="meta-text min-w-0 flex-1" numberOfLines={1}>{`YouTube video${s.video.channel ? ` by ${s.video.channel}` : ""} · ${s.video.id}`}</Text>
              </View>
              <View className="flex-row flex-wrap items-center gap-2">
                <Pressable onPress={() => onMove(s.id, "up")} disabled={off || i === 0} className="setup__chip" style={{ opacity: i === 0 ? 0.4 : 1 }} accessibilityRole="button" accessibilityLabel={`Move ${s.title} up`}>
                  <SymbolView name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }} size={14} tintColor={colors.ink} />
                </Pressable>
                <Pressable onPress={() => onMove(s.id, "down")} disabled={off || i === sessions.length - 1} className="setup__chip" style={{ opacity: i === sessions.length - 1 ? 0.4 : 1 }} accessibilityRole="button" accessibilityLabel={`Move ${s.title} down`}>
                  <SymbolView name={{ ios: "arrow.down", android: "arrow_downward", web: "arrow_downward" }} size={14} tintColor={colors.ink} />
                </Pressable>
                <Pressable onPress={() => { setDeleting(null); setEditing(s.id); }} disabled={off} className="setup__chip" accessibilityRole="button" accessibilityLabel={`Edit ${s.title}`}>
                  <Text className="setup__chip-label">Edit</Text>
                </Pressable>
                {deleting === s.id ? (
                  <>
                    <Pressable onPress={() => { setDeleting(null); onDelete(s.id); }} disabled={off} className="setup__chip" accessibilityRole="button" accessibilityLabel={`Yes, delete ${s.title}`}>
                      <Text className="setup__chip-label" style={{ color: colors.danger }}>Yes, delete</Text>
                    </Pressable>
                    <Pressable onPress={() => setDeleting(null)} className="setup__chip" accessibilityRole="button" accessibilityLabel="Keep it">
                      <Text className="setup__chip-label">Keep</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => setDeleting(s.id)} disabled={off} className="setup__chip" accessibilityRole="button" accessibilityLabel={`Delete ${s.title}`}>
                    <Text className="setup__chip-label">Delete</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>
      ))}
      {editing === "new" ? (
        <View className="fitness-session">
          <SessionForm initial={{ title: "", minutes: 15, youtube: "" }} busy={busy} onCancel={() => setEditing(null)} onSave={(fields) => { setEditing(null); onAdd(fields); }} />
        </View>
      ) : (
        <Pressable onPress={() => { setDeleting(null); setEditing("new"); }} disabled={off} className="btn-outline flex-row items-center justify-center" style={{ gap: 8, opacity: off ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Add session">
          {busy ? <ActivityIndicator size="small" color={colors.leaf} /> : <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.forestInk} />}
          <Text className="btn-outline__label">Add session</Text>
        </Pressable>
      )}
    </View>
  );
}

// A session's title, minutes and YouTube video link (all three needed). The server checks every
// field again.
function SessionForm({ initial, busy, onSave, onCancel }: { initial: SessionFields; busy: boolean; onSave: (fields: SessionFields) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial.title);
  const [minutes, setMinutes] = useState(String(initial.minutes));
  const [youtube, setYoutube] = useState(initial.youtube);
  const n = Number.parseInt(minutes, 10);
  const ready = title.trim().length >= 2 && Number.isInteger(n) && n >= 5 && n <= 120 && youtube.trim().length > 0;
  return (
    <View className="gap-3">
      <AdminField label="Session title" value={title} onChangeText={setTitle} maxLength={60} placeholder="For example: Day 1: gentle core" />
      <AdminField label="Minutes" value={minutes} onChangeText={(t) => setMinutes(t.replace(/[^0-9]/g, "").slice(0, 3))} keyboardType="number-pad" maxLength={3} hint="5 to 120" />
      <AdminField
        label="YouTube video link"
        hint="One video's link from YouTube, played in YouTube's own player. Playlists and uploaded files aren't used."
        value={youtube}
        onChangeText={setYoutube}
        maxLength={300}
        placeholder="https://youtu.be/…"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <View className="flex-row gap-2">
        <Pressable onPress={() => onSave({ title: title.trim(), minutes: n, youtube: youtube.trim() })} disabled={!ready || busy} className="btn-forest flex-1" style={{ opacity: ready && !busy ? 1 : 0.5 }} accessibilityRole="button" accessibilityLabel="Save session">
          <Text className="btn-forest__label">Save session</Text>
        </Pressable>
        <Pressable onPress={onCancel} className="btn-outline" style={{ paddingHorizontal: 18 }} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text className="btn-outline__label">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
