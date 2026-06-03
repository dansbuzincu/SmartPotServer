class MqttCredsRepo {
    constructor(database) {
        if (!database) {
            throw new Error('Database instance required');
        }
        this.database = database;
    }

    async insertRow(row) {
        const queryText =
            'INSERT INTO device_mqtt_provisioning (device_id, auth_mode, mqtt_client_id, mqtt_username, mqtt_password, certificate_fingerprint, active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *';
        const queryValues = [
            row.device_id,
            row.auth_mode,
            row.mqtt_client_id,
            row.mqtt_username || null,
            row.mqtt_password || null,
            row.certificate_fingerprint || null,
            row.active !== false
        ];

        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok || !result.rows || result.rows.length === 0) {
            const dbError = result && result.error ? result.error : 'insert failed, no rows returned';

            if (typeof dbError === 'string' && dbError.includes('device_mqtt_provisioning_mqtt_client_id_key')) {
                return { ok: false, error: 'mqtt_client_id_exists', message: 'mqtt client id already exists' };
            }
            if (typeof dbError === 'string' && dbError.includes('device_mqtt_provisioning_device_id_key')) {
                return { ok: false, error: 'mqtt_provisioning_for_device_exists', message: 'device already has mqtt provisioning' };
            }
            if (typeof dbError === 'string' && dbError.includes('device_mqtt_provisioning_device_id_fkey')) {
                return { ok: false, error: 'device_not_found', message: 'device_id does not exist' };
            }

            return { ok: false, error: dbError };
        }

        return { ok: true, credential: result.rows[0] };
    }

    async queryDeviceByCredentialValue(credentialValue) {
        const queryText = `
            SELECT
                d.id,
                d.unique_id,
                d.device_label,
                d.is_claimed,
                p.id AS mqtt_provisioning_id,
                p.auth_mode,
                p.mqtt_client_id,
                p.mqtt_username,
                p.mqtt_password,
                p.certificate_fingerprint,
                p.active
            FROM device_mqtt_provisioning AS p
            INNER JOIN devices AS d
                ON d.id = p.device_id
            WHERE p.mqtt_client_id = $1
            LIMIT 1;
        `;

        const result = await this.database.query(queryText, [credentialValue]);
        if (!result || !result.ok) {
            return { ok: false, error: (result && result.error) || 'query failed' };
        }
        if (!result.rows || result.rows.length === 0) {
            return { ok: false, error: 'no device found with that credential' };
        }

        return { ok: true, device: result.rows[0] };
    }

    async deleteByDeviceId(deviceId) {
        const queryText = 'DELETE FROM device_mqtt_provisioning WHERE device_id = $1 RETURNING id';
        const queryValues = [deviceId];

        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok) {
            return { ok: false, error: (result && result.error) || 'delete failed' };
        }
        if (result.rowCount === 0) {
            return { ok: false, error: 'credential_not_found' };
        }

        return { ok: true, deleted: true };
    }

}

export default MqttCredsRepo;
