// Gives a Clerk user a role ("user", "admin" or "trainer").
// Roles live in publicMetadata, which only the server can change.
//
//   npm run set-role -- <email> <role>              change an existing account's role
//   npm run set-role -- <email> <role> <password>   also create the account if it doesn't exist
//
// Reads CLERK_SECRET_KEY from .env. Never ship this key in the app.
import { createClerkClient } from "@clerk/backend";

const ROLES = ["user", "admin", "trainer"];
const [email, role, password] = process.argv.slice(2);

if (!email || !ROLES.includes(role)) {
  console.error(`Usage: npm run set-role -- <email> <${ROLES.join("|")}> [password]`);
  process.exit(1);
}
if (!process.env.CLERK_SECRET_KEY) {
  console.error("CLERK_SECRET_KEY is missing from .env");
  process.exit(1);
}

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

try {
  const { data: matches } = await clerk.users.getUserList({ emailAddress: [email] });
  let user = matches[0];

  if (!user) {
    if (!password) {
      console.error(`No account for ${email}. Pass a password to create one.`);
      process.exit(1);
    }
    // skipPasswordChecks lets simple test passwords through; use real passwords in production
    user = await clerk.users.createUser({ emailAddress: [email], password, skipPasswordChecks: true });
    console.log(`Created ${email}`);
  }

  await clerk.users.updateUserMetadata(user.id, { publicMetadata: { role } });
  console.log(`${email} is now "${role}" (${user.id}). Sign out and back in to see the new dashboard.`);
} catch (error) {
  console.error(error.errors?.[0]?.longMessage ?? error.message);
  process.exit(1);
}
