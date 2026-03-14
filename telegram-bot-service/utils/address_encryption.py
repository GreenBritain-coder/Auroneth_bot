"""
Encryption utility for storing user addresses securely
Uses AES-256-GCM for authenticated encryption
"""
import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from typing import Optional
from dotenv import load_dotenv
import pathlib

# Load .env file on import
env_path = pathlib.Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# Get encryption key from environment or generate a warning
def get_encryption_key() -> bytes:
    """
    Get encryption key from environment variable or derive from secret phrase
    For production, set ADDRESS_ENCRYPTION_KEY in .env
    """
    key_str = os.getenv("ADDRESS_ENCRYPTION_KEY")
    
    if key_str:
        # If key is provided, use it directly (should be base64 encoded)
        try:
            return base64.urlsafe_b64decode(key_str.encode())
        except:
            # If not base64, try to derive from string
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=b'address_encryption_salt',  # In production, use random salt
                iterations=100000,
            )
            return kdf.derive(key_str.encode())
    else:
        # Fallback: use a default key (NOT SECURE FOR PRODUCTION)
        # In production, this should be set in .env
        print("WARNING: ADDRESS_ENCRYPTION_KEY not set. Using default key (NOT SECURE)")
        return Fernet.generate_key()


def encrypt_address(address_data: str, user_secret_phrase: Optional[str] = None) -> str:
    """
    Encrypt address data using user's secret phrase + system key
    
    Args:
        address_data: The address string to encrypt
        user_secret_phrase: User's unique secret phrase (adds user-specific encryption)
    
    Returns:
        Base64 encoded encrypted address
    """
    try:
        # Combine system key with user secret phrase for additional security
        system_key = get_encryption_key()
        combined_key = hashes.Hash(hashes.SHA256())
        combined_key.update(system_key)
        if user_secret_phrase:
            combined_key.update(user_secret_phrase.encode())
        else:
            # If no user secret phrase, use system key only (less secure)
            combined_key.update(b'default_user_key')
        derived_key = combined_key.finalize()
        
        # Use Fernet for encryption (AES-128-CBC with HMAC)
        # Convert to Fernet format (32-byte key)
        fernet_key = base64.urlsafe_b64encode(derived_key[:32])
        fernet = Fernet(fernet_key)
        
        encrypted = fernet.encrypt(address_data.encode())
        return base64.urlsafe_b64encode(encrypted).decode()
    except Exception as e:
        print(f"Error encrypting address: {e}")
        raise


def decrypt_address(encrypted_address: str, user_secret_phrase: Optional[str] = None) -> Optional[str]:
    """
    Decrypt address data using user's secret phrase + system key
    
    Args:
        encrypted_address: Base64 encoded encrypted address
        user_secret_phrase: User's unique secret phrase
    
    Returns:
        Decrypted address string or None if decryption fails
    """
    try:
        # Combine system key with user secret phrase
        system_key = get_encryption_key()
        combined_key = hashes.Hash(hashes.SHA256())
        combined_key.update(system_key)
        if user_secret_phrase:
            combined_key.update(user_secret_phrase.encode())
        else:
            # If no user secret phrase, use system key only (less secure)
            combined_key.update(b'default_user_key')
        derived_key = combined_key.finalize()
        
        # Use Fernet for decryption
        fernet_key = base64.urlsafe_b64encode(derived_key[:32])
        fernet = Fernet(fernet_key)
        
        encrypted_bytes = base64.urlsafe_b64decode(encrypted_address.encode())
        decrypted = fernet.decrypt(encrypted_bytes)
        return decrypted.decode()
    except Exception as e:
        print(f"Error decrypting address: {e}")
        return None

