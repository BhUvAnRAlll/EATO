import { useState } from "react";
import { router } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { DeletePostSheet } from "@/components/community/DeletePostSheet";
import { community, type Post } from "@/lib/community";
import { useSessionToken } from "@/lib/session";

type PostMenuProps = {
  // The post whose ⋯ was tapped, or null when the menu is closed
  post: Post | null;
  onClose: () => void;
  // After the delete is confirmed and done on the server
  onDeleted: (post: Post) => void;
  // One friendly line: a report was sent, or something failed
  onNotice: (message: string) => void;
  // Where the menu was opened; admins see it as the report's reason
  source: "the feed" | "the post screen";
};

// A post's ⋯ menu, the same on the feed and on the post screen. Your post: Edit or Delete
// (behind a confirmation). Someone else's: View profile, Message or Report. The server
// still decides what each member may do.
export function PostMenu({ post, onClose, onDeleted, onNotice, source }: PostMenuProps) {
  const getToken = useSessionToken();
  const [deleting, setDeleting] = useState<Post | null>(null);

  const openConversation = async (userId: string) => {
    const result = await community.openConversation(await getToken(), userId);
    if (result.ok) router.push({ pathname: "/messages/[id]", params: { id: result.data.conversation.id } });
    else onNotice(result.error);
  };

  const actions = (item: Post): SheetAction[] => {
    if (item.isOwn) {
      return [
        { label: "Edit post", onPress: () => router.push({ pathname: "/community/compose", params: { postId: item.id } }) },
        { label: "Delete post", destructive: true, onPress: () => setDeleting(item) },
      ];
    }
    const firstName = item.author.name.split(" ")[0];
    return [
      { label: `View ${firstName}'s profile`, onPress: () => router.push({ pathname: "/community/profile/[userId]", params: { userId: item.author.id } }) },
      { label: `Message ${firstName}`, onPress: () => openConversation(item.author.id) },
      {
        label: "Report post",
        destructive: true,
        onPress: async () => {
          const result = await community.report(await getToken(), { postId: item.id }, `Reported from ${source}`);
          onNotice(result.ok ? "Thanks, we'll review this post." : result.error);
        },
      },
    ];
  };

  return (
    <>
      <ActionSheet visible={post !== null} title={post ? `${post.author.name}'s post` : undefined} actions={post ? actions(post) : []} onClose={onClose} />
      <DeletePostSheet post={deleting} onClose={() => setDeleting(null)} onDeleted={onDeleted} onError={onNotice} />
    </>
  );
}
