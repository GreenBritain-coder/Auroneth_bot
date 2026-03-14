#!/usr/bin/env python3
"""
Verify that ADDRESS_ENCRYPTION_KEY is properly configured and being used
"""
import os
import sys
import base64
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

def main():
    print("=" * 60)
    print("Encryption Key Verification")
    print("=" * 60)
    
    key_str = os.getenv("ADDRESS_ENCRYPTION_KEY")
    
    if not key_str:
        print("❌ ERROR: ADDRESS_ENCRYPTION_KEY is NOT set in .env file!")
        print("\nTo fix:")
        print("1. Run: py -3.12 scripts/generate_encryption_key.py")
        print("2. Copy the generated key")
        print("3. Add to telegram-bot-service/.env:")
        print("   ADDRESS_ENCRYPTION_KEY=<generated_key>")
        print("4. Restart the bot service")
        return False
    
    print(f"✓ ADDRESS_ENCRYPTION_KEY is set")
    print(f"  Key length: {len(key_str)} characters")
    print(f"  Key (first 20 chars): {key_str[:20]}...")
    
    # Try to decode it
    try:
        decoded = base64.urlsafe_b64decode(key_str.encode())
        if len(decoded) == 32:
            print(f"✓ Key is valid base64url (32 bytes)")
            print(f"  Key hex: {decoded.hex()[:32]}...")
            return True
        else:
            print(f"⚠️  Warning: Key decoded to {len(decoded)} bytes (expected 32)")
            print("   The key will be derived using PBKDF2 instead")
            return True
    except Exception as e:
        print(f"⚠️  Key is not base64url format (will use PBKDF2 derivation): {e}")
        return True
    
    print("\n" + "=" * 60)
    print("IMPORTANT: Use the SAME key in admin-panel/.env.local")
    print("=" * 60)

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
