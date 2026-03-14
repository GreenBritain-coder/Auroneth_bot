#!/usr/bin/env python3
"""
Test script to verify decryption with the same values from Node.js logs
"""
import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes

# Values from Node.js logs
ENCRYPTED_ADDRESS = "Z0FBQUFBQnBDY1NmWXNDXzQ3b1RneER2TEZVNDhRdjNUNUhTU3NucThxM1Yt"  # Outer token
USER_SECRET_PHRASE = "Hello!"
SYSTEM_KEY_BASE64URL = "pPELJJX8LjZwWK-FVmIyb8j4sLlh5BvCr3Yf9WaA088="

def test_decryption():
    # Set the environment variable to match what Node.js is using
    os.environ["ADDRESS_ENCRYPTION_KEY"] = SYSTEM_KEY_BASE64URL
    
    # Decode system key
    system_key = base64.urlsafe_b64decode(SYSTEM_KEY_BASE64URL.encode())
    print(f"System key hex: {system_key.hex()}")
    print(f"System key length: {len(system_key)} bytes")
    
    # Derive Fernet key
    combined_key = hashes.Hash(hashes.SHA256())
    combined_key.update(system_key)
    combined_key.update(USER_SECRET_PHRASE.encode())
    derived_key = combined_key.finalize()
    
    print(f"Derived key hex: {derived_key.hex()}")
    print(f"User secret phrase: {USER_SECRET_PHRASE}")
    print(f"User secret phrase bytes (hex): {USER_SECRET_PHRASE.encode().hex()}")
    
    # Create Fernet key
    fernet_key = base64.urlsafe_b64encode(derived_key[:32])
    print(f"Fernet key (base64url): {fernet_key.decode()}")
    print(f"Fernet key length: {len(fernet_key)}")
    
    fernet = Fernet(fernet_key)
    
    # Decode the outer token to get inner token
    try:
        outer_bytes = base64.urlsafe_b64decode(ENCRYPTED_ADDRESS.encode())
        inner_token = outer_bytes.decode('utf-8')
        print(f"\nOuter token: {ENCRYPTED_ADDRESS[:60]}...")
        print(f"Inner token: {inner_token[:60]}...")
        print(f"Inner token length: {len(inner_token)}")
        
        # Decode inner token to bytes
        inner_bytes = base64.urlsafe_b64decode(inner_token.encode())
        print(f"Inner token first byte (hex): {hex(inner_bytes[0])}")
        
        # Try to decrypt
        print("\nAttempting decryption...")
        decrypted = fernet.decrypt(inner_bytes)
        address = decrypted.decode()
        print(f"✅ SUCCESS! Decrypted address: {address}")
        return True
    except Exception as e:
        print(f"❌ FAILED: {e}")
        print(f"Error type: {type(e).__name__}")
        return False

if __name__ == "__main__":
    print("=== Python Decryption Test ===")
    print("Testing with values from Node.js logs...\n")
    success = test_decryption()
    if not success:
        print("\n⚠️  This means the keys don't match what was used during encryption.")
        print("Check that ADDRESS_ENCRYPTION_KEY in telegram-bot-service/.env matches")
        print("the value used when the order was created.")

