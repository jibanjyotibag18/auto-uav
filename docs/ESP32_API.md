# ESP32 ↔ Ground Station data contract

All timestamps are Unix epoch milliseconds unless stated otherwise. The browser uses Firebase Realtime Database listeners and does not assume missing values. Firebase WebSocket/HTTP transports are managed by the Firebase SDK.

Publish `status.updatedAt` as the companion heartbeat at least every 15 seconds. The web UI treats missing or older-than-15-second companion/FC/camera/sensor telemetry as offline/stale rather than leaving an old healthy value marked live. Individual sensor and camera `updatedAt` values should be refreshed with their corresponding measurements/health.

## Database paths

| Path | Writer | Purpose |
|---|---|---|
| `/drone/status` | Authenticated companion | Link and FC state |
| `/drone/telemetry` | Authenticated companion | FC telemetry actually reported by the FC |
| `/drone/sensors` | ESP32 #1 | TF-Luna, GY-53, HMC5883L values and sensor health |
| `/drone/mapping` | ESP32 #2 | Local-coordinate scan points and angles |
| `/drone/camera` | ESP32-CAM/device; operator may configure URL | Camera connection and MJPEG URL |
| `/drone/system` | Authenticated companion | Firmware and heartbeat information |
| `/drone/commands/request/{id}` | Authenticated operator | Expiring, unique command request |
| `/drone/commands/response/{id}` | Authenticated companion | Acknowledgement or rejection keyed by request ID |

Example:

```json
{
  "status": {
    "connected": true,
    "flightController": {
      "connected": true,
      "mode": "ALT HOLD",
      "armed": false,
      "protocolVerified": false
    },
    "companion": { "connected": true },
    "mappingController": { "connected": true },
    "systemHealth": "NOMINAL",
    "updatedAt": 1794350000000
  },
  "telemetry": {
    "batteryVoltage": 15.8,
    "heading": 287.4,
    "altitude": 2.4,
    "roll": -1.2,
    "pitch": 3.6,
    "position": null,
    "updatedAt": 1794350000000
  },
  "sensors": {
    "tfLuna": { "distance": 3.42, "healthy": true, "updatedAt": 1794350000000 },
    "gy53": { "distance": 3.38, "healthy": true, "updatedAt": 1794350000000 },
    "hmc5883l": { "heading": 287.4, "healthy": true, "updatedAt": 1794350000000 }
  },
  "mapping": {
    "coordinateFrame": "sensor-local",
    "units": "m",
    "horizontalAngle": 360,
    "verticalAngle": 42,
    "points": [
      { "x": 1.2, "y": 0.3, "z": -2.1, "distance": 2.43, "obstacle": true }
    ],
    "updatedAt": 1794350000000
  },
  "camera": {
    "connected": true,
    "streamUrl": "http://192.168.4.1:81/stream",
    "updatedAt": 1794350000000
  },
  "system": {
    "firmware": "companion-build-id",
    "lastHeartbeat": 1794350000000
  }
}
```

Distances are meters, angles are degrees, battery voltage is volts, and the map's `x/y/z` values are meters in the documented sensor-local frame. Publish actual measured/derived coordinates; do not put scan angles or range in place of coordinates. A one-axis scanner can publish `y: 0` and a zero vertical angle to produce a planar scan. Two-axis scanning should publish all three coordinates.

The browser currently expects the whole `mapping.points` array. Use a bounded point count and update rate appropriate for Firebase and browser memory. If scans outgrow that shape, add chunking/streaming deliberately rather than silently truncating coordinates.

## Command lifecycle

The browser writes one record:

```json
{
  "id": "Firebase push ID",
  "command": "HOLD",
  "issuedAt": 1794350000000,
  "expiresAt": 1794350015000,
  "issuedBy": "Firebase Auth UID",
  "source": "ground-station",
  "status": "pending"
}
```

Allowed commands are `ARM`, `DISARM`, `HOLD`, `LAND`, `RETURN`, `START_SCAN`, `STOP_SCAN`, `CAMERA_ON`, and `CAMERA_OFF`. `AUTO MISSION` is intentionally not accepted. The companion must:

1. Subscribe to pending requests; validate the allowlisted command, authenticated operator, request ID, expiry, current FC mode/armed state, and vehicle-specific safety preconditions.
2. Atomically claim/process each request ID once (persist a deduplication record). Ignore expired, malformed, replayed, or unsupported requests.
3. For flight commands, use only a verified protocol and command implementation supported by the exact installed flight-controller firmware. Never manipulate motor outputs directly.
4. Acknowledge only after receiving actual FC feedback. Return a response at `/drone/commands/response/{id}`, e.g. `{ "command":"HOLD", "status":"acknowledged", "message":"FC mode changed", "acknowledgedAt":1794350001000 }`. Use `rejected`/`failed`/`expired` with a diagnostic message when applicable. A Firebase write alone is not an acknowledgement.
5. Continue publishing actual FC `armed`, `mode`, and connection state independently of the response record. Keep RC override and FC failsafes active.

The sample Realtime Database Rules permit an operator to create a command record once and do not let an operator rewrite it. A trusted device role writes responses. Add queue cleanup/retention and operational rate limiting in the trusted device/gateway layer.

## CrossFlight and camera notes

No UART baud rate, port, or MAVLink support is assumed by this frontend contract. Verify the installed CrossFlight firmware and its supported telemetry interface against authoritative RadioLink documentation before building the ESP32 serial bridge. `protocolVerified` must remain false until that verification and bench testing are complete.

The camera is a separate HTTP MJPEG stream. Set `camera.streamUrl` to the reachable ESP32-CAM URL and publish `camera.connected`/`updatedAt` from device health checks. Browsers may block mixed-content streams when the UI is served over HTTPS; deploy the stream through a trusted HTTPS proxy or use a secure camera transport in that case.
