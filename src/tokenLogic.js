const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('base64url'); // URL-safe
}

/**
 * Factory that accepts a db object and returns token-related logic.
 * db is expected to implement:
 *  - isConnected(): boolean
 *  - query(text, params): Promise<{ ok: true, rows, rowCount } | pgResult>
 */
function createTokenValidator(db) {
  if (!db) {
    throw new Error('Database instance required');
  }

  async function validateToken(token) {
    if (!token) {
      return { ok: false, error: 'missing-token' };
    }

    const hash = crypto.createHash('sha256').update(token).digest('hex');

    // If DB exposes isConnected use it; otherwise assume available
    if (typeof db.isConnected === 'function' && !db.isConnected()) {
      return { ok: false, error: 'no-db-connection' };
    }

    try {
      const res = await db.query('SELECT 1 FROM devices WHERE token_hash = $1', [hash]);

      // Support both wrapped results ({ok:true,rowCount}) and raw pg results
      const rowCount = res && (typeof res.rowCount === 'number' ? res.rowCount : (res.rowCount || 0));

      return { ok: true, valid: rowCount === 1 };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  return { validateToken };
}

module.exports = { createTokenValidator, generateToken };