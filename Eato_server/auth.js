// Who is calling? Checks the Clerk session token the app sends as
// "Authorization: Bearer <token>" and puts the verified Clerk user id on req.userId.
// Everything about identity comes from the verified token or from Clerk's API,
// never from the request body.
const { createClerkClient, verifyToken } = require("@clerk/backend");

const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) throw new Error("Missing CLERK_SECRET_KEY in .env (copy it from the Clerk dashboard → API keys)");

const clerk = createClerkClient({ secretKey });

const ROLES = ["user", "admin", "trainer"];

// Express middleware: 401 unless the token is valid. Logs only the reason code, never the token.
async function requireUser(req, res, next) {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please sign in again." });

  try {
    const claims = await verifyToken(token, { secretKey });
    if (typeof claims.sub !== "string" || !claims.sub) return res.status(401).json({ error: "Please sign in again." });
    req.userId = claims.sub;
    next();
  } catch (error) {
    console.warn(`Session token rejected: ${error?.reason ?? "unknown"}`);
    res.status(401).json({ error: "Please sign in again." });
  }
}

// The account as Clerk knows it: primary email and the server-set role.
// Throws if Clerk can't be reached or the account has no email, so callers fail closed.
async function getAccount(userId) {
  const user = await clerk.users.getUser(userId);
  const primary =
    user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  if (!primary?.emailAddress) throw new Error("Clerk account has no email address");
  const role = ROLES.includes(user.publicMetadata?.role) ? user.publicMetadata.role : "user";
  return { email: primary.emailAddress, role };
}

module.exports = { requireUser, getAccount };
