import tokenUtils from "../tokenUtils.js";

export default class TokenService {
    constructor(database) {
        // Go on only if database instance is not null!
        if (!database) {
            throw new Error('Database instance required');
        }
        this.database = database;
    }
    generateClaimToken() {
        const token = tokenUtils.generateToken();
        const tokenHash = tokenUtils.hashToken(token);
        const claimUrl = tokenUtils.buildClaimUrl(token);
        return { token, tokenHash, claimUrl };
    }

    validateToken(token) {
        const tokenHash = tokenUtils.hashToken(token);
        
        return this.database.query(
            'SELECT 1 FROM devices WHERE token_hash = $1',
            [tokenHash]        ).then(response => {
            const rowCount =
                response && typeof response.rowCount === 'number'
                    ? response.rowCount
                    : 0;
            return { ok: true, valid: rowCount === 1 };
        }).catch(err => {
            console.error(`Error querying for token: ${err.message || String(err)}`);
            return { ok: false, error: err.message || String(err) };
        });
    }

}