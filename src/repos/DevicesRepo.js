import tokenUtils from '../tokenUtils.js';

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

    // 4 Fields are required for a device in devices table : unique_id, token_hash, claimed, name
    // unique_id : some kind of uuid / id
    // token_hash : sha256 hash of the token
    // claimed : boolean - whether the device was claimed by a user
    // name : optional - for later use

    // This is for test purposes
    async newDeviceRow(token) {
        const tokenHash = tokenUtils.hashToken(token);

        const row = {
            unique_id: magicUuid,
            token_hash: tokenHash,
            claimed: false,
            name: ''
        };

        return row;
    }

    async insertRow(row) {
        const queryText =
            'INSERT INTO devices (unique_id, token_hash, claimed, name) VALUES ($1, $2, $3, $4) RETURNING *';
        const queryValues = [row.unique_id, row.token_hash, row.claimed, row.name];

        try {
            const result = await this.database.query(queryText, queryValues);
            if (!result || !result.ok || !result.rows || result.rows.length === 0) {
                return { ok: false, error: 'insert failed, no rows returned' };
            }
            return { ok: true, device: result.rows[0] };
        } catch (err) {
            // Postgres unique constraint error code
            if (err && err.code === '23505') {
                return { ok: false, error: 'unique_id_exists', message: 'device with that unique_id already exists' };
            }
            return { ok: false, error: err.message || String(err) };
        }
    }

    // This will be called by ESP32 device to claim the token
    async claimToken(token) {
        // `token` is expected to be a token hash. If a raw token is passed, callers should hash it.
        const tokenHash = token;
        const queryText = 'UPDATE devices SET claimed = true WHERE token_hash = $1 AND claimed = false RETURNING *';
        const queryValues = [tokenHash];

        try {
            const result = await this.database.query(queryText, queryValues);

            if (!result || !result.ok || result.rowCount === 0) {
                return { ok: false, error: 'no device found with that token hash' };
            }

            return { ok: true, device: result.rows[0] };
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    }

    async queryForToken(token) {
        const tokenHash = tokenUtils.hashToken(token);
        const queryText = 'SELECT * FROM devices WHERE token_hash = $1 LIMIT 1';
        const queryValues = [tokenHash];

        try {
            const result = await this.database.query(queryText, queryValues);
            if (!result || !result.ok || !result.rows || result.rows.length === 0) {
                return { ok: false, error: 'no device found with that token' };
            }
            return { ok: true, device: result.rows[0] };
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    }
}

export default DevicesRepo;
