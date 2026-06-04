# SmartPot — Android Data Hub: Server Contract

This document describes everything the Android app needs from the server side
to implement the Data Hub screen. The provisioning/onboarding flow is already
complete and is not covered here.

---

## 1. Telemetry REST Endpoints (implemented on server)

These endpoints are available on the server and can be consumed by the app.

### GET `/api/devices/:deviceId/telemetry/latest`

Returns the single most-recent telemetry snapshot stored for the device.

**Response 200**
```json
{
  "success": true,
  "telemetry": {
    "device_id": 1,
    "measured_at": "2026-06-04T12:00:00Z",
    "received_at": "2026-06-04T12:00:01Z",
    "temperature_c":     22.5,
    "humidity_pct":      60.1,
    "pressure_hpa":      1013.2,
    "soil_moisture_pct": 45.2,
    "battery_pct":       85.0,
    "light_lux":         800.0,
    "payload_version":   1
  }
}
```

> All numeric fields are **nullable** — the ESP32 may not have every sensor.  
> `measured_at` is nullable (device clock, may be absent).  
> `received_at` is always set (server-side timestamp).

**Response 404**
```json
{ "success": false, "error": "device_not_found" }
```

---

### GET `/api/devices/:deviceId/telemetry/history`

Returns time-series rows for graph rendering.

**Query parameters**

| param   | type    | default      | max    |
|---------|---------|--------------|--------|
| `from`  | ISO8601 | 24 h ago     | —      |
| `to`    | ISO8601 | now          | —      |
| `limit` | integer | 200          | 1000   |

**Response 200**
```json
{
  "success": true,
  "history": [
    {
      "id": 1,
      "device_id": 1,
      "measured_at": "2026-06-04T11:00:00Z",
      "received_at": "2026-06-04T11:00:01Z",
      "temperature_c":     21.0,
      "humidity_pct":      58.0,
      "pressure_hpa":      null,
      "soil_moisture_pct": 44.0,
      "battery_pct":       null,
      "light_lux":         null,
      "payload_version":   1
    }
  ]
}
```

Rows are ordered by `received_at ASC`.

---

## 2. Telemetry Field Reference

| JSON field          | Unit      | Nullable | Notes                          |
|---------------------|-----------|----------|--------------------------------|
| `temperature_c`     | °C        | yes      |                                |
| `humidity_pct`      | %         | yes      | 0–100                          |
| `pressure_hpa`      | hPa       | yes      | barometric                     |
| `soil_moisture_pct` | %         | yes      | 0–100                          |
| `battery_pct`       | %         | yes      | 0–100                          |
| `light_lux`         | lux       | yes      |                                |
| `measured_at`       | ISO8601   | yes      | device clock, prefer over received_at for graphs |
| `received_at`       | ISO8601   | no       | server receive time, fallback  |
| `payload_version`   | integer   | yes      | for future schema evolution    |

Use `measured_at` as the X-axis timestamp when not null, otherwise fall back
to `received_at`.

---

## 3. Data Flow Summary

```
ESP32
  └─ publishes JSON to MQTT topic: devices/<uniqueId>/telemetry
        every ~N seconds (interval not yet fixed)

SmartPot Server (Node.js)
  └─ receives MQTT message
  └─ upserts   → device_latest_telemetry  (1 row per device, always current)
  └─ appends   → device_telemetry_history (full time series)

Android App
  └─ GET /api/devices/:id/telemetry/latest   → current readings card
  └─ GET /api/devices/:id/telemetry/history  → time-series graphs
```

The app has the `device_id` (integer) and `device_label` (string) from the
claim flow — pass `device_id` in the URL path.

---

## 4. Suggested Polling Strategy

- **Latest snapshot**: poll every 30 s, or on pull-to-refresh.
- **History**: fetch once on screen open, re-fetch when the user changes the
  time-window selector (1 h / 6 h / 24 h / 7 d).
- No WebSocket or MQTT connection is needed from the app — REST polling is
  sufficient given current sensor intervals.

---

## 5. Error States to Handle

| HTTP status | `error` value          | UI action                        |
|-------------|------------------------|----------------------------------|
| 404         | `device_not_found`     | Show message, navigate back      |
| 5xx         | any                    | Snackbar + retry button          |
| network     | —                      | Snackbar + retry button          |
| 200, empty history | —               | Empty-state illustration         |

---

## 6. Notification Thresholds (local, no server involvement)

Threshold rules live entirely on the device (DataStore or Room). The app
evaluates them against the latest snapshot after each successful poll.

Suggested default thresholds to pre-populate:

| Metric              | Condition | Value | Message                    |
|---------------------|-----------|-------|----------------------------|
| `soil_moisture_pct` | `<`       | 20    | "Your plant needs watering" |
| `temperature_c`     | `>`       | 35    | "Environment too hot"       |
| `battery_pct`       | `<`       | 15    | "Device battery low"        |

- Requires `POST_NOTIFICATIONS` permission (Android 13+).
- Debounce: do not re-fire the same metric + direction within 60 minutes.
