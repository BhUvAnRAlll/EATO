import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { gymApi, type GymTeam, type PermissionTile, type StaffOption, type TeamMember } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import { NO_MODULES, filterTree, sameOptions, tickedIn, toggleOption, toggleTile } from "@/lib/permissionTree";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Role & Permission › a Staff login (2026-11-08, the user's reference screen): every portal area
// as a tile with a box, and under it the options they may use. Ticking a tile ticks all its
// options; an option brings the one it needs. Only the gym admin reaches it (the server answers
// Staff with a 403), and the server checks every option on every request.
export default function StaffPermissionsScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { result, retry, set } = useGymData(gymApi.team);

  if (result.state !== "ready") {
    return (
      <GymScreen title="Role & Permission">
        {result.state === "loading" ? <GymLoading label="Loading permissions" /> : <GymError error={result.error} onRetry={retry} />}
      </GymScreen>
    );
  }
  if (result.data.permissionTree.length === 0) {
    return (
      <GymScreen title="Role & Permission">
        <GymError error={NO_MODULES} onRetry={retry} />
      </GymScreen>
    );
  }
  const member = result.data.team.find((m) => m.id === userId && m.kind === "staff");
  if (!member) {
    return (
      <GymScreen title="Role & Permission">
        <GymError error="They aren't a Staff login at this branch any more." onRetry={retry} />
      </GymScreen>
    );
  }
  return <PermissionsEditor key={member.id} member={member} tree={result.data.permissionTree} onSaved={set} />;
}

function PermissionsEditor({ member, tree, onSaved }: { member: TeamMember; tree: PermissionTile[]; onSaved: (team: GymTeam) => void }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState<StaffOption[]>(member.options);
  const [ticked, setTicked] = useState<StaffOption[]>(member.options);
  // Tiles with something ticked start open, as in the reference
  const [open, setOpen] = useState<string[]>(() => tree.filter((t) => tickedIn(t, member.options).length > 0).map((t) => t.id));
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const { busy, error, save } = useGymSave<GymTeam>((team) => {
    const now = team.team.find((m) => m.id === member.id)?.options ?? ticked;
    setSaved(now);
    setTicked(now);
    onSaved(team);
    setNotice(`Saved. ${member.name ?? "They"} will see the change on their next tap.`);
  });
  const name = member.name ?? "Staff login";
  const searching = query.trim().length > 0;
  const shown = filterTree(tree, query);
  const change = (next: StaffOption[]) => {
    haptic.select();
    setNotice("");
    setTicked(next);
  };
  const toggleOpen = (id: string) => setOpen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  return (
    <GymScreen title={name} scroll={false}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
      >
        <View className="gym-perm-banner">
          <GymIcon name="info" size={18} color={colors.gymPrimary} />
          <Text className="gym-perm-banner__text">Tick a tile to show it for this Staff login. Under each tile, tick the options they may use.</Text>
        </View>
        <View className="gym-perm-banner gym-perm-banner--warn">
          <GymIcon name="triangle-alert" size={16} color={colors.gymWarning} />
          <Text className="gym-perm-banner__text gym-perm-banner__text--warn">
            {"This login sees ONLY the ticked options: unticking a box hides that screen for them once you save. New options start unticked for Staff already saved, so review them here after an update or they won't see the new screens."}
          </Text>
        </View>

        <View className="gym-perm-search">
          <GymIcon name="search" size={18} color={colors.gymFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search tile or option"
            placeholderTextColor={colors.gymFaint}
            className="flex-1"
            style={{ fontSize: 14, color: colors.gymInk, paddingVertical: 12 }}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search tile or option"
          />
        </View>
        <View className="gym-perm-links">
          <PressableScale onPress={() => setOpen(tree.map((t) => t.id))} className="gym-perm-link" accessibilityRole="button" accessibilityLabel="Expand all">
            <GymIcon name="square-plus" size={16} color={colors.gymPrimary} />
            <Text className="gym-perm-link__label">Expand all</Text>
          </PressableScale>
          <PressableScale onPress={() => setOpen([])} className="gym-perm-link" accessibilityRole="button" accessibilityLabel="Collapse all">
            <GymIcon name="square-minus" size={16} color={colors.gymPrimary} />
            <Text className="gym-perm-link__label">Collapse all</Text>
          </PressableScale>
        </View>

        {shown.length === 0 ? <Text className="gym-perm-count">{`Nothing matches "${query.trim()}".`}</Text> : null}
        {shown.map((tile) => {
          // The whole tile, not the filtered one, decides the box and the count
          const full = tree.find((t) => t.id === tile.id) ?? tile;
          const on = tickedIn(full, ticked).length;
          const expanded = searching || open.includes(tile.id);
          return (
            <View key={tile.id} className="gym-perm-tile">
              <View className="gym-perm-row">
                <Pressable onPress={() => toggleOpen(tile.id)} hitSlop={10} disabled={searching} accessibilityRole="button" accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${tile.label}`} accessibilityState={{ expanded }}>
                  <GymIcon name={expanded ? "chevron-down" : "chevron-right"} size={20} color={colors.gymPrimary} />
                </Pressable>
                <Pressable onPress={() => change(toggleTile(tree, ticked, full))} disabled={busy} className="flex-1 flex-row items-center" style={{ gap: 14, minHeight: 44 }} role="checkbox" aria-checked={on === full.options.length ? true : on > 0 ? "mixed" : false} accessibilityLabel={`${tile.label}, ${on} of ${full.options.length} options`}>
                  <Box on={on > 0} />
                  <Text className="gym-perm-label" numberOfLines={1}>{tile.label}</Text>
                  {on > 0 && on < full.options.length ? <Text className="gym-perm-count">{`${on} of ${full.options.length}`}</Text> : null}
                </Pressable>
              </View>
              {expanded && tile.options.map((option) => {
                const checked = ticked.includes(option.id);
                return (
                  <Pressable key={option.id} onPress={() => change(toggleOption(tree, ticked, option.id))} disabled={busy} className="gym-perm-row gym-perm-row--option" role="checkbox" aria-checked={checked} accessibilityLabel={`${tile.label}: ${option.label}`}>
                    <Box on={checked} />
                    <Text className="gym-perm-label">{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <View className="gym-perm-footer" style={{ paddingBottom: 12 + insets.bottom, gap: 10 }}>
        {notice ? (
          <Animated.View entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)} className="gym-note" accessibilityLiveRegion="polite">
            <GymIcon name="circle-check" size={18} color={colors.gymSuccess} />
            <Text className="gym-note__text">{notice}</Text>
          </Animated.View>
        ) : null}
        {ticked.length === 0 ? <Text className="gym-perm-count text-center">{"With nothing ticked they can only see Home."}</Text> : null}
        {error ? <FormAlert message={error} /> : null}
        <GymPrimaryButton label="Save Permissions" icon="check" ready={!sameOptions(ticked, saved)} busy={busy} onPress={() => save((token) => gymApi.setPermissions(token, member.id, ticked))} />
      </View>
    </GymScreen>
  );
}

// The reference's square box: an outline, or filled indigo with a white tick
function Box({ on }: { on: boolean }) {
  const colors = useThemeColors();
  return (
    <View className={on ? "gym-perm-box gym-perm-box--on" : "gym-perm-box"}>
      {on ? <GymIcon name="check" size={15} color={colors.white} /> : null}
    </View>
  );
}
