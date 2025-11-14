const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('base64url'); // URL-safe
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { generateToken, hashToken };
