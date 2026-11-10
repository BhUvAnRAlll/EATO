import { apiFetch, type ApiResult } from "@/lib/api";

// Referrals (meal marketing phase 5): my code to share, and entering a friend's code once
export type MyReferral = {
  code: string;
  shareText: string;
  reward: number;
  minOrder: number;
  joined: number;
  rewarded: number;
  maxRewards: number;
  usedFriendCode: boolean;
  canClaim: boolean;
};
export type ClaimedCoupon = { coupon: { code: string; off: number; minOrder: number; endsOn: string } };

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });

export const referralsApi = {
  mine: (token: string | null) => (token ? apiFetch<MyReferral>("/api/referrals", { token }) : signedOut<MyReferral>()),
  claim: (token: string | null, code: string) =>
    token ? apiFetch<ClaimedCoupon>("/api/referrals/claim", { method: "POST", token, body: { code } }) : signedOut<ClaimedCoupon>(),
};
