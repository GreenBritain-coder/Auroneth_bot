#!/usr/bin/env python3
"""
Test script to verify ADDRESS_ENCRYPTION_KEY is being loaded correctly
"""
import sys
import os
from pathlib import Path
from dotenv import load_dotenv

# Fix Unicode encoding for Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env
env_path = Path(__file__).parent.parent / ".env"
print(f"Loading .env from: {env_path}")
print(f"File exists: {env_path.exists()}\n")

load_dotenv(dotenv_path=env_path)

# Check key
key = os.getenv("ADDRESS_ENCRYPTION_KEY")
if key:
    print(f"✓ ADDRESS_ENCRYPTION_KEY found!")
    print(f"  Key length: {len(key)} characters")
    print(f"  Key (first 30 chars): {key[:30]}...")
    print(f"  Key (last 10 chars): ...{key[-10:]}")
else:
    print("✗ ADDRESS_ENCRYPTION_KEY NOT found in environment!")
    print("\nThis means the bot will generate a random key each time,")
    print("and addresses cannot be decrypted in the admin panel.")

# Test importing the encryption utility
try:
    from utils.address_encryption import get_encryption_key
    test_key = get_encryption_key()
    print(f"\n✓ Encryption utility can load key")
    print(f"  Key bytes length: {len(test_key)} bytes")
    print(f"  Key hex (first 32 chars): {test_key.hex()[:32]}...")
except Exception as e:
    print(f"\n✗ Error loading encryption utility: {e}")

print("\n" + "=" * 60)
print("IMPORTANT: Restart the bot service if the key was just added!")
print("=" * 60)
