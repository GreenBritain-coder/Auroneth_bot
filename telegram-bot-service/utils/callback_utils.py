"""
Utility functions for safely handling Telegram callback queries.
"""
from aiogram.types import CallbackQuery
from aiogram.exceptions import TelegramBadRequest
import logging

logger = logging.getLogger(__name__)


async def safe_answer_callback(callback: CallbackQuery, text: str = None, show_alert: bool = False):
    """
    Safely answer a callback query, handling expired/old queries gracefully.
    
    Args:
        callback: The CallbackQuery instance to answer
        text: Optional text to show in the answer notification
        show_alert: Whether to show an alert or a toast notification
    
    Returns:
        bool: True if the answer was successful, False if it failed
    """
    try:
        await callback.answer(text=text, show_alert=show_alert)
        return True
    except TelegramBadRequest as e:
        # Handle expired/invalid query IDs gracefully
        error_msg = str(e).lower()
        callback_id = getattr(callback, 'id', 'unknown')
        if "query is too old" in error_msg or "query id is invalid" in error_msg or "response timeout expired" in error_msg:
            logger.debug(f"Callback query expired or invalid (ID: {callback_id}): {e}")
            return False
        # Re-raise other TelegramBadRequest errors
        raise
    except Exception as e:
        # Log unexpected errors but don't crash
        # Some callbacks (like FakeCallback) may not have an 'id' attribute
        callback_id = getattr(callback, 'id', 'unknown')
        logger.warning(f"Unexpected error answering callback (ID: {callback_id}): {e}")
        return False
