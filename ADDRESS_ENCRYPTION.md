# Encrypted Address Storage

## Overview

User shipping/delivery addresses are stored in an encrypted format using a combination of:
- **System encryption key** (from `ADDRESS_ENCRYPTION_KEY` environment variable)
- **User's secret phrase** (unique per user)

This provides dual-layer encryption: even if the database is compromised, addresses cannot be decrypted without both the system key AND the user's secret phrase.

## Implementation

### Backend (Python)

1. **Encryption Utility**: `telegram-bot-service/utils/address_encryption.py`
   - Uses Fernet (AES-128-CBC with HMAC) for authenticated encryption
   - Combines system key + user secret phrase for key derivation

2. **Order Model**: Updated to include `encrypted_address` field
   - Stored as base64-encoded string in MongoDB
   - Only decrypted when needed (e.g., for shipping)

### Frontend (Admin Panel)

1. **Decryption API**: `admin-panel/app/api/orders/[id]/decrypt-address/route.ts`
   - Requires admin authentication
   - Retrieves user's secret phrase from database
   - Decrypts address for display

2. **Order Model**: Updated TypeScript interface to include `encrypted_address`

## Setup

### 1. Generate Encryption Key

Generate a secure encryption key:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 2. Add to Environment Variables

**telegram-bot-service/.env:**
```
ADDRESS_ENCRYPTION_KEY=your_generated_base64_key_here
```

**admin-panel/.env:**
```
ADDRESS_ENCRYPTION_KEY=your_generated_base64_key_here
```

⚠️ **IMPORTANT**: Use the SAME key in both services for decryption to work.

### 3. Install Dependencies

**telegram-bot-service:**
```bash
pip install cryptography>=41.0.0
```

## Usage

### Encrypting an Address (Python)

```python
from utils.address_encryption import encrypt_address
from utils.secret_phrase import get_or_create_user_secret_phrase

# Get user's secret phrase
user_secret = await get_or_create_user_secret_phrase(user_id, bot_id)

# Encrypt address
address_data = "123 Main St, City, State 12345, Country"
encrypted = encrypt_address(address_data, user_secret)

# Store in order
order['encrypted_address'] = encrypted
```

### Decrypting an Address (Python)

```python
from utils.address_encryption import decrypt_address

# Decrypt address
decrypted = decrypt_address(encrypted_address, user_secret_phrase)
if decrypted:
    print(f"Address: {decrypted}")
```

### Decrypting via API (Admin Panel)

```typescript
// GET /api/orders/[orderId]/decrypt-address
const response = await fetch(`/api/orders/${orderId}/decrypt-address`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const { address } = await response.json();
```

## Security Considerations

1. **Key Management**: 
   - Never commit encryption keys to version control
   - Use different keys for development/production
   - Rotate keys periodically (requires re-encryption of all addresses)

2. **Access Control**:
   - Only admins can decrypt addresses
   - Bot owners can only decrypt addresses for their own bots
   - Super-admins can decrypt all addresses

3. **Secret Phrase**:
   - User secret phrases are stored in plaintext (needed for decryption)
   - Consider additional security measures for secret phrase storage

4. **Decryption**:
   - Addresses are only decrypted when needed (e.g., for shipping labels)
   - Decrypted addresses should not be logged or stored in plaintext

## Future Enhancements

- [ ] Implement address collection flow in bot (before checkout)
- [ ] Add address validation
- [ ] Support multiple saved addresses per user
- [ ] Add address encryption key rotation tool
- [ ] Implement audit logging for address access

