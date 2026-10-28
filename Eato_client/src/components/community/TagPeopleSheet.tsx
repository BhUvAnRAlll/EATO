import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { Avatar } from "@/components/community/Avatar";
import { community, type Member } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const MAX_TAGS = 10;

type TagPeopleSheetProps = {
  visible: boolean;
  selected: Member[];
  onDone: (members: Member[]) => void;
  onClose: () => void;
};

// Pick friends to tag on a post. Only accepted friends are listed (the server checks the same
// rule when the post is saved), up to 10. The parent mounts it only while open, so each opening
// starts from the post's current tags.
export function TagPeopleSheet({ visible, selected, onDone, onClose }: TagPeopleSheetProps) {
  const getToken = useSessionToken();
  const [friends, setFriends] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Member[]>(selected);

  // Load the friends list when the sheet opens
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const result = await community.friends(await getToken());
      if (cancelled) return;
      if (result.ok) {
        setFriends(result.data.friends.map((friend) => friend.member));
        setError(null);
      } else setError(result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, getToken]);

  const toggle = (member: Member) =>
    setPicked((current) => {
      if (current.some((item) => item.id === member.id)) return current.filter((item) => item.id !== member.id);
      return current.length >= MAX_TAGS ? current : [...current, member];
    });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="verify__backdrop" onPress={onClose} accessibilityLabel="Close">
        <Pressable className="verify__sheet gap-3" onPress={() => {}} accessibilityViewIsModal>
          <Text className="setup__section text-center">Tag people</Text>
          {friends === null ? (
            error ? <Text className="home__note text-center">{error}</Text> : <ActivityIndicator color={colors.forest} />
          ) : friends.length === 0 ? (
            <Text className="home__note text-center">{"You can tag friends once they've accepted your friend request."}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 320 }}>
              {friends.map((member) => {
                const on = picked.some((item) => item.id === member.id);
                return (
                  <Pressable key={member.id} onPress={() => toggle(member)} className="flex-row items-center gap-3 py-2" accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Tag ${member.name}`}>
                    <Avatar member={member} size={36} />
                    <Text className="post__author flex-1" numberOfLines={1}>{member.name}</Text>
                    <SymbolView name={on ? { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" } : { ios: "circle", android: "radio_button_unchecked", web: "radio_button_unchecked" }} size={22} tintColor={on ? colors.ink : colors.faint} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {picked.length >= MAX_TAGS && <Text className="home__note text-center">You can tag up to {MAX_TAGS} people.</Text>}
          <Pressable onPress={() => onDone(picked)} className="btn-forest" accessibilityRole="button" accessibilityLabel="Done tagging">
            <Text className="btn-forest__label">Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
