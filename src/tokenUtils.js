const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('base64url'); // URL-safe
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function buildClaimUrl(token) {
  const CLAIM_BASE_URL = process.env.BASE_URL || 'http://localhost:3000/';
  return '${CLAIM_BASE_URL}/claim?token=${encodeURIComponent(token)}';
}
module.exports = { generateToken, hashToken, buildClaimUrl };
