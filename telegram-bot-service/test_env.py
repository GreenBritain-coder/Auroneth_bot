import os
import sys
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
print(f"Loading .env from: {env_path}")
print(f"File exists: {env_path.exists()}")

load_dotenv(dotenv_path=env_path)
key = os.getenv("ADDRESS_ENCRYPTION_KEY")
if key:
    print(f"✓ ADDRESS_ENCRYPTION_KEY found: {key[:30]}...")
else:
    print("✗ ADDRESS_ENCRYPTION_KEY NOT found!")
