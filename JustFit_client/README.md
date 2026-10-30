# justFit

Fitness meal delivery and tracking app for India, built with Expo.

## Get started

```bash
npm install
npx expo start
```

## The API server

The app has no API routes of its own. Everything it needs from a server comes from the Express
server in `../JustFit_server`, which it calls through `apiFetch()` in `src/lib/api.ts`. Start that
server in a second terminal (it reads `JustFit_server/.env` and listens on port 4000, or `PORT`;
the server uses yarn, and `npx yarn@1` works if `yarn` isn't installed):

```bash
cd ../JustFit_server
yarn install
yarn start
curl http://localhost:4000/api/health   # → {"ok":true,"database":"connected"}
```

The app finds the server through `EXPO_PUBLIC_API_URL` in `.env` (see `.env.example`):

- **Local development:** leave it unset. The app then uses the computer running `npx expo start`
  on port 4000, which works for the simulator and for a phone on the same Wi-Fi.
- **Set it** when the app can't find the server that way, for example
  `EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:4000`, and for every release build, where
  it must be the deployed server's HTTPS URL (without it a release build looks on `localhost`).

`EXPO_PUBLIC_*` values are built into the app, so never put a secret in one. Restart
`npx expo start` (or rebuild a release build) after changing it.
