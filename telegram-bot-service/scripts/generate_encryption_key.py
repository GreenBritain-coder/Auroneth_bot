#!/usr/bin/env python3
"""
Generate a secure encryption key for address encryption.
This key should be added to both telegram-bot-service/.env and admin-panel/.env.local
"""
import base64
from cryptography.fernet import Fernet

def generate_key():
    """Generate a base64-encoded encryption key"""
    # Generate a random 32-byte key
    key = Fernet.generate_key()
    
    # Convert to base64url format (for .env file)
    key_str = key.decode('utf-8')
    
    print("=" * 60)
    print("ADDRESS_ENCRYPTION_KEY generated successfully!")
    print("=" * 60)
    print("\nAdd this to your .env files:")
    print(f"\nADDRESS_ENCRYPTION_KEY={key_str}\n")
    print("=" * 60)
    print("\nWhere to add it:")
    print("1. telegram-bot-service/.env")
    print("2. admin-panel/.env.local (or set as environment variable)")
    print("\nImportant: Use the SAME key in both places!")
    print("=" * 60)
    
    return key_str

if __name__ == "__main__":
    generate_key()
