import os
from dotenv import load_dotenv

load_dotenv()

COMMISSION_RATE = float(os.getenv("PLATFORM_COMMISSION_RATE", os.getenv("COMMISSION_RATE", "0.10")))  # Default 10%


def calculate_commission(amount: float, rate: float = None) -> float:
    """Calculate commission from order amount"""
    if rate is None:
        rate = COMMISSION_RATE
    return round(amount * rate, 8)  # Round to 8 decimal places for crypto

