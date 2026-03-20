from aiogram import Router, F
from aiogram.types import Message, ReplyKeyboardMarkup, KeyboardButton
from aiogram.filters import Command
from database.connection import get_database
from utils.bot_config import get_bot_config

router = Router()


# Handle commands that are created from main_buttons
@router.message(Command("shop"))
async def handle_shop_command(message: Message):
    """Handle /shop command"""
    from handlers.catalog import handle_shop_start
    from aiogram.types import CallbackQuery
    
    # Create a fake callback to reuse shop handler
    class FakeCallback:
        def __init__(self, msg):
            self.message = msg
            self.from_user = msg.from_user
            self.data = "shop"
            self.id = None  # Fake callbacks don't have an ID
        
        async def answer(self, text: str = None, show_alert: bool = False):
            # Fake callback - do nothing, just return successfully
            pass
    
    fake_callback = FakeCallback(message)
    await handle_shop_start(fake_callback)


@router.message(Command("orders"))
async def handle_orders_command_menu(message: Message):
    """Handle /orders command from menu"""
    from handlers.orders import show_user_orders
    await show_user_orders(message)


@router.message(Command("wishlist"))
async def handle_wishlist_command(message: Message):
    """Handle /wishlist command"""
    from handlers.shop import handle_view_wishlist
    from aiogram.types import CallbackQuery
    
    # Create a fake callback to reuse wishlist handler
    class FakeCallback:
        def __init__(self, msg):
            self.message = msg
            self.from_user = msg.from_user
            self.data = "view_wishlist"
            self.id = None  # Fake callbacks don't have an ID
        
        async def answer(self, text: str = None, show_alert: bool = False):
            # Fake callback - do nothing, just return successfully
            pass
    
    fake_callback = FakeCallback(message)
    await handle_view_wishlist(fake_callback)


@router.message(Command("reviews"))
async def handle_reviews_command(message: Message):
    """Handle /reviews command - show all customer reviews"""
    from handlers.shop import _render_all_reviews
    await _render_all_reviews(message, None, 1)


@router.message(Command("contact"))
async def handle_contact_command(message: Message):
    """Handle /contact command"""
    bot_config = await get_bot_config()
    if bot_config:
        messages = bot_config.get("messages", {})
        # Check for custom message using "contact" key
        import re
        contact_key = re.sub(r'\s+', '_', "contact".lower())
        custom_message = messages.get(contact_key, "")
        support_message = custom_message or messages.get("support", "Contact support for assistance.")
        # Only send if message is not empty
        if support_message and support_message.strip():
            await message.answer(support_message, parse_mode="Markdown")
        else:
            await message.answer("Contact support for assistance.")
    else:
        await message.answer("Contact support for assistance.")


@router.message(Command("discounts"))
async def handle_discounts_command(message: Message):
    """Handle /discounts command"""
    bot_config = await get_bot_config()
    if bot_config:
        messages = bot_config.get("messages", {})
        # Check for custom message using "discounts" key
        import re
        discounts_key = re.sub(r'\s+', '_', "discounts".lower())
        custom_message = messages.get(discounts_key, "")
        promo_message = custom_message or messages.get("promotions", "Check out our promotions!")
        # Only send if message is not empty
        if promo_message and promo_message.strip():
            await message.answer(promo_message, parse_mode="Markdown")
        else:
            await message.answer("Check out our promotions!")
    else:
        await message.answer("Check out our promotions!")


@router.message(Command("promo"))
async def handle_promo_command(message: Message):
    """Handle /promo command"""
    bot_config = await get_bot_config()
    if bot_config:
        messages = bot_config.get("messages", {})
        promo_message = messages.get("promotions", "Check out our promotions!")
        # Only send if message is not empty
        if promo_message and promo_message.strip():
            await message.answer(promo_message, parse_mode="Markdown")
        else:
            await message.answer("Check out our promotions!")
    else:
        await message.answer("Check out our promotions!")


@router.message(Command("promotions"))
async def handle_promotions_command(message: Message):
    """Handle /promotions command"""
    bot_config = await get_bot_config()
    if bot_config:
        messages = bot_config.get("messages", {})
        promo_message = messages.get("promotions", "Check out our promotions!")
        # Only send if message is not empty
        if promo_message and promo_message.strip():
            await message.answer(promo_message, parse_mode="Markdown")
        else:
            await message.answer("Check out our promotions!")
    else:
        await message.answer("Check out our promotions!")


@router.message(F.text & ~F.text.startswith("/"))
async def handle_menu_buttons(message: Message):
    """Handle main menu button clicks (but not commands)"""
    # Get current bot config - always fetches fresh from MongoDB
    bot_config = await get_bot_config()
    
    if not bot_config:
        return
    
    button_text = message.text
    main_buttons = bot_config.get("main_buttons", [])
    
    # Debug: Log all button clicks to see what's being received
    import re
    button_text_safe = re.sub(r'[^\w\s]', '', button_text)
    print(f"[MENU HANDLER] Received text: '{button_text_safe}'")
    print(f"[MENU HANDLER] Main buttons in config: {[re.sub(r'[^\w\s]', '', str(b)) for b in main_buttons]}")
    print(f"[MENU HANDLER] Button in main_buttons: {button_text in main_buttons}")
    
    # Check if button is in main menu
    if button_text in main_buttons:
        # Get custom message for this button (if configured)
        # Strip emojis and special characters first, then replace spaces with underscores
        # This matches the admin panel format: strip non-word chars, lowercase, then replace spaces
        import re
        button_clean = re.sub(r'[^\w\s]', '', button_text)  # Strip emojis and special chars
        button_key = re.sub(r'\s+', '_', button_clean.lower().strip())  # Lowercase, strip, replace spaces
        messages = bot_config.get("messages", {})
        custom_message = messages.get(button_key, "")
        
        # Debug logging (strip emojis for Windows console compatibility)
        import re
        button_text_safe = re.sub(r'[^\w\s]', '', button_text)
        print(f"[MENU] Button clicked: '{button_text_safe}'")
        print(f"[MENU] Looking for key: '{button_key}'")
        message_keys_safe = [re.sub(r'[^\w\s]', '', str(k)) for k in messages.keys()]
        print(f"[MENU] Available message keys: {message_keys_safe}")
        print(f"[MENU] Custom message found: {bool(custom_message)}")
        
        # Handle special buttons
        # Check button text by stripping emojis for comparison
        button_text_normalized = re.sub(r'[^\w\s]', '', button_text.lower().strip())
        if button_text_normalized == "shop":
            # Show custom message if configured, then shop content
            if custom_message:
                print(f"[MENU] Sending custom shop message: {custom_message[:50]}...")
                await message.answer(custom_message, parse_mode="Markdown")
            else:
                print(f"[MENU] No custom message found for shop button")
            # Directly show shop categories using the shop handler
            from handlers.catalog import handle_shop_start
            from aiogram.types import CallbackQuery
            
            # Create a fake callback to reuse shop handler
            class FakeCallback:
                def __init__(self, msg):
                    self.message = msg
                    self.from_user = msg.from_user
                    self.data = "shop"
                    self.id = None  # Fake callbacks don't have an ID
                
                async def answer(self, text: str = None, show_alert: bool = False):
                    # Fake callback - do nothing, just return successfully
                    pass
            
            fake_callback = FakeCallback(message)
            await handle_shop_start(fake_callback)
        elif button_text_normalized == "orders":
            # Show custom message if configured, then orders
            if custom_message:
                await message.answer(custom_message, parse_mode="Markdown")
            # Handle orders button
            from handlers.orders import show_user_orders
            await show_user_orders(message)
        elif button_text_normalized in ["support", "contact"]:
            # Handle contact button - route to contact handler
            # Import here to avoid circular imports
            from handlers.contact import handle_contact_start
            from aiogram.fsm.context import FSMContext
            from aiogram.fsm.storage.memory import MemoryStorage
            
            # Get state from dispatcher if available, otherwise create a temporary one
            # For text message handlers, we need to get state from the message context
            # Since we don't have direct access, we'll create a simple state proxy
            # The contact handler will work, but message state persistence may be limited
            class SimpleState:
                def __init__(self):
                    self._data = {}
                async def set_state(self, state):
                    # State will be managed by the contact handler's router
                    pass
                async def update_data(self, **kwargs):
                    self._data.update(kwargs)
                async def get_data(self):
                    return self._data
                async def clear(self):
                    self._data = {}
            
            simple_state = SimpleState()
            await handle_contact_start(message, simple_state)
        elif button_text.lower() in ["promo", "promotions", "discounts"]:
            # Use custom message if available, otherwise fall back to promotions message
            promo_message = custom_message or messages.get("promotions", "Check out our promotions!")
            # Only send if message is not empty
            if promo_message and promo_message.strip():
                await message.answer(promo_message, parse_mode="Markdown")
            else:
                await message.answer("Check out our promotions!")
        else:
            # Generic message handling - use custom message if configured
            if custom_message and custom_message.strip():
                await message.answer(custom_message, parse_mode="Markdown")
            else:
                await message.answer(f"Selected: {button_text}")


async def handle_shop(message: Message, bot_config: dict):
    """Handle shop button - show products"""
    db = get_database()
    products_collection = db.products
    bot_id = str(bot_config["_id"])  # Ensure it's a string
    
    # Get all products and filter by bot_id
    all_products = await products_collection.find({}).to_list(length=100)
    
    # Filter products that have this bot_id in bot_ids array
    products = []
    for p in all_products:
        p_bot_ids = [str(bid) for bid in p.get('bot_ids', [])]  # Convert all to strings
        if bot_id in p_bot_ids:
            products.append(p)
    
    if not products:
        await message.answer("No products available at the moment.")
        return
    
    # Display products
    for product in products:
        product_text = f"🛍️ *{product['name']}*\n\n"
        product_text += f"{product.get('description', '')}\n\n"
        product_text += f"💰 Price: {product['price']} {product['currency']}"
        
        # Get inline buttons for this product - convert ID to string for consistency
        product_id_str = str(product["_id"])
        inline_buttons = bot_config.get("inline_buttons", {}).get(product_id_str, [])
        # Also try with ObjectId format if it's stored that way in inline_buttons
        if not inline_buttons:
            inline_buttons = bot_config.get("inline_buttons", {}).get(product["_id"], [])
        
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        
        if inline_buttons:
            keyboard_buttons = []
            for btn in inline_buttons:
                btn_text = btn.get("text", "Button")
                btn_action = btn.get("action", "info")
                callback_data = f"{btn_action}:{product_id_str}"
                keyboard_buttons.append([InlineKeyboardButton(text=btn_text, callback_data=callback_data)])
            keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
        else:
            keyboard = None
        
        # Send product with image if available, otherwise send as text
        from utils.shop_helpers import prepare_image_for_telegram
        
        image_url = product.get("image_url")
        image_file = await prepare_image_for_telegram(image_url) if image_url else None
        
        if image_file:
            try:
                await message.answer_photo(
                    photo=image_file,
                    caption=product_text,
                    parse_mode="Markdown",
                    reply_markup=keyboard
                )
            except Exception as e:
                # If image fails to send, fall back to text message
                print(f"Error sending product image (base64): {e}")
                if keyboard:
                    await message.answer(product_text, parse_mode="Markdown", reply_markup=keyboard)
                else:
                    await message.answer(product_text, parse_mode="Markdown")
        elif image_url and image_url.strip():
            try:
                await message.answer_photo(
                    photo=image_url,
                    caption=product_text,
                    parse_mode="Markdown",
                    reply_markup=keyboard
                )
            except Exception as e:
                # If image fails to send, fall back to text message
                print(f"Error sending product image (URL): {e}")
                if keyboard:
                    await message.answer(product_text, parse_mode="Markdown", reply_markup=keyboard)
                else:
                    await message.answer(product_text, parse_mode="Markdown")
        else:
            # No image, send as text message
            if keyboard:
                await message.answer(product_text, parse_mode="Markdown", reply_markup=keyboard)
            else:
                await message.answer(product_text, parse_mode="Markdown")

