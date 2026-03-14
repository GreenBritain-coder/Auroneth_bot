"""
Utility functions for generating short invoice IDs
"""
import random


async def generate_short_invoice_id(length: int = 8, db=None) -> str:
    """
    Generate a short, numeric-only invoice ID that is unique
    
    Args:
        length: Length of the invoice ID (default: 8)
        db: Optional database instance to check for uniqueness
    
    Returns:
        A unique numeric invoice ID (e.g., "12345678")
    """
    max_attempts = 100
    for attempt in range(max_attempts):
        # Generate random numeric ID
        # Start with 1-9 to avoid leading zeros, then use 0-9 for remaining digits
        first_digit = str(random.randint(1, 9))
        remaining_digits = ''.join(str(random.randint(0, 9)) for _ in range(length - 1))
        invoice_id = first_digit + remaining_digits
        
        # Check for uniqueness if database is provided
        if db is not None:
            invoices_collection = db.invoices
            orders_collection = db.orders
            
            # Check if invoice_id exists in invoices
            existing_invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
            # Check if invoice_id exists as order _id
            existing_order = await orders_collection.find_one({"_id": invoice_id})
            
            if not existing_invoice and not existing_order:
                return invoice_id
        else:
            # If no database provided, just return the generated ID
            return invoice_id
    
    # If we couldn't generate a unique ID after max attempts, use a longer ID
    # This should be extremely rare
    first_digit = str(random.randint(1, 9))
    remaining_digits = ''.join(str(random.randint(0, 9)) for _ in range(length + 4))
    return first_digit + remaining_digits

