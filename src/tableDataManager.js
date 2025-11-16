const tokenLogic = require('./tokenLogic');

// Magic uuid of 32 bytes until uuids are defined
const magicUuid = '00000000000000000000000000000000';

// TODO : extend functionality to support other tables
function tableDataManager(database) {
    // Go on only if database instance is not null!
    if( !database ) {
        throw new Error('Database instance required');
    }

    // 4 Fields are required for a device in devices table : unique_id, token_hash, name
    // unique_id : some kind of int
    // token_hash : sha256 hash of the token
    // claimed : boolean - whether the device was claimed by a user
    // name : optional - for later use
    async function composeRow() {
        const token = tokenLogic.generateToken();
        const tokenHash = tokenLogic.hashToken(token);

        const row = {
            unique_id: magicUuid,
            token_hash: tokenHash,
            claimed: false,
            name: ''
        };

        return row;
    }

    async function insertRow(row) {

        const queryText = 'INSERT INTO devices (unique_id, token_hash, claimed, name) VALUES ($1, $2, $3, $4) RETURNING *';
        const queryValues = [row.unique_id, row.token_hash, row.claimed, row.name];

        try {
            const result = await database.query(queryText, queryValues);
            // Show message on successful insertion
            return res.status(201).json({
                success: true,
                message: "Device registered successfully",
                device: result.rows[0]
            });
        }
        catch (err) {
            return res.status(500).json({
                success: false,
                message: "Could not insert device data",
                device: err.message || String(err)
            });
        }
    }

    async function queryForToken(token) {
        const tokenValidator = tokenLogic.createTokenValidator(database);
        return await tokenValidator.validateToken(token);
    }
}

module.exports = { tableDataManager };
