# Northstar UAV Ground Control

A standalone React ground-station frontend for a GPS-free UAV prototype. The interface starts in an explicit **DEMO** mode. Demo telemetry and sample LiDAR points are generated locally, labeled as demo, and are never substituted into the live Firebase data path. Real autonomous navigation is disabled; the path planner is a local simulation and `AUTO MISSION` cannot be sent.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and fill in the Firebase Web App configuration values.
4. Run `npm run dev`, then open the local Vite URL.
5. To connect, select **LIVE FIREBASE**, then sign in with an operator account created in Firebase Authentication.

The web configuration is not a service-account credential. Do not put Firebase Admin SDK keys, service-account JSON, or other private credentials in the frontend or `.env.local`. Restrict the Firebase API key in Google Cloud Console. `.env.local` is ignored by Vite's normal build output; do not commit it.

## Firebase setup

1. Create a Firebase project and Realtime Database. Copy the database URL, project ID, auth domain, API key, and app ID into `.env.local` using the `VITE_FIREBASE_*` names from `.env.example`.
2. Enable **Authentication → Email/Password**. Create operator accounts in the Firebase Console; this site intentionally does not have public account registration.
3. Assign Firebase custom claims from a trusted Admin SDK environment: `operator: true` to approved ground-station accounts and `device: true` to the authenticated companion/device identity. Never distribute Admin credentials to the browser or ESP32.
4. Review and deploy `database.rules.json` using the Firebase CLI (`firebase deploy --only database`). The rules deny unauthenticated access, restrict operator requests to a one-time command ID written by that operator, and limit hardware telemetry/acknowledgements to the device role.
5. Provision each ESP32 using a trusted device-authentication flow (for example, short-lived custom tokens minted by a backend). Do not embed service-account keys in firmware. If the device cannot safely obtain tokens, put a small authenticated gateway between it and Firebase.
6. Confirm the rules using the Firebase Rules Playground or Emulator Suite before connecting a flight controller. These rules are a project-specific baseline; align operator claims, device identity, retention, and rate limits with your deployment.

For browser development only, `.env.local` is read by Vite on startup; restart the dev server after changing it. Authentication and database errors are surfaced in Settings and System Logs.

## Data and command contract

The app listens at `/drone/{status,telemetry,sensors,mapping,camera,system}`. Expected payload shapes, units, timing, and command acknowledgement requirements are documented in [docs/ESP32_API.md](./docs/ESP32_API.md).

Command requests are written to `/drone/commands/request/{uniqueId}` with an issuing UID and a 15-second expiry. A companion must check the ID has not previously been processed, check expiry immediately before acting, validate command preconditions, and report the resulting **flight-controller feedback** at `/drone/commands/response/{uniqueId}`. A successful Firebase write is only a queued request; it is not evidence that the flight controller accepted or completed it.

The browser only allows a fixed command allowlist. Flight commands additionally require an authenticated live session and a companion-reported `protocolVerified: true` flag for the CrossFlight interface. Establishing that flag is a hardware integration and bench-validation responsibility; do not set it until the installed firmware, port, and supported protocol are verified. No motor-level commands are implemented. Keep pilot RC override and all flight-controller failsafes active.

`AUTO MISSION` remains simulation-only and is deliberately absent from the real command allowlist. The path planner neither consumes live mapping nor publishes a route.

## Current hardware integration boundary

This deliverable implements the complete frontend and Firebase browser integration. It does **not** flash firmware, invent a CrossFlight MAVLink configuration, or claim to validate the RadioLink CrossFlight V1.0 telemetry interface. Confirm that the installed firmware supports MAVLink and verify the UART/port settings using its authoritative documentation before implementing the ESP32 companion. Start with disarmed bench tests and read-only telemetry; only enable a command after the expected FC acknowledgement is observed. The ESP32-CAM stream is displayed directly from its configured HTTP MJPEG URL.

Run `npm run build` to create the production bundle in `dist/`.
