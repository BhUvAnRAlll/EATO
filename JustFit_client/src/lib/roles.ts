// Who the signed-in person is in justFit. The role is the server's (users.role, read on every
// request); the app only uses it to pick a dashboard. Every new account is a "user"; only an
// admin makes someone an admin or a gym admin (npm run set-role in JustFit_server), and a gym's
// admin makes people its Staff (gym_admin) or Trainers (trainer) from Staff / Admin Login, so
// nobody can promote themselves from the app. A gym admin and Staff open the gym portal
// (app/gym/); a trainer opens the member app.
export type Role = "user" | "admin" | "gym_admin" | "trainer";

export { homeRouteFor as getHomeRoute, usesMemberApp } from "./sessionRules.ts";
