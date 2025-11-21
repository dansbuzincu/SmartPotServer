import tokenUtils from './tokenUtils.js';
import { createTokenValidator } from './tokenLogic.js';

// Magic uuid of 32 bytes until uuids are defined
const magicUuid = '00000000000000000000000000000000';

// TODO : extend functionality to support other tables
function tableDataManager(database) {
    // Go on only if database instance is not null!
    if (!database) {
        throw new Error('Database instance required');
    }

    // 4 Fields are required for a device in devices table : unique_id, token_hash, claimed, name
    // unique_id : some kind of uuid / id
    // token_hash : sha256 hash of the token
    // claimed : boolean - whether the device was claimed by a user
    // name : optional - for later use
    async function composeTestRow() {
        const token = tokenUtils.generateToken();
        const tokenHash = tokenUtils.hashToken(token);

        const row = {
            unique_id: magicUuid,
            token_hash: tokenHash,
            claimed: false,
            name: ''
        };

        return row;
    }

    async function composeRow(token) {
        const tokenHash = tokenUtils.hashToken(token);

        const row = {
            unique_id: magicUuid,
            token_hash: tokenHash,
            claimed: false,
            name: ''
        };

        return row;
    }

    async function insertRow(row) {
        const queryText =
            'INSERT INTO devices (unique_id, claim_token, claimed, name) VALUES ($1, $2, $3, $4) RETURNING *';
        const queryValues = [row.unique_id, row.token_hash, row.claimed, row.name];

        try {
            const result = await database.query(queryText, queryValues);
            if (!result || !result.ok) {
                return {
                    ok: false,
                    error: result && result.error ? result.error : 'database insert failed'
                };
            }
            if (!result.rows || !result.rows[0]) {
                return { ok: false, error: 'insert returned no rows' };
            }
            return { ok: true, device: result.rows[0] };
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    }

    async function queryForToken(token) {
        const tokenValidator = createTokenValidator(database);
        return await tokenValidator.validateToken(token);
    }

    // This will be called by ESP32 device to claim the token
    async function claimToken(token) {
        const tokenHash = tokenUtils.hashToken(token);
        const queryText = 'UPDATE devices SET claimed = true WHERE token_hash = $1 RETURNING *';
        const queryValues = [tokenHash];

        try {
            const result = await database.query(queryText, queryValues);

            if (!result || result.rowCount === 0) {
                return { ok: false, error: 'no device found with that token hash' };
            }

            return { ok: true, device: result.rows[0] };
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    }

    return { composeTestRow, composeRow, insertRow, queryForToken, claimToken };
}

export { tableDataManager };
