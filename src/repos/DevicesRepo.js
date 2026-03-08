// Magic uuid of 32 bytes until uuids are defined
const magicUuid = '00000000000000000000000000000000';

class DevicesRepo {
    constructor(database) {
        // Go on only if database instance is not null!
        if (!database) {
            throw new Error('Database instance required');
        }
        this.database = database;
    }

    // This is for test purposes
    async newDeviceRow() {
        return {
            unique_id: magicUuid,
            device_label: null,
            is_claimed: false
        };
    }

    async insertRow(row) {
        const queryText =
            'INSERT INTO devices (unique_id, device_label, is_claimed) VALUES ($1, $2, $3) RETURNING *';

        const queryValues = [
            row.unique_id,
            row.device_label || null,
            !!row.is_claimed
        ];

        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok || !result.rows || result.rows.length === 0) {
            const dbError = result && result.error ? result.error : 'insert failed, no rows returned';
            if (typeof dbError === 'string' && dbError.includes('devices_unique_id_key')) {
                return { ok: false, error: 'unique_id_exists', message: 'device with that unique_id already exists' };
            }
            return { ok: false, error: dbError };
        }

        return { ok: true, device: result.rows[0] };
    }

    async claimDeviceById(deviceId) {
        const queryText =
            'UPDATE devices SET is_claimed = true WHERE id = $1 AND is_claimed = false RETURNING *';
        const queryValues = [deviceId];

        const result = await this.database.query(queryText, queryValues);

        if (!result || !result.ok) {
            return { ok: false, error: (result && result.error) || 'claim failed' };
        }
        if (result.rowCount === 0) {
            return { ok: false, error: 'device_already_claimed_or_missing' };
        }

        return { ok: true, device: result.rows[0] };
    }

    async queryByUniqueId(uniqueId) {
        const queryText = 'SELECT * FROM devices WHERE unique_id = $1 LIMIT 1';
        const queryValues = [uniqueId];

        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok) {
            return { ok: false, error: (result && result.error) || 'query failed' };
        }
        if (!result.rows || result.rows.length === 0) {
            return { ok: false, error: 'device_not_found' };
        }

        return { ok: true, device: result.rows[0] };
    }

    async deleteById(deviceId) {
        const queryText = 'DELETE FROM devices WHERE id = $1 RETURNING id';
        const queryValues = [deviceId];

        const result = await this.database.query(queryText, queryValues);
        if (!result || !result.ok) {
            return { ok: false, error: (result && result.error) || 'delete failed' };
        }
        if (result.rowCount === 0) {
            return { ok: false, error: 'device_not_found' };
        }

        return { ok: true, deleted: true };
    }
}

export default DevicesRepo;
