import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { AuthImage } from "@/components/community/AuthImage";
import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { isOffline, timeAgo } from "@/lib/community";
import { owner, type ReviewPost, type ReviewQueue } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors, switchColors } from "@/theme";

type Action = "approve" | "reject" | "keep" | "remove";
type View_ = "pending" | "reported";

const done: Record<Action, string> = {
  approve: "Approved: it's live in the gym feed.",
  reject: "Rejected and removed.",
  keep: "Kept. The reports were dismissed.",
  remove: "Removed from the gym feed.",
};

// A post as the reviewer sees it: author, when, the text and any photo
function PostBody({ post, gymName, badge, badgeClass }: { post: ReviewPost; gymName: string; badge: string; badgeClass: string }) {
  return (
    <>
      <View className="flex-row items-center gap-3">
        <Avatar member={post.author} size={40} />
        <View className="min-w-0 flex-1">
          <Text className="friend-row__name" numberOfLines={1}>{post.author.name}</Text>
          <Text className="friend-row__note" numberOfLines={1}>{gymName} · {timeAgo(post.createdAt)}</Text>
        </View>
        <View className={badgeClass}>
          <Text className="owner-badge__label">{badge}</Text>
        </View>
      </View>
      <Text className="friend-row__note" style={{ color: colors.ink, fontSize: 15, lineHeight: 21 }}>{post.body}</Text>
      {post.imageUrl && <AuthImage path={post.imageUrl} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 14 }} accessibilityLabel={`Photo in ${post.author.name}'s post`} />}
    </>
  );
}

// Review: posts waiting for approval (Approve publishes, Reject removes) and posts members
// reported in this gym (Keep dismisses the reports, Remove takes the post down). The switch at
// the top is the gym's "review posts before they go live" setting.
export default function OwnerReview() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const loadSummary = useOwnerStore((state) => state.loadSummary);
  const [data, setData] = useState<ReviewQueue | null>(null);
  const [view, setView] = useState<View_>("pending");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ post: ReviewPost; action: "reject" | "remove" } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!gymId) return;
    const result = await owner.review(await getToken(), gymId);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(result.error);
  }, [gymId, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const act = async (post: ReviewPost, action: Action) => {
    if (!gymId || busyId) return;
    setBusyId(post.id);
    setNotice(null);
    const token = await getToken();
    const result = await owner.reviewPost(token, gymId, post.id, action);
    setBusyId(null);
    setConfirm(null);
    if (!result.ok) return setError(result.error);
    setNotice(done[action]);
    await load();
    loadSummary(token); // Home's attention list and the Review tab badge
  };

  const toggle = async (on: boolean) => {
    if (!gymId || !data) return;
    setData({ ...data, postModeration: on });
    const result = await owner.setPostModeration(await getToken(), gymId, on);
    if (!result.ok) {
      setData({ ...data });
      setError(result.error);
    }
  };

  const gymName = data?.gym.name ?? "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.forest} />}
      >
        <OwnerHeader title="Review" subtitle="Posts waiting for your approval, and posts members reported." />
        {!data ? (
          <View className="mt-8 px-5">
            {error ? (
              <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={isOffline(error) ? "You're offline" : "Couldn't load"} text={error} actionLabel="Retry" onAction={load} />
            ) : (
              <ActivityIndicator color={colors.forest} />
            )}
          </View>
        ) : (
          <View className="mx-5 mt-4 gap-3">
            <View className="owner-card flex-row items-center gap-3">
              <View className="min-w-0 flex-1">
                <Text className="friend-row__name">Review posts before they go live</Text>
                <Text className="friend-row__note">Posts from members (not staff) wait here for approval.</Text>
              </View>
              <Switch {...switchColors} value={data.postModeration} onValueChange={toggle} accessibilityLabel="Review posts before they go live" />
            </View>

            <View className="segment" accessibilityRole="tablist">
              {(["pending", "reported"] as const).map((key) => {
                const on = view === key;
                const label = key === "pending" ? `Pending (${data.pending.length})` : `Reported (${data.reported.length})`;
                return (
                  <Pressable key={key} onPress={() => setView(key)} className={on ? "segment__item segment__item--active" : "segment__item"} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
                    <Text className={on ? "segment__label segment__label--active" : "segment__label"}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
            {notice && <Text className="friend-row__note" style={{ color: colors.ink }} accessibilityLiveRegion="polite">{notice}</Text>}

            {view === "pending" ? (
              data.pending.length === 0 ? (
                <EmptyState
                  icon={{ ios: "checkmark.shield", android: "verified_user", web: "verified_user" }}
                  title="Nothing waiting"
                  text={data.postModeration ? "Members' new posts wait here until you approve them." : "Turn on review above to approve members' posts before they go live."}
                />
              ) : (
                data.pending.map((post) => (
                  <View key={post.id} className="owner-card" accessibilityLabel={`Held post by ${post.author.name}`}>
                    <PostBody post={post} gymName={gymName} badge="Awaiting review" badgeClass="owner-badge owner-badge--warning" />
                    <View className="flex-row gap-2">
                      <Pressable onPress={() => setConfirm({ post, action: "reject" })} disabled={busyId !== null} className="owner-quick flex-1" style={{ height: 44 }} accessibilityRole="button" accessibilityLabel={`Reject ${post.author.name}'s post`}>
                        <Text className="owner-quick__label">Reject</Text>
                      </Pressable>
                      <Pressable onPress={() => act(post, "approve")} disabled={busyId !== null} className="owner-quick owner-quick--primary flex-1" style={{ height: 44, opacity: busyId === post.id ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={`Approve ${post.author.name}'s post`}>
                        {busyId === post.id ? <ActivityIndicator color={colors.white} /> : <Text className="owner-quick__label owner-quick__label--primary">Approve</Text>}
                      </Pressable>
                    </View>
                  </View>
                ))
              )
            ) : data.reported.length === 0 ? (
              <EmptyState icon={{ ios: "flag", android: "flag", web: "flag" }} title="No reports" text="Posts members report in your gym show here. justFit's team sees them too." />
            ) : (
              data.reported.map(({ post, reports, reasons }) => (
                <View key={post.id} className="owner-card" accessibilityLabel={`Reported post by ${post.author.name}`}>
                  <PostBody post={post} gymName={gymName} badge={`${reports} ${reports === 1 ? "report" : "reports"}`} badgeClass="owner-badge owner-badge--danger" />
                  <View className="owner-card--warning" style={{ borderRadius: 12, borderWidth: 1, padding: 10 }}>
                    <Text className="owner-stat__label">Reasons given</Text>
                    {reasons.map((reason) => <Text key={reason} className="friend-row__note" style={{ color: colors.ink }}>• {reason}</Text>)}
                  </View>
                  <View className="flex-row gap-2">
                    <Pressable onPress={() => act(post, "keep")} disabled={busyId !== null} className="owner-quick flex-1" style={{ height: 44 }} accessibilityRole="button" accessibilityLabel={`Keep ${post.author.name}'s post`}>
                      <Text className="owner-quick__label">Keep post</Text>
                    </Pressable>
                    <Pressable onPress={() => setConfirm({ post, action: "remove" })} disabled={busyId !== null} className="owner-quick owner-quick--primary flex-1" style={{ height: 44 }} accessibilityRole="button" accessibilityLabel={`Remove ${post.author.name}'s post`}>
                      <Text className="owner-quick__label owner-quick__label--primary">Remove post</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
      <ConfirmSheet
        visible={confirm !== null}
        title={confirm?.action === "reject" ? "Reject this post?" : "Remove this post?"}
        text={confirm?.action === "reject" ? "It's removed and never shown in the gym feed." : "It's taken down from the gym feed, and its reports are marked as handled."}
        confirmLabel={confirm?.action === "reject" ? "Reject" : "Remove"}
        busy={busyId !== null}
        onConfirm={() => confirm && act(confirm.post, confirm.action)}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}
