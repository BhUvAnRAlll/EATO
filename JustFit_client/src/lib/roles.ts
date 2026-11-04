// Who the signed-in person is in justFit. The role is the server's (users.role, read on every
// request); the app only uses it to pick a dashboard. Every new account is a "user"; only an
// admin makes someone an admin or a gym admin (npm run set-role in JustFit_server), so nobody can
// promote themselves from the app. A gym admin opens the gym admin portal (app/gym/).
export type Role = "user" | "admin" | "gym_admin";

export { homeRouteFor as getHomeRoute } from "./sessionRules.ts";
