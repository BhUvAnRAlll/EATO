// Who the signed-in person is in EATO. The role lives in the Clerk user's
// `publicMetadata.role`, which only the server (Clerk dashboard or the
// `npm run set-role` script) can change — so users can't promote themselves.
export type Role = "user" | "admin" | "trainer";

const roles: Role[] = ["user", "admin", "trainer"];

// The bits of a Clerk user we need (works with the `useUser()` user and `getClerkInstance().user`)
type UserWithMetadata = {
  publicMetadata: Record<string, unknown>;
  unsafeMetadata: Record<string, unknown>;
};

// What people can pick on the sign-up screen (admins are only made with `npm run set-role`)
export type AccountType = "user" | "trainer";

// Anyone without a (valid) role is a regular user, e.g. everyone who signs up in the app
export function getRole(user: UserWithMetadata | null | undefined): Role | null {
  if (!user) return null;
  const role = user.publicMetadata.role;
  return roles.includes(role as Role) ? (role as Role) : "user";
}

// True for a new trainer sign-up whose role the server hasn't set yet
export function needsTrainerRole(user: UserWithMetadata) {
  return user.publicMetadata.role === undefined && user.unsafeMetadata.accountType === "trainer";
}

// Asks the server to make this account a trainer (see app/api/account-type+api.ts).
// `token` is the Clerk session token.
export async function claimTrainerRole(token: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "Please sign in again." };
  try {
    const response = await fetch("/api/account-type", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as { role?: string; error?: string };
    if (!response.ok) return { ok: false, error: body.error ?? "We couldn't set up your trainer account." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

// Where a signed-in person lands: admins and trainers open their dashboards;
// users finish profile setup first, then open home.
export function getHomeRoute(user: UserWithMetadata) {
  const role = getRole(user);
  if (role === "admin") return "/admin";
  if (role === "trainer") return "/trainer";
  return user.unsafeMetadata.profileComplete === true ? "/home" : "/setup/body-composition";
}
