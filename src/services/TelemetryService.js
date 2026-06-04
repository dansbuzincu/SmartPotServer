import mqtt from 'mqtt';

/**
 * TelemetryService
 *
 * Connects to the MQTT broker as a server-side subscriber and listens for
 * telemetry published by ESP32 devices on:
 *
 *   devices/<uniqueId>/telemetry
 *
 * For every valid message it:
 *   1. Resolves the device_id from the unique_id embedded in the topic.
 *   2. Upserts device_latest_telemetry (one row per device, always current).
 *   3. Appends a row to device_telemetry_history (full time-series record).
 *
 * Expected JSON payload from the ESP32:
 * {
 *   "temperature_c":     22.5,   // celsius
 *   "humidity_pct":      60.1,   // percentage 0-100
 *   "pressure_hpa":      1013.2, // hPa (optional)
 *   "soil_moisture_pct": 45.2,   // percentage 0-100
 *   "battery_pct":       85.0,   // percentage 0-100 (optional)
 *   "light_lux":         800,    // lux (optional)
 *   "measured_at":       "2026-06-04T12:00:00Z", // ISO8601, optional (defaults to server receive time)
 *   "payload_version":   1       // integer, optional
 * }
 */
class TelemetryService {
    /**
     * @param {object} opts
     * @param {object} opts.telemetryRepo   - TelemetryRepo instance
     * @param {object} opts.deviceService   - DeviceService instance (resolves uniqueId → device row)
     */
    constructor({ telemetryRepo, deviceService }) {
        this.telemetryRepo = telemetryRepo;
        this.deviceService = deviceService;
        this.client = null;

        // Cache uniqueId → device_id to avoid a DB lookup on every message.
        this._deviceIdCache = new Map();
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Connect to the MQTT broker and start listening for telemetry.
     * Safe to call multiple times — subsequent calls are no-ops if already connected.
     */
    start() {
        if (this.client) return;

        const rawBrokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost';
        const sanitizedBrokerUrl = String(rawBrokerUrl).trim().replace(/^['"]|['"]$/g, '');

        let protocol = 'mqtt';
        let host = sanitizedBrokerUrl;
        let brokerPort = parseInt(process.env.MQTT_BROKER_PORT || '1883', 10);

        // Support both forms:
        // 1) MQTT_BROKER_URL=mqtts://host
        // 2) MQTT_BROKER_URL=host
        if (/^mqtts?:\/\//i.test(sanitizedBrokerUrl)) {
            try {
                const parsed = new URL(sanitizedBrokerUrl);
                protocol = parsed.protocol.replace(':', '').toLowerCase();
                host = parsed.hostname;
                if (parsed.port) {
                    const parsedPort = Number.parseInt(parsed.port, 10);
                    if (Number.isInteger(parsedPort) && parsedPort > 0) {
                        brokerPort = parsedPort;
                    }
                }
            } catch {
                console.warn(`[TelemetryService] Invalid MQTT_BROKER_URL="${sanitizedBrokerUrl}", falling back to defaults`);
            }
        }

        // If no explicit scheme is provided, infer secure transport on 8883.
        if (!/^mqtts?:\/\//i.test(sanitizedBrokerUrl) && brokerPort === 8883) {
            protocol = 'mqtts';
        }

        const username   = process.env.MQTT_SERVER_USERNAME || process.env.MQTT_SHARED_APP_USERNAME || null;
        const password   = process.env.MQTT_SERVER_PASSWORD || process.env.MQTT_SHARED_APP_PASSWORD || null;
        const clientId   = `smartpot-server-telemetry-${Math.random().toString(36).slice(2, 10)}`;

        const connectOptions = {
            protocol,
            host,
            port: brokerPort,
            clientId,
            clean: true,
            reconnectPeriod: 5000,
            connectTimeout: 15000,
        };

        if (username) connectOptions.username = username;
        if (password) connectOptions.password = password;

        console.log(`[TelemetryService] Connecting to ${protocol}://${host}:${brokerPort} as ${clientId}`);
        this.client = mqtt.connect(connectOptions);

        this.client.on('connect', () => {
            console.log('[TelemetryService] Connected to MQTT broker');
            this.client.subscribe('devices/+/telemetry', { qos: 1 }, (err) => {
                if (err) {
                    console.error('[TelemetryService] Subscription error:', err.message);
                } else {
                    console.log('[TelemetryService] Subscribed to devices/+/telemetry');
                }
            });
        });

        this.client.on('message', (topic, messageBuffer) => {
            this._handleMessage(topic, messageBuffer).catch((err) => {
                console.error('[TelemetryService] Unhandled error in _handleMessage:', err);
            });
        });

        this.client.on('error', (err) => {
            console.error('[TelemetryService] MQTT client error:', err.message);
        });

        this.client.on('reconnect', () => {
            console.log('[TelemetryService] Reconnecting to MQTT broker…');
        });

        this.client.on('close', () => {
            console.log('[TelemetryService] MQTT connection closed');
        });

        this.client.on('offline', () => {
            console.log('[TelemetryService] MQTT client is offline');
        });
    }

    /**
     * Gracefully disconnect from the MQTT broker.
     */
    async shutdown() {
        if (!this.client) return;
        return new Promise((resolve) => {
            this.client.end(false, {}, () => {
                console.log('[TelemetryService] Disconnected from MQTT broker');
                this.client = null;
                resolve();
            });
        });
    }

    async getLatestTelemetryByDeviceId(deviceId) {
        return await this.telemetryRepo.getLatestByDeviceId(deviceId);
    }

    async getTelemetryHistoryByDeviceId(deviceId, options) {
        return await this.telemetryRepo.getHistoryByDeviceId(deviceId, options);
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    async _handleMessage(topic, messageBuffer) {
        // Extract uniqueId from topic: "devices/<uniqueId>/telemetry"
        const parts = topic.split('/');
        if (parts.length !== 3 || parts[0] !== 'devices' || parts[2] !== 'telemetry') {
            console.warn(`[TelemetryService] Ignoring unexpected topic: ${topic}`);
            return;
        }
        const uniqueId = parts[1];

        // Parse payload
        let payload;
        try {
            payload = JSON.parse(messageBuffer.toString('utf8'));
        } catch {
            console.warn(`[TelemetryService] Non-JSON payload on topic ${topic}, ignoring`);
            return;
        }

        if (!payload || typeof payload !== 'object') {
            console.warn(`[TelemetryService] Invalid payload on topic ${topic}, ignoring`);
            return;
        }

        // Resolve device_id (with cache)
        const deviceId = await this._resolveDeviceId(uniqueId);
        if (!deviceId) {
            console.warn(`[TelemetryService] Unknown device unique_id="${uniqueId}", dropping telemetry`);
            return;
        }

        const telemetry = this._normalizeTelemetry(payload);

        // Persist — run both writes; log individual failures without crashing.
        const [latestResult, historyResult] = await Promise.all([
            this.telemetryRepo.upsertLatest(deviceId, telemetry),
            this.telemetryRepo.insertHistory(deviceId, telemetry),
        ]);

        if (!latestResult.ok) {
            console.error(`[TelemetryService] upsertLatest failed for device ${deviceId}:`, latestResult.error);
        }
        if (!historyResult.ok) {
            console.error(`[TelemetryService] insertHistory failed for device ${deviceId}:`, historyResult.error);
        }

        if (latestResult.ok && historyResult.ok) {
            console.log(`[TelemetryService] Stored telemetry for device ${deviceId} (unique_id="${uniqueId}")`);
        }
    }

    /**
     * Resolve device_id from unique_id, using an in-memory cache.
     * @returns {number|null}
     */
    async _resolveDeviceId(uniqueId) {
        if (this._deviceIdCache.has(uniqueId)) {
            return this._deviceIdCache.get(uniqueId);
        }

        const result = await this.deviceService.getDeviceByUniqueId(uniqueId);
        if (!result.ok || !result.device) {
            return null;
        }

        const deviceId = result.device.id;
        this._deviceIdCache.set(uniqueId, deviceId);
        return deviceId;
    }

    /**
     * Flatten a potentially nested payload into a single key→value map.
     *
     * Supports two formats:
     *   Nested:  { "DummySensorSource": { "temperature": 25, "humidity": 60 }, ... }
     *   Flat:    { "temperature_c": 25, "humidity_pct": 60, ... }
     *
     * In the nested format every value that is a plain object is merged into
     * a single flat map (last-write-wins if keys collide across sources).
     */
    _flattenPayload(payload) {
        const flat = {};
        for (const [key, value] of Object.entries(payload)) {
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                // Nested sensor source — merge its fields into flat
                Object.assign(flat, value);
            } else {
                flat[key] = value;
            }
        }
        return flat;
    }

    /**
     * Validate and extract known telemetry fields from the raw payload.
     * Handles both nested sensor-source format and flat format.
     * received_at is always the server-side timestamp.
     *
     * Field name aliases (ESP32 short names → DB column names):
     *   temperature        → temperature_c
     *   humidity           → humidity_pct
     *   pressure           → pressure_hpa
     *   soil_moisture      → soil_moisture_pct
     *   battery            → battery_pct
     *   light / light_lux  → light_lux
     */
    _normalizeTelemetry(payload) {
        const toFloatOrNull = (v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : null;
        };

        const toIntOrNull = (v) => {
            const n = parseInt(v, 10);
            return Number.isInteger(n) ? n : null;
        };

        const f = this._flattenPayload(payload);
        const receivedAt = new Date();
        const parsedMeasuredAt = f.measured_at ? new Date(f.measured_at) : null;
        const measuredAt = parsedMeasuredAt && !Number.isNaN(parsedMeasuredAt.getTime())
            ? parsedMeasuredAt
            : receivedAt;

        return {
            measured_at:       measuredAt,
            received_at:       receivedAt,
            temperature_c:     toFloatOrNull(f.temperature_c     ?? f.temperature),
            humidity_pct:      toFloatOrNull(f.humidity_pct      ?? f.humidity),
            pressure_hpa:      toFloatOrNull(f.pressure_hpa      ?? f.pressure),
            soil_moisture_pct: toFloatOrNull(f.soil_moisture_pct ?? f.soil_moisture),
            battery_pct:       toFloatOrNull(f.battery_pct       ?? f.battery),
            light_lux:         toFloatOrNull(f.light_lux         ?? f.light),
            payload_version:   toIntOrNull(f.payload_version),
            raw_payload:       JSON.stringify(payload),
        };
    }
}

export default TelemetryService;
