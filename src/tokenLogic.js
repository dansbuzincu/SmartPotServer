import tokenUtils from './tokenUtils.js';

// Create validator via factory with dependency injection
function createTokenValidator(database) {

  // Throw error in case of null database
  if (!database) {
    throw new Error('Database instance required');
  }

  // Validate a token by hashing and checking in DB
  async function validateToken(token) {
    if (!token) {
      return { ok: false, error: 'missing-token' };
    }

    // Generate hash for input token
    const hashToken = tokenUtils.hashToken(token);

    try {
      const response = await database.query(
        'SELECT 1 FROM devices WHERE token_hash = $1',
        [hashToken]
      );

      const rowCount =
        response && typeof response.rowCount === 'number'
          ? response.rowCount
          : 0;

      return { ok: true, valid: rowCount === 1 };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  return { validateToken };
}

export { createTokenValidator };
