class MqttCredsRepo {
    constructor(database) {
        if (!database) {
            throw new Error('Database instance required');
        }
        this.database = database;
    }

    async insertRow(row) {
        const queryText =
            'INSERT INTO mqtt_credentials (device_id, mqtt_username, mqtt_password_encrypted) VALUES ($1, $2, $3) RETURNING *';
        const queryValues = [row.device_id, row.mqtt_username, row.mqtt_password_encrypted];

        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok || !result.rows || result.rows.length === 0) {
            const dbError = result && result.error ? result.error : 'insert failed, no rows returned';

            if (typeof dbError === 'string' && dbError.includes('mqtt_credentials_mqtt_username_key')) {
                return { ok: false, error: 'mqtt_username_exists', message: 'mqtt username already exists' };
            }
            if (typeof dbError === 'string' && dbError.includes('mqtt_credentials_device_id_key')) {
                return { ok: false, error: 'mqtt_credentials_for_device_exists', message: 'device already has mqtt credentials' };
            }
            if (typeof dbError === 'string' && dbError.includes('mqtt_credentials_device_id_fkey')) {
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
                c.id AS mqtt_credential_id,
                c.mqtt_username,
                c.mqtt_password_encrypted
            FROM mqtt_credentials AS c
            INNER JOIN devices AS d
                ON d.id = c.device_id
            WHERE c.mqtt_password_encrypted = $1
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
        const queryText = 'DELETE FROM mqtt_credentials WHERE device_id = $1 RETURNING id';
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

    // Backward-compatible alias.
    async queryDeviceByPasswordHash(passwordHash) {
        return this.queryDeviceByCredentialValue(passwordHash);
    }
}

export default MqttCredsRepo;
