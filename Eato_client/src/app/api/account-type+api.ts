import { createClerkClient } from "@clerk/backend";

import { requireUser } from "@/server/auth";

// POST → { role }
// Turns the account type picked on the sign-up screen (saved in unsafeMetadata,
// which the app can write) into the real role (publicMetadata, which only the
// server can write). It only ever grants "trainer", and only to accounts that
// have no role yet — so it can't change an admin, or switch a role twice.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  try {
    const user = await clerk.users.getUser(auth.userId);
    const currentRole = user.publicMetadata.role;
    if (typeof currentRole === "string") return Response.json({ role: currentRole });
    if (user.unsafeMetadata.accountType !== "trainer") return Response.json({ role: "user" });

    await clerk.users.updateUserMetadata(user.id, { publicMetadata: { role: "trainer" } });
    return Response.json({ role: "trainer" });
  } catch {
    console.error("Setting the account type failed");
    return Response.json({ error: "We couldn't set up your trainer account. Please try again." }, { status: 500 });
  }
}
