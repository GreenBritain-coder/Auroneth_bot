/**
 * Address decryption utility for admin panel
 * Decrypts addresses encrypted by the Python bot using Fernet (AES-128-CBC with HMAC)
 * Uses the fernet npm package for compatibility with Python's cryptography.fernet
 */
import crypto from 'crypto';
const fernet = require('fernet');

interface DecryptionResult {
  success: boolean;
  address?: string;
  error?: string;
}

/**
 * Derive encryption key from environment variable
 * Uses the same method as Python backend
 */
function getEncryptionKey(): Buffer {
  const keyStr = process.env.ADDRESS_ENCRYPTION_KEY;
  
  if (!keyStr) {
    throw new Error('ADDRESS_ENCRYPTION_KEY not set in environment');
  }
  
  try {
    // Python does: base64.urlsafe_b64decode(key_str.encode())
    // key_str.encode() just converts string to bytes (no change), then decodes as base64url
    // So we decode the string directly as base64url
    const base64Str = keyStr.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (base64Str.length % 4)) % 4;
    const decoded = Buffer.from(base64Str + '='.repeat(padding), 'base64');
    
    // If decoded length is 32 bytes, it's likely a valid key
    if (decoded.length === 32) {
      return decoded;
    }
    
    // If not 32 bytes, try PBKDF2 derivation (same as Python fallback)
    return crypto.pbkdf2Sync(
      keyStr,
      'address_encryption_salt', // Should match Python salt
      100000,
      32,
      'sha256'
    );
  } catch (error) {
    // If base64 decode fails, derive from string using PBKDF2 (Python fallback)
    return crypto.pbkdf2Sync(
      keyStr,
      'address_encryption_salt', // Should match Python salt
      100000,
      32,
      'sha256'
    );
  }
}

/**
 * Derive Fernet key from system key + user secret phrase
 */
function deriveFernetKey(systemKey: Buffer, userSecretPhrase: string): Buffer {
  // Python does: 
  //   combined_key = hashes.Hash(hashes.SHA256())
  //   combined_key.update(system_key)  # bytes (32 bytes)
  //   combined_key.update(user_secret_phrase.encode())  # UTF-8 encoded bytes
  //   derived_key = combined_key.finalize()  # returns 32 bytes
  //   fernet_key = base64.urlsafe_b64encode(derived_key[:32])  # encodes all 32 bytes
  
  // Important: user_secret_phrase.encode() uses UTF-8 encoding in Python
  // Both updates must be in the exact same order
  const hash = crypto.createHash('sha256');
  
  // First update: system key (must be exactly as Python does it)
  hash.update(systemKey);
  
  // Second update: user secret phrase as UTF-8 bytes (must match Python's .encode())
  const userSecretBytes = Buffer.from(userSecretPhrase, 'utf-8');
  hash.update(userSecretBytes);
  
  // Finalize to get the 32-byte hash
  const derivedKey = hash.digest();
  
  // Return the full 32 bytes (Python takes [:32] but digest() already returns 32 bytes)
  return derivedKey;
}

/**
 * Decrypt address using Fernet (AES-128-CBC with HMAC)
 * 
 * @param encryptedAddress - Base64 encoded encrypted address
 * @param userSecretPhrase - User's secret phrase
 * @returns Decrypted address or error
 */
export async function decryptAddress(
  encryptedAddress: string,
  userSecretPhrase: string
): Promise<DecryptionResult> {
  try {
    const systemKey = getEncryptionKey();
    
    // Python does: 
    //   SHA256(system_key + user_secret_phrase) -> get 32 bytes
    //   fernet_key = base64.urlsafe_b64encode(derived_key[:32])
    const derivedKey = deriveFernetKey(systemKey, userSecretPhrase);
    
    // Create Fernet key in base64url format (same as Python)
    // Python's base64.urlsafe_b64encode() keeps padding!
    // Format: base64 encoding with + -> - and / -> _ (keeps = padding)
    // Python does: base64.urlsafe_b64encode(derived_key[:32]) -> 44 chars with padding
    const base64Encoded = derivedKey.toString('base64');
    const fernetKeyBase64 = base64Encoded
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    // DO NOT remove padding - Python keeps it!
    // Python's base64.urlsafe_b64encode() produces 44 chars for 32 bytes (with padding)
    
    // Verify it's 44 characters (32 bytes in base64url = 44 chars with padding)
    if (fernetKeyBase64.length !== 44) {
      console.error('Fernet key length mismatch:', fernetKeyBase64.length, 'expected 44 (with padding). Base64 was:', base64Encoded.length, 'chars');
    }
    
    console.log('=== DECRYPTION START ===');
    console.log('System key length:', systemKey.length);
    console.log('System key hex:', systemKey.toString('hex'));
    console.log('System key base64url (for verification):', systemKey.toString('base64').replace(/\+/g, '-').replace(/\//g, '_'));
    console.log('User secret phrase:', userSecretPhrase);
    console.log('User secret phrase length:', userSecretPhrase.length);
    console.log('User secret phrase bytes (hex):', Buffer.from(userSecretPhrase, 'utf-8').toString('hex'));
    console.log('Derived key hex:', derivedKey.toString('hex'));
    console.log('Fernet key base64url:', fernetKeyBase64);
    console.log('Fernet key length:', fernetKeyBase64.length);
    console.log('Encrypted address length:', encryptedAddress.length);
    console.log('Encrypted address prefix:', encryptedAddress.substring(0, 30));
    
    // Verify ADDRESS_ENCRYPTION_KEY is set
    const envKey = process.env.ADDRESS_ENCRYPTION_KEY;
    if (envKey) {
      console.log('ADDRESS_ENCRYPTION_KEY is set (length:', envKey.length, ')');
      console.log('ADDRESS_ENCRYPTION_KEY (first 20 chars):', envKey.substring(0, 20));
    } else {
      console.error('WARNING: ADDRESS_ENCRYPTION_KEY is NOT set!');
    }
    
    // Python encrypt: fernet.encrypt() -> bytes -> base64.urlsafe_b64encode() -> string stored in DB
    // Python decrypt: base64.urlsafe_b64decode(encrypted_address.encode()) -> bytes -> fernet.decrypt()
    // So encrypted_address in DB is a base64url string that represents the Fernet token
    // The fernet npm package expects the base64url string directly (it handles decoding internally)
    try {
      // The stored value is already a base64url string - use it directly
      // Clean any whitespace that might have been introduced
      const fernetToken = encryptedAddress.trim();
      
      // Verify the token decodes to valid Fernet token bytes (starts with 0x80)
      // The token in the database is base64url encoded, so we need to decode it
      const base64url = fernetToken.replace(/-/g, '+').replace(/_/g, '/');
      const padding = (4 - (base64url.length % 4)) % 4;
      let fernetTokenBytes: Buffer;
      let actualFernetTokenString = fernetToken;
      
      try {
        fernetTokenBytes = Buffer.from(base64url + '='.repeat(padding), 'base64');
      } catch (e) {
        // If decoding fails, the token might already be in a different format
        // Try decoding without padding modifications
        fernetTokenBytes = Buffer.from(base64url, 'base64');
      }
      
      console.log('=== BEFORE DECODE ===');
      console.log('System key hex:', systemKey.toString('hex'));
      console.log('User secret phrase:', userSecretPhrase);
      console.log('Derived key hex:', derivedKey.toString('hex'));
      console.log('Fernet key:', fernetKeyBase64);
      console.log('Token (base64url, first 60 chars):', fernetToken.substring(0, 60));
      console.log('Token bytes length:', fernetTokenBytes.length);
      console.log('Token first byte (hex):', fernetTokenBytes[0]?.toString(16));
      console.log('Token first byte (decimal):', fernetTokenBytes[0]);
      console.log('Expected version byte: 0x80 (128)');
      
      // Check if the token is double-encoded (the decoded bytes are another base64url string)
      if (fernetTokenBytes[0] !== 0x80) {
        // If it doesn't start with 0x80, it might be double-encoded
        // Try to extract the inner base64url string
        const innerBase64url = fernetTokenBytes.toString('utf-8').trim();
        console.log('Token does not start with 0x80, checking for double-encoding...');
        console.log('Decoded as UTF-8 (first 60 chars):', innerBase64url.substring(0, 60));
        
        // Try decoding the inner base64url string
        const innerBase64 = innerBase64url.replace(/-/g, '+').replace(/_/g, '/');
        const innerPadding = (4 - (innerBase64.length % 4)) % 4;
        
        try {
          const innerTokenBytes = Buffer.from(innerBase64 + '='.repeat(innerPadding), 'base64');
          console.log('Inner token first byte (hex):', innerTokenBytes[0]?.toString(16));
          console.log('Inner token first byte (decimal):', innerTokenBytes[0]);
          
          if (innerTokenBytes[0] === 0x80) {
            // Found valid Fernet token bytes - use the inner base64url string
            console.log('=== DOUBLE-ENCODING DETECTED ===');
            console.log('Found valid Fernet token in inner encoding!');
            console.log('Outer token (first 60 chars):', fernetToken.substring(0, 60));
            console.log('Inner token (first 60 chars):', innerBase64url.substring(0, 60));
            console.log('Using inner token for decryption');
            actualFernetTokenString = innerBase64url;
            fernetTokenBytes = innerTokenBytes;
          } else {
            console.error('Inner token also does not start with 0x80');
            console.error('First 10 bytes hex:', innerTokenBytes.slice(0, 10).toString('hex'));
            return {
              success: false,
              error: `Invalid token format: version byte is 0x${innerTokenBytes[0]?.toString(16) || 'unknown'}, expected 0x80. The token may be corrupted or in an unexpected format.`
            };
          }
        } catch (innerError) {
          console.error('Failed to decode inner base64url string:', innerError);
          return {
            success: false,
            error: `Invalid token format: cannot decode inner base64url string. The token may be corrupted.`
          };
        }
      }
      
      // Create a Fernet secret from the key
      // Try with padding first (Python format - 44 chars)
      // Use the actual Fernet token string (may be inner token if double-encoded)
      console.log('=== ATTEMPTING DECRYPTION ===');
      console.log('Using token (first 60 chars):', actualFernetTokenString.substring(0, 60));
      console.log('Token length:', actualFernetTokenString.length);
      console.log('Fernet key (with padding):', fernetKeyBase64);
      
      let secret = new fernet.Secret(fernetKeyBase64);
      let token = new fernet.Token({
        secret: secret,
        token: actualFernetTokenString,
        ttl: 0
      });
      
      try {
        const decrypted = token.decode();
        console.log('=== DECRYPTION SUCCESS (with padding) ===');
        return {
          success: true,
          address: decrypted
        };
      } catch (decodeError1: any) {
        console.log('Failed with padding, trying without padding...');
        console.log('Error with padding:', decodeError1.message);
        
        // Try without padding (standard Fernet format - 43 chars)
        const fernetKeyNoPadding = fernetKeyBase64.replace(/=/g, '');
        
        if (fernetKeyNoPadding.length === 43) {
          secret = new fernet.Secret(fernetKeyNoPadding);
          token = new fernet.Token({
            secret: secret,
            token: actualFernetTokenString,
            ttl: 0
          });
          
          try {
            const decrypted = token.decode();
            console.log('=== DECRYPTION SUCCESS (without padding) ===');
            return {
              success: true,
              address: decrypted
            };
          } catch (decodeError2: any) {
            console.error('=== DECODE ERROR (both attempts failed) ===');
            console.error('HMAC Verification Failed with both key formats');
            console.error('');
            console.error('DIAGNOSIS: The encryption key or user secret phrase does not match.');
            console.error('⚠️  This usually means the user changed their secret phrase after creating the order.');
            console.error('This means the token was encrypted with different parameters than what we have.');
            console.error('');
            console.error('⚠️  COMMON CAUSE: User changed their secret phrase after order creation!');
            console.error('   If the user changed their secret phrase, old orders cannot be decrypted');
            console.error('   with the new secret phrase. The order was encrypted with the OLD phrase.');
            console.error('');
            console.error('TO FIX THIS:');
            console.error('1. Verify ADDRESS_ENCRYPTION_KEY is IDENTICAL in both services:');
            console.error('   - telegram-bot-service/.env');
            console.error('   - admin-panel/.env');
            console.error('   Current value (admin-panel):', process.env.ADDRESS_ENCRYPTION_KEY?.substring(0, 20) + '...');
            console.error('');
            console.error('2. ⚠️  SECRET PHRASE MISMATCH:');
            console.error('   The order was encrypted with a DIFFERENT secret phrase than the current one.');
            console.error('   Current secret phrase in database:', userSecretPhrase);
            console.error('   This likely means the user changed their secret phrase after creating this order.');
            console.error('   SOLUTION: You need to use the secret phrase that was active when the order was created.');
            console.error('');
            console.error('3. If the order was created before setting up encryption keys, it cannot be decrypted.');
            console.error('   You may need to recreate the order with the correct keys.');
            console.error('');
            console.error('Current values:');
            console.error('  System key hex:', systemKey.toString('hex'));
            console.error('  System key base64url:', systemKey.toString('base64').replace(/\+/g, '-').replace(/\//g, '_'));
            console.error('  User secret phrase:', userSecretPhrase);
            console.error('  User secret phrase length:', userSecretPhrase.length);
            console.error('  User secret phrase bytes (hex):', Buffer.from(userSecretPhrase, 'utf-8').toString('hex'));
            console.error('  Derived key hex:', derivedKey.toString('hex'));
            console.error('  Derived Fernet key (with padding):', fernetKeyBase64);
            console.error('  Derived Fernet key (without padding):', fernetKeyNoPadding);
            console.error('  Token actually used (first 60 chars):', actualFernetTokenString.substring(0, 60));
            console.error('  Token actually used (length):', actualFernetTokenString.length);
            console.error('  Error 1:', decodeError1.message);
            console.error('  Error 2:', decodeError2.message);
            throw decodeError2;
          }
        } else {
          console.error('=== DECODE ERROR ===');
          console.error('HMAC Verification Failed');
          console.error('Fernet key without padding has unexpected length:', fernetKeyNoPadding.length);
          console.error('Fernet key (with padding):', fernetKeyBase64);
          console.error('Token actually used (first 60 chars):', actualFernetTokenString.substring(0, 60));
          console.error('Error:', decodeError1.message);
          throw decodeError1;
        }
      }
      
    } catch (decryptError: any) {
      console.error('Error decrypting with Fernet library:', decryptError);
      return {
        success: false,
        error: `Decryption failed: ${decryptError.message}`
      };
    }
  } catch (error: any) {
    console.error('Error in decryptAddress:', error);
    return {
      success: false,
      error: error.message || 'Unknown error during decryption'
    };
  }
}
