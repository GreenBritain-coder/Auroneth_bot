from aiogram import Router, F
from aiogram.types import CallbackQuery
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from database.connection import get_database
from services.commission import calculate_commission
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from datetime import datetime
import uuid

router = Router()


@router.callback_query(F.data.startswith("buy:"))
async def handle_buy(callback: CallbackQuery):
    """Handle buy button click"""
    await safe_answer_callback(callback)
    
    product_id = callback.data.split(":")[1]
    db = get_database()
    products_collection = db.products
    orders_collection = db.orders
    
    # Get current bot config - always fetches fresh from MongoDB
    bot_config = await get_bot_config()
    
    if not bot_config:
        await callback.message.answer("❌ Bot configuration error.")
        return
    
    # Get product - handle both ObjectId and string IDs
    from bson import ObjectId
    product = None
    
    # First try as ObjectId (if it's a valid ObjectId string)
    try:
        if len(product_id) == 24:  # ObjectId hex string length
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except Exception as e:
        pass
    
    # If not found, try as string
    if not product:
        product = await products_collection.find_one({"_id": product_id})
    
    # If still not found, try searching by string representation
    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get('_id')) == product_id:
                product = p
                break
    
    if not product:
        await callback.message.answer("❌ Product not found.")
        return
    
    # Calculate commission
    commission = calculate_commission(product["price"])
    
    # Create order
    order_id = str(uuid.uuid4())
    order = {
        "_id": order_id,
        "botId": bot_config["_id"],
        "productId": product_id,
        "userId": str(callback.from_user.id),
        "paymentStatus": "pending",
        "amount": product["price"],
        "commission": commission,
        "timestamp": datetime.utcnow()
    }
    
    await orders_collection.insert_one(order)
    
    # Create payment invoice using available payment provider
    # Priority: SHKeeper > Blockonomics > CoinPayments
    from services.payment_provider import create_payment_invoice
    
    # Get bot config for webhook URL
    bot_config = await get_bot_config()
    
    invoice_result = create_payment_invoice(
        amount=product["price"],
        currency=product["currency"],
        order_id=order_id,
        buyer_email="",  # Telegram doesn't provide email by default
        bot_config=bot_config  # Pass bot config for webhook URL
    )
    
    if invoice_result["success"]:
        # Update order with invoice ID
        await orders_collection.update_one(
            {"_id": order_id},
            {"$set": {"invoiceId": invoice_result["txn_id"]}}
        )
        # Record deposit address for HD-style tracking (one address per order)
        from database.addresses import record_deposit_address
        record_deposit_address(
            get_database(),
            order_id,
            product["currency"],
            invoice_result["address"],
            invoice_result.get("provider"),
        )

        # Get currency display name from invoice result (for SHKeeper)
        display_currency = invoice_result.get('display_name') or invoice_result.get('currency', product['currency'])
        crypto_currency = invoice_result.get('currency', product['currency'])
        crypto_amount = invoice_result.get('amount', product['price'])
        
        # Send invoice to user
        invoice_message = f"💳 *Payment Invoice*\n\n"
        invoice_message += f"Product: {product['name']}\n"
        
        # Show amount based on provider
        if invoice_result.get('provider') == 'shkeeper':
            # SHKeeper: Show both USD and crypto amount
            invoice_message += f"Amount: ${product['price']} USD\n"
            invoice_message += f"Pay: {crypto_amount} {display_currency}\n\n"
        else:
            # Other providers: Show crypto amount
            invoice_message += f"Amount: {crypto_amount} {display_currency}\n\n"
        
        invoice_message += f"Send {crypto_amount} {display_currency} to:\n"
        invoice_message += f"`{invoice_result['address']}`"
        
        await callback.message.answer(invoice_message, parse_mode="Markdown")
        
        # Send QR code as separate image (cleaner)
        if invoice_result.get('qrcode_url'):
            try:
                await callback.message.answer_photo(
                    photo=invoice_result['qrcode_url'],
                    caption=f"Scan to pay: {crypto_amount} {display_currency}"
                )
            except:
                pass  # Silently fail if QR code can't be sent
    else:
        await callback.message.answer(f"❌ Payment error: {invoice_result.get('error', 'Unknown error')}")


@router.callback_query(F.data.startswith("info:"))
async def handle_info(callback: CallbackQuery):
    """Handle more info button click"""
    await safe_answer_callback(callback)
    
    product_id = callback.data.split(":")[1]
    db = get_database()
    products_collection = db.products
    
    # Get current bot config - always fetches fresh from MongoDB
    bot_config = await get_bot_config()
    
    if not bot_config:
        await callback.message.answer("❌ Bot configuration error.")
        return
    
    # Get product - handle both ObjectId and string IDs
    from bson import ObjectId
    product = None
    
    try:
        if len(product_id) == 24:
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except Exception:
        pass
    
    if not product:
        product = await products_collection.find_one({"_id": product_id})
    
    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get('_id')) == product_id:
                product = p
                break
    
    if not product:
        await callback.message.answer("❌ Product not found.")
        return
    
    # Check if custom message template exists for "info" action
    inline_action_messages = bot_config.get("inline_action_messages", {})
    custom_template = inline_action_messages.get("info")
    
    if custom_template:
        # Use custom template with variable substitution
        info_text = custom_template
        info_text = info_text.replace("{{product_name}}", product.get('name', 'N/A'))
        info_text = info_text.replace("{{product_description}}", product.get('description', 'No description available.'))
        info_text = info_text.replace("{{product_price}}", str(product.get('price', product.get('base_price', 0))))
        info_text = info_text.replace("{{product_currency}}", product.get('currency', ''))
        info_text = info_text.replace("{{product_id}}", str(product.get('_id', '')))
    else:
        # Default template
        info_text = f"📋 *{product['name']}*\n\n"
        info_text += f"{product.get('description', 'No description available.')}\n\n"
        price = product.get('price') or product.get('base_price', 0)
        info_text += f"💰 Price: {price} {product.get('currency', '')}"
    
    # Try to edit message first (for inline buttons), fallback to new message if it fails
    try:
        await callback.message.edit_text(info_text, parse_mode="Markdown")
    except:
        # If editing fails (e.g., message has photo or can't be edited), send new message
        image_url = product.get("image_url")
        if image_url:
            from utils.shop_helpers import prepare_image_for_telegram
            image_file = await prepare_image_for_telegram(image_url)
            
            try:
                if image_file:
                    await callback.message.answer_photo(
                        photo=image_file,
                        caption=info_text,
                        parse_mode="Markdown"
                    )
                else:
                    await callback.message.answer_photo(
                        photo=image_url,
                        caption=info_text,
                        parse_mode="Markdown"
                    )
            except Exception as e:
                print(f"Error sending product image: {e}")
                await callback.message.answer(info_text, parse_mode="Markdown")
        else:
            await callback.message.answer(info_text, parse_mode="Markdown")

