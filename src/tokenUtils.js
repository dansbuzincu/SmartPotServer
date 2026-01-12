import crypto from 'crypto';

function generateToken() {
  // 32 bytes → base64url string
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  // SHA-256 → base64url (matches your DB schema)
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function buildClaimUrl(token) {
  const CLAIM_BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  return `${CLAIM_BASE_URL}/api/claim?token=${encodeURIComponent(token)}`;
}

export default {
  generateToken,
  hashToken,
  buildClaimUrl
};
