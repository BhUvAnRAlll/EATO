import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { community, type Post } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type DeletePostSheetProps = {
  // The post to confirm deleting, or null when closed
  post: Post | null;
  onClose: () => void;
  onDeleted: (post: Post) => void;
  onError: (message: string) => void;
};

// "Delete this post?" confirmation. Drawn over the screen (not in a Modal) so it can open
// the moment the options sheet closes; the server still decides who may delete.
export function DeletePostSheet({ post, onClose, onDeleted, onError }: DeletePostSheetProps) {
  const getToken = useSessionToken();
  const [busy, setBusy] = useState(false);
  if (!post) return null;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const result = await community.deletePost(await getToken(), post.id);
    setBusy(false);
    onClose();
    if (result.ok) onDeleted(post);
    else onError(result.error);
  };

  return (
    <View className="confirm__backdrop" accessibilityViewIsModal>
      <Pressable style={{ flex: 1 }} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
      <View className="confirm__sheet">
        <Text className="setup__section text-center">Delete this post?</Text>
        <Text className="home__note mt-1 text-center">{"It disappears from the feed for everyone, photos included. This can't be undone."}</Text>
        <Pressable onPress={confirm} disabled={busy} className="btn-forest mt-4" style={{ backgroundColor: colors.danger, opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Delete">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Delete</Text>}
        </Pressable>
        <Pressable onPress={onClose} disabled={busy} className="btn-outline mt-2" accessibilityRole="button" accessibilityLabel="Keep post">
          <Text className="btn-outline__label">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
