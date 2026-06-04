class TelemetryRepo {
    constructor(database) {
        if (!database) {
            throw new Error('Database instance required');
        }
        this.database = database;
    }

    /**
     * Upsert into device_latest_telemetry — one row per device, always the most recent reading.
     */
    async upsertLatest(deviceId, telemetry) {
        const queryText = `
            INSERT INTO device_latest_telemetry (
                device_id, measured_at, received_at,
                temperature_c, humidity_pct, pressure_hpa,
                soil_moisture_pct, battery_pct, light_lux,
                payload_version, raw_payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (device_id) DO UPDATE SET
                measured_at       = EXCLUDED.measured_at,
                received_at       = EXCLUDED.received_at,
                temperature_c     = EXCLUDED.temperature_c,
                humidity_pct      = EXCLUDED.humidity_pct,
                pressure_hpa      = EXCLUDED.pressure_hpa,
                soil_moisture_pct = EXCLUDED.soil_moisture_pct,
                battery_pct       = EXCLUDED.battery_pct,
                light_lux         = EXCLUDED.light_lux,
                payload_version   = EXCLUDED.payload_version,
                raw_payload       = EXCLUDED.raw_payload
            RETURNING *;
        `;
        const queryValues = [
            deviceId,
            telemetry.measured_at       ?? null,
            telemetry.received_at,
            telemetry.temperature_c     ?? null,
            telemetry.humidity_pct      ?? null,
            telemetry.pressure_hpa      ?? null,
            telemetry.soil_moisture_pct ?? null,
            telemetry.battery_pct       ?? null,
            telemetry.light_lux         ?? null,
            telemetry.payload_version   ?? null,
            telemetry.raw_payload       ?? null,
        ];

        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok || !result.rows || result.rows.length === 0) {
            return { ok: false, error: (result && result.error) || 'upsert failed' };
        }
        return { ok: true, telemetry: result.rows[0] };
    }

    /**
     * Append a row to device_telemetry_history — full historical record.
     */
    async insertHistory(deviceId, telemetry) {
        const queryText = `
            INSERT INTO device_telemetry_history (
                device_id, measured_at, received_at,
                temperature_c, humidity_pct, pressure_hpa,
                soil_moisture_pct, battery_pct, light_lux,
                payload_version, raw_payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *;
        `;
        const queryValues = [
            deviceId,
            telemetry.measured_at       ?? null,
            telemetry.received_at,
            telemetry.temperature_c     ?? null,
            telemetry.humidity_pct      ?? null,
            telemetry.pressure_hpa      ?? null,
            telemetry.soil_moisture_pct ?? null,
            telemetry.battery_pct       ?? null,
            telemetry.light_lux         ?? null,
            telemetry.payload_version   ?? null,
            telemetry.raw_payload       ?? null,
        ];

        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok || !result.rows || result.rows.length === 0) {
            return { ok: false, error: (result && result.error) || 'insert failed' };
        }
        return { ok: true, entry: result.rows[0] };
    }

    async getLatestByDeviceId(deviceId) {
        const queryText = `
            SELECT
                device_id,
                measured_at,
                received_at,
                temperature_c,
                humidity_pct,
                pressure_hpa,
                soil_moisture_pct,
                battery_pct,
                light_lux,
                payload_version
            FROM device_latest_telemetry
            WHERE device_id = $1
            LIMIT 1;
        `;

        const result = await this.database.query(queryText, [deviceId]);
        if (!result || !result.ok) {
            return { ok: false, error: (result && result.error) || 'query failed' };
        }
        if (!result.rows || result.rows.length === 0) {
            return { ok: false, error: 'telemetry_not_found' };
        }

        return { ok: true, telemetry: result.rows[0] };
    }

    async getHistoryByDeviceId(deviceId, { from, to, limit }) {
        const queryText = `
            SELECT
                id,
                device_id,
                measured_at,
                received_at,
                temperature_c,
                humidity_pct,
                pressure_hpa,
                soil_moisture_pct,
                battery_pct,
                light_lux,
                payload_version
            FROM device_telemetry_history
            WHERE device_id = $1
              AND received_at >= $2
              AND received_at <= $3
            ORDER BY received_at ASC
            LIMIT $4;
        `;

        const queryValues = [deviceId, from, to, limit];
        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok) {
            return { ok: false, error: (result && result.error) || 'query failed' };
        }

        return { ok: true, history: result.rows || [] };
    }
}

export default TelemetryRepo;
