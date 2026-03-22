import crypto from 'crypto';
const fernet = require('fernet');

function getEncryptionKey(): Buffer {
  const keyStr = process.env.ADDRESS_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error('ADDRESS_ENCRYPTION_KEY not set in environment');
  }

  try {
    const base64Str = keyStr.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (base64Str.length % 4)) % 4;
    const decoded = Buffer.from(base64Str + '='.repeat(padding), 'base64');
    if (decoded.length === 32) {
      return decoded;
    }
    return crypto.pbkdf2Sync(keyStr, 'address_encryption_salt', 100000, 32, 'sha256');
  } catch {
    return crypto.pbkdf2Sync(keyStr, 'address_encryption_salt', 100000, 32, 'sha256');
  }
}

function deriveFernetKey(systemKey: Buffer, userSecretPhrase: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(systemKey);
  hash.update(Buffer.from(userSecretPhrase, 'utf-8'));
  const derivedKey = hash.digest();
  // base64url encode with padding (matches Python's base64.urlsafe_b64encode)
  return derivedKey.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Encrypt address data using Fernet, matching Python bot's encrypt_address()
 * Output: base64url(fernet_token) — double-encoded to match Python format
 */
export function encryptAddress(addressData: string, userSecretPhrase: string): string {
  const systemKey = getEncryptionKey();
  const fernetKey = deriveFernetKey(systemKey, userSecretPhrase);

  const secret = new fernet.Secret(fernetKey);
  const token = new fernet.Token({ secret });
  const encrypted = token.encode(addressData);

  // Python does: base64.urlsafe_b64encode(fernet.encrypt(...))
  // fernet.encrypt returns bytes, then double-encoded with base64url
  // The npm fernet token.encode() returns a base64url string (the raw fernet token)
  // To match Python's double-encode: base64url encode the token string as bytes
  const tokenBytes = Buffer.from(encrypted, 'utf-8');
  return tokenBytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
