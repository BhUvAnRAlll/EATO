// Who the signed-in person is in justFit. The role is the server's (users.role, read on every
// request); the app only uses it to pick a dashboard. Every new account is a "user"; only an
// admin makes someone an admin (npm run set-role in JustFit_server), so nobody can promote
// themselves from the app.
export type Role = "user" | "admin";

export { homeRouteFor as getHomeRoute } from "./sessionRules.ts";
