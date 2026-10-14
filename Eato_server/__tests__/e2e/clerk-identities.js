// Real Clerk development-instance identities for the e2e suite: created per run, given
// genuine sessions through Clerk's Backend API, and deleted again. Tokens are returned
// to the caller and never logged. Errors are reduced to status and code, because Clerk's
// messages can echo an email address.
const crypto = require("node:crypto");
const { createClerkClient } = require("@clerk/backend");

const TEST_DOMAIN = "example.com";
const TEST_SUFFIX = `+clerk_test@${TEST_DOMAIN}`; // Clerk's reserved test-email convention
const METADATA_KEY = "eatoE2E";

function describeClerkError(error) {
  return { status: error?.status ?? null, code: error?.errors?.[0]?.code ?? error?.code ?? null };
}

function clerkFor(secretKey) {
  const clerk = createClerkClient({ secretKey });

  // One identity: email tagged with the run id and Clerk's test suffix, metadata tagged too.
  // The password is returned only when a browser test needs to sign in with it; it is
  // held in memory by the caller and never logged.
  // `role` ("admin" or "trainer") sets the server-side role the way scripts/set-role.mjs does,
  // for tests of role-protected routes; without it the identity is an ordinary member.
  async function createIdentity(runId, tag, { withPassword = false, role } = {}) {
    const emailAddress = `e2e-${runId}-${tag}${TEST_SUFFIX}`;
    const password = crypto.randomBytes(24).toString("base64url");
    const user = await clerk.users.createUser({
      emailAddress: [emailAddress],
      password,
      skipPasswordChecks: true,
      firstName: "E2E",
      lastName: tag,
      publicMetadata: role ? { [METADATA_KEY]: runId, role } : { [METADATA_KEY]: runId },
    });
    return withPassword ? { id: user.id, emailAddress, password } : { id: user.id, emailAddress };
  }

  // Reads or edits the app-writable metadata (the app keeps only profileComplete there)
  const getUnsafeMetadata = async (userId) => (await clerk.users.getUser(userId)).unsafeMetadata ?? {};
  const setUnsafeMetadata = (userId, unsafeMetadata) => clerk.users.updateUserMetadata(userId, { unsafeMetadata });

  // A genuine session and session token, verified by the server exactly like a device's
  async function mintToken(userId, expiresInSeconds) {
    const session = await clerk.sessions.createSession({ userId });
    const { jwt } = await clerk.sessions.getToken(session.id, undefined, expiresInSeconds);
    return { sessionId: session.id, jwt };
  }

  const revokeSession = (sessionId) => clerk.sessions.revokeSession(sessionId);
  // A further token for an existing session (rejected by Clerk once the session is revoked)
  const tokenFor = async (sessionId) => (await clerk.sessions.getToken(sessionId)).jwt;
  const deleteUser = (userId) => clerk.users.deleteUser(userId);

  async function userExists(userId) {
    try { await clerk.users.getUser(userId); return true; } catch (error) { if (error?.status === 404) return false; throw error; }
  }

  // Identities left behind by an earlier interrupted run: tagged, older than maxAgeMs
  async function sweepOrphans(maxAgeMs = 30 * 60 * 1000) {
    const { data } = await clerk.users.getUserList({ query: TEST_SUFFIX, limit: 100 });
    const cutoff = Date.now() - maxAgeMs;
    const removed = [];
    for (const user of data) {
      const tagged = user.publicMetadata?.[METADATA_KEY] !== undefined;
      const isTestEmail = user.emailAddresses.every((e) => e.emailAddress.endsWith(TEST_SUFFIX));
      if (tagged && isTestEmail && user.createdAt < cutoff) { await clerk.users.deleteUser(user.id); removed.push(user.id); }
    }
    return removed;
  }

  return { createIdentity, mintToken, tokenFor, revokeSession, deleteUser, userExists, sweepOrphans, getUnsafeMetadata, setUnsafeMetadata };
}

// Seconds-since-epoch expiry of a session token, read locally (no network, nothing logged)
function tokenExpiry(jwt) {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  return payload.exp;
}

module.exports = { clerkFor, describeClerkError, tokenExpiry, TEST_SUFFIX, METADATA_KEY };
