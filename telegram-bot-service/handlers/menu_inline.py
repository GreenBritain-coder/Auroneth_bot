"""
Handler for menu inline button actions
"""
from aiogram import Router, F
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from handlers import shop, orders, menu

router = Router()


# Handle menu-specific actions - catch all callback queries that aren't handled by other routers
# This will handle discounts, promotions, and other menu buttons
# Note: "contact" and "menu" are handled by other routers, so we skip them here
@router.callback_query(F.data & ~F.data.in_(["contact", "menu"]))
async def handle_menu_inline_button(callback: CallbackQuery, state: FSMContext):
    """Handle menu inline button clicks - update the menu message"""
    print(f"[MENU INLINE] Handler triggered! Callback data: '{callback.data}'")
    await safe_answer_callback(callback)
    
    bot_config = await get_bot_config()
    if not bot_config:
        print(f"[MENU INLINE] ERROR: Bot config not found")
        try:
            await callback.message.edit_text("❌ Bot configuration not found.")
        except:
            await callback.message.answer("❌ Bot configuration not found.")
        return
    
    action = callback.data.lower()
    print(f"[MENU INLINE] Action extracted: '{action}'")
    messages = bot_config.get("messages", {})
    
    # Get menu inline buttons to keep the same keyboard
    menu_inline_buttons = bot_config.get("menu_inline_buttons", [])
    main_buttons = bot_config.get("main_buttons", [])
    
    # Rebuild inline keyboard
    inline_keyboard_buttons = []
    has_configured_inline_buttons = False
    
    if menu_inline_buttons and isinstance(menu_inline_buttons, list) and len(menu_inline_buttons) > 0:
        has_configured_inline_buttons = True
        for row in menu_inline_buttons:
            if isinstance(row, list):
                button_row = []
                for btn in row:
                    if isinstance(btn, dict):
                        btn_text = btn.get("text", "")
                        btn_action = btn.get("action", "")
                        btn_url = btn.get("url", "")
                        
                        if btn_url:
                            button_row.append(InlineKeyboardButton(text=btn_text, url=btn_url))
                        elif btn_action:
                            button_row.append(InlineKeyboardButton(text=btn_text, callback_data=btn_action))
                        else:
                            button_row.append(InlineKeyboardButton(text=btn_text, callback_data="noop"))
                
                if button_row:
                    inline_keyboard_buttons.append(button_row)
    
    if not has_configured_inline_buttons and main_buttons and len(main_buttons) > 0:
        import re
        for i in range(0, len(main_buttons), 2):
            button_row = []
            # Strip emojis and special chars for callback_data - keep only alphanumeric and spaces
            button_text_clean = re.sub(r'[^\w\s]', '', main_buttons[i])
            callback_data_1 = re.sub(r'\s+', '_', button_text_clean.lower().strip())
            button_row.append(InlineKeyboardButton(
                text=main_buttons[i], 
                callback_data=callback_data_1
            ))
            if i + 1 < len(main_buttons):
                button_text_clean_2 = re.sub(r'[^\w\s]', '', main_buttons[i + 1])
                callback_data_2 = re.sub(r'\s+', '_', button_text_clean_2.lower().strip())
                button_row.append(InlineKeyboardButton(
                    text=main_buttons[i + 1], 
                    callback_data=callback_data_2
                ))
            inline_keyboard_buttons.append(button_row)
    
    # Handle different actions
    response_text = "Choose an option from main menu:"
    
    # First, try to find custom message for this action using the same key format as admin panel
    import re
    # Strip emojis and special characters from action (keep only alphanumeric and spaces)
    action_clean = re.sub(r'[^\w\s]', '', action)
    action_key = re.sub(r'\s+', '_', action_clean.lower().strip())
    custom_message = messages.get(action_key, "")
    
    # Debug logging (strip emojis for Windows console compatibility)
    action_safe = re.sub(r'[^\w\s]', '', action)
    print(f"[MENU INLINE] Action: '{action_safe}', Key: '{action_key}'")
    message_keys_safe = [re.sub(r'[^\w\s]', '', str(k)) for k in messages.keys()]
    print(f"[MENU INLINE] Available message keys: {message_keys_safe}")
    print(f"[MENU INLINE] Custom message found: {bool(custom_message)}")
    
    if action == "shop":
        # Show custom message if configured, then shop
        print(f"[MENU INLINE SHOP] Custom message retrieved: {bool(custom_message)}")
        if custom_message and custom_message.strip():
            print(f"[MENU INLINE SHOP] Message content: '{custom_message}'")
            print(f"[MENU INLINE SHOP] Message length: {len(custom_message)}")
            try:
                print(f"[MENU INLINE SHOP] Attempting to send message...")
                # Try sending with Markdown first, fallback to plain text if it fails
                try:
                    await callback.message.answer(custom_message, parse_mode="Markdown")
                    print(f"[MENU INLINE SHOP] Message sent successfully with Markdown")
                except Exception as md_error:
                    print(f"[MENU INLINE SHOP] Markdown failed ({md_error}), trying plain text...")
                    await callback.message.answer(custom_message)
                    print(f"[MENU INLINE SHOP] Message sent successfully as plain text")
            except Exception as e:
                print(f"[MENU INLINE SHOP] ERROR sending message: {e}")
                import traceback
                traceback.print_exc()
        else:
            print(f"[MENU INLINE SHOP] No custom message found or message is empty")
        # Edit the menu message to show shop categories directly
        print(f"[MENU INLINE SHOP] Calling handle_shop_start...")
        await shop.handle_shop_start(callback)
        return
    elif action == "orders" or "history" in action or "pending" in action:
        # Show custom message if configured, then orders
        if custom_message:
            await callback.message.answer(custom_message, parse_mode="Markdown")
        # Show orders - pass the callback directly
        print(f"[Menu Inline Debug] Orders button clicked - callback.from_user.id: {callback.from_user.id}")
        try:
            from handlers.orders import show_user_orders
            await show_user_orders(callback)
        except Exception as e:
            print(f"[Menu Inline Debug] Error showing orders: {e}")
            import traceback
            traceback.print_exc()
            try:
                await callback.message.answer(f"Error loading orders: {str(e)}")
            except:
                await safe_answer_callback(callback, f"Error: {str(e)}", show_alert=True)
        return
    elif "help" in action:
        response_text = custom_message.strip() if custom_message and custom_message.strip() else messages.get("help", "Help information will be displayed here.")
    elif "user_guide" in action:
        response_text = custom_message.strip() if custom_message and custom_message.strip() else messages.get("user_guide", "User guide information will be displayed here.")
    elif "collections" in action:
        response_text = custom_message.strip() if custom_message and custom_message.strip() else messages.get("collections", "Collections information will be displayed here.")
    elif "feedback" in action:
        response_text = custom_message.strip() if custom_message and custom_message.strip() else messages.get("feedback", "Feedback information will be displayed here.")
    elif "refer" in action or "rewards" in action:
        response_text = custom_message.strip() if custom_message and custom_message.strip() else messages.get("refer", "Refer & Rewards information will be displayed here.")
    elif "offers" in action:
        response_text = custom_message.strip() if custom_message and custom_message.strip() else messages.get("offers", "Offers information will be displayed here.")
    elif "support" in action or "chat" in action:
        # Open full contact interface (same as Contact button) - allows sending messages to vendor
        from handlers.contact import handle_contact_start
        user_id = str(callback.from_user.id) if callback.from_user else None
        await handle_contact_start(callback.message, state, user_id=user_id)
        return
    elif "questions" in action or "terms" in action:
        response_text = custom_message.strip() if custom_message and custom_message.strip() else messages.get("questions", "Questions and Answers (T&C) information will be displayed here.")
    elif action == "discounts" or action == "promo" or action == "promotions":
        # Build promotions/discounts message
        from database.connection import get_database
        from datetime import datetime
        
        promo_message = custom_message.strip() if custom_message and custom_message.strip() else messages.get("promotions", "")
        
        # If no custom message, build message with available discount codes
        if not promo_message or not promo_message.strip():
            promo_message = "🎟️ *Discounts & Promotions*\n\n"
            
            # Fetch active discount codes for this bot
            db = get_database()
            discounts_collection = db.discounts
            bot_id = str(bot_config["_id"])
            now = datetime.utcnow()
            
            try:
                active_discounts = await discounts_collection.find({
                    "bot_ids": bot_id,
                    "active": True,
                    "valid_from": {"$lte": now},
                    "valid_until": {"$gte": now}
                }).to_list(length=20)
                
                # Filter by usage limit
                valid_discounts = []
                for discount in active_discounts:
                    usage_limit = discount.get("usage_limit")
                    used_count = discount.get("used_count", 0)
                    if usage_limit is None or used_count < usage_limit:
                        valid_discounts.append(discount)
                
                if valid_discounts:
                    promo_message += "*Available Discount Codes:*\n\n"
                    for discount in valid_discounts:
                        code = discount.get("code", "")
                        description = discount.get("description", "")
                        discount_type = discount.get("discount_type", "percentage")
                        discount_value = discount.get("discount_value", 0)
                        min_order = discount.get("min_order_amount")
                        
                        if discount_type == "percentage":
                            discount_text = f"{discount_value}% off"
                        else:
                            discount_text = f"£{discount_value:.2f} off"
                        
                        promo_message += f"• *{code}* - {discount_text}"
                        if description:
                            promo_message += f"\n  {description}"
                        if min_order and min_order > 0:
                            promo_message += f"\n  Minimum order: £{min_order:.2f}"
                        promo_message += "\n\n"
                    
                    promo_message += "💡 Use these codes during checkout to save money!"
                else:
                    promo_message += "Check out our current discounts and promotions! Use discount codes during checkout to save money."
            except Exception as e:
                print(f"[Discounts] Error fetching discount codes: {e}")
                promo_message += "Check out our current discounts and promotions! Use discount codes during checkout to save money."
        
        # Ensure we always have a valid message (Telegram requires non-empty text)
        if not promo_message or not promo_message.strip():
            promo_message = "🎟️ *Discounts & Promotions*\n\nCheck out our current discounts and promotions! Use discount codes during checkout to save money."
        
        # Send the message directly (don't update menu)
        try:
            await callback.message.answer(promo_message, parse_mode="Markdown")
        except Exception as e:
            # If Markdown parsing fails, try without parse_mode
            try:
                await callback.message.answer(promo_message)
            except Exception as e2:
                # Last resort: send a simple text message
                await callback.message.answer("🎟️ Discounts & Promotions\n\nCheck out our current discounts and promotions!")
        
        await safe_answer_callback(callback)  # Acknowledge the button press
        return
    elif "bag" in action:
        # Redirect to cart
        await shop.handle_view_cart(callback)
        return
    elif action == "noop":
        # No operation - just update menu
        response_text = "Choose an option from main menu:"
    else:
        # Generic action - use custom message if found, otherwise default
        response_text = custom_message.strip() if custom_message and custom_message.strip() else f"Selected: {action}"
    
    # Update the menu message with new content
    if inline_keyboard_buttons:
        inline_keyboard = InlineKeyboardMarkup(inline_keyboard=inline_keyboard_buttons)
        try:
            await callback.message.edit_text(response_text, parse_mode="Markdown", reply_markup=inline_keyboard)
        except Exception as e:
            # If Markdown parsing fails, try without parse_mode
            try:
                await callback.message.edit_text(response_text, reply_markup=inline_keyboard)
            except:
                await callback.message.answer(response_text, reply_markup=inline_keyboard)
    else:
        try:
            await callback.message.edit_text(response_text, parse_mode="Markdown")
        except Exception as e:
            # If Markdown parsing fails, try without parse_mode
            try:
                await callback.message.edit_text(response_text)
            except:
                await callback.message.answer(response_text)

