import { verifyToken } from "@clerk/backend";

// Checks the Clerk session token sent as "Authorization: Bearer <token>".
// Returns the user id, or a 401 response to send back.
export async function requireUser(request: Request): Promise<{ userId: string } | { response: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const unauthorized = { response: Response.json({ error: "Please sign in again." }, { status: 401 }) };
  if (!token) return unauthorized;

  try {
    // Resolves to the token's claims (`sub` is the Clerk user id); throws if the token is invalid or expired
    const claims = (await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })) as { sub?: string };
    return claims.sub ? { userId: claims.sub } : unauthorized;
  } catch (error) {
    // Log only the reason code, never the token
    console.warn(`Session token rejected: ${(error as { reason?: string }).reason ?? "unknown"}`);
    return unauthorized;
  }
}
