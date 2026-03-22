import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import mongoose from 'mongoose';
import connectDB from '../../../../../lib/db';
import { Bot, Cart, Product, Order, ICartItem } from '../../../../../lib/models';
import { getProductPrice } from '../../../../../lib/product-utils';
import { getGbpToUsdRate } from '../../../../../lib/exchange-rates';
import { encryptAddress } from '../../../../../lib/address-encryption';

export const dynamic = 'force-dynamic';

// Bridge URL now read from bot document per-request
const BRIDGE_KEY = process.env.BRIDGE_API_KEY || '';
const COMMISSION_RATE = 0.10; // 10% service fee

const DEFAULT_SHIPPING_METHODS: Record<string, { name: string; cost: number }> = {
  STD: { name: 'Standard Delivery', cost: 0 },
  EXP: { name: 'Express Delivery', cost: 5 },
  NXT: { name: 'Next Day Delivery', cost: 10 },
};

async function getBotBySlug(slug: string) {
  await connectDB();
  return Bot.findOne({ web_shop_slug: slug, web_shop_enabled: true }).lean();
}

function getSessionId(request: NextRequest): string | null {
  return request.cookies.get('shop_session_id')?.value || null;
}

function getShippingCost(bot: any, methodCode: string): { name: string; cost: number } | null {
  if (bot.shipping_methods && Array.isArray(bot.shipping_methods)) {
    const method = bot.shipping_methods.find((m: any) => m.code === methodCode);
    if (method) return { name: method.name, cost: method.cost };
  }
  return DEFAULT_SHIPPING_METHODS[methodCode] || null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const bot = await getBotBySlug(slug);
    if (!bot) {
      return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
    }

    const botId = String(bot._id);
    const bridgeUrl = (bot as any).webhook_url || process.env.BRIDGE_API_URL || "http://localhost:8000";
    const sessionId = getSessionId(request);
    if (!sessionId) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    const telegramUserId = request.cookies.get('telegram_user_id')?.value || null;

    const body = await request.json();
    const { crypto_currency, idempotency_key, shipping_address, shipping_method_code } = body;

    if (!crypto_currency || typeof crypto_currency !== 'string') {
      return NextResponse.json({ error: 'crypto_currency required' }, { status: 400 });
    }
    if (!idempotency_key || typeof idempotency_key !== 'string') {
      return NextResponse.json({ error: 'idempotency_key required' }, { status: 400 });
    }

    // Validate shipping address
    if (!shipping_address || typeof shipping_address !== 'object') {
      return NextResponse.json({ error: 'shipping_address required' }, { status: 400 });
    }
    const { full_name, street, city, postcode, country } = shipping_address;
    if (!full_name || full_name.trim().length < 2) {
      return NextResponse.json({ error: 'Full name required (min 2 characters)' }, { status: 400 });
    }
    if (!street || street.trim().length < 5) {
      return NextResponse.json({ error: 'Street address required (min 5 characters)' }, { status: 400 });
    }
    if (!city || city.trim().length < 2) {
      return NextResponse.json({ error: 'City required (min 2 characters)' }, { status: 400 });
    }
    if (!postcode || postcode.trim().length < 3) {
      return NextResponse.json({ error: 'Postcode required (min 3 characters)' }, { status: 400 });
    }
    if (!country || country.trim().length < 2) {
      return NextResponse.json({ error: 'Country required' }, { status: 400 });
    }

    // Validate shipping method
    if (!shipping_method_code || typeof shipping_method_code !== 'string') {
      return NextResponse.json({ error: 'shipping_method_code required' }, { status: 400 });
    }
    const shippingMethod = getShippingCost(bot, shipping_method_code);
    if (!shippingMethod) {
      return NextResponse.json({ error: 'Invalid shipping method' }, { status: 400 });
    }

    await connectDB();

    // 1. Check idempotency
    const existingOrder = await Order.findOne({ idempotency_key }).lean() as Record<string, unknown> | null;
    if (existingOrder) {
      return NextResponse.json(
        {
          order_token: existingOrder.order_token,
          status: existingOrder.status,
          tracking_url: `/shop/${slug}/order/${existingOrder.order_token}`,
        },
        { status: 409 }
      );
    }

    // 2. Validate cart
    const cart = await Cart.findOne({ bot_id: botId, session_id: sessionId });
    if (!cart || cart.items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const productIds = cart.items.map((i: ICartItem) => i.product_id);
    const products = await Product.find({ _id: { $in: productIds } }).lean();
    const productMap = new Map(
      products.map((p: Record<string, unknown>) => [String(p._id), p])
    );

    // 3. Validate stock and build items snapshot
    const itemsSnapshot: Array<{
      product_id: string;
      name: string;
      price: number;
      quantity: number;
      line_total: number;
      image_url: string;
      unit: string;
    }> = [];
    let subtotal = 0;

    for (const item of cart.items as ICartItem[]) {
      const product = productMap.get(item.product_id);
      if (!product) {
        return NextResponse.json(
          { error: `Product ${item.product_id} not found` },
          { status: 400 }
        );
      }

      const p = product as Record<string, unknown>;
      const currentPrice = getProductPrice(p);
      const lineTotal = Math.round(currentPrice * item.quantity * 100) / 100;
      subtotal += lineTotal;

      const productStock = (p as any).stock as number | null | undefined;
      const variations = p.variations as Array<{ stock?: number }> | undefined;
      const hasProductStock = productStock !== undefined && productStock !== null;
      const hasVariationStock = variations?.some((v: { stock?: number }) => v.stock !== undefined && v.stock !== null) ?? false;
      if (hasProductStock && productStock < item.quantity) {
        return NextResponse.json(
          { error: `Insufficient stock for ${p.name}` },
          { status: 409 }
        );
      } else if (hasVariationStock) {
        const totalStock = (variations || []).reduce(
          (sum: number, v: { stock?: number }) => sum + (v.stock ?? 0), 0
        );
        if (totalStock < item.quantity) {
          return NextResponse.json(
            { error: `Insufficient stock for ${p.name}` },
            { status: 409 }
          );
        }
      }

      itemsSnapshot.push({
        product_id: item.product_id,
        name: p.name as string,
        price: currentPrice,
        quantity: item.quantity,
        line_total: lineTotal,
        image_url: (p.image_url as string) || '',
        unit: (p.unit as string) || 'pcs',
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;

    // 4. Calculate totals (shipping added, commission deducted from vendor payout)
    const commission = Math.ceil(subtotal * COMMISSION_RATE * 100) / 100;
    const discount = cart.discount_amount || 0;
    const shippingCost = shippingMethod.cost;
    const displayAmount = Math.round((subtotal - discount + shippingCost) * 100) / 100;

    // 5. Fetch exchange rate GBP -> USD
    const gbpUsdRate = await getGbpToUsdRate();
    const fiatAmount = Math.round(displayAmount * gbpUsdRate * 100) / 100;

    // 6. Generate order identifiers
    const orderToken = randomUUID();
    const addressSalt = randomBytes(32).toString('hex');
    const now = new Date();
    const rateLockExpiry = new Date(now.getTime() + 15 * 60 * 1000);

    const db = mongoose.connection.db;
    if (!db) throw new Error('Database not connected');

    const ordersCol = db.collection('orders');
    let orderId = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      const first = Math.floor(Math.random() * 9) + 1;
      const rest = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10)).join('');
      const candidate = `${first}${rest}`;
      const exists = await ordersCol.findOne({ _id: candidate as any });
      if (!exists) {
        orderId = candidate;
        break;
      }
    }
    if (!orderId) {
      const first = Math.floor(Math.random() * 9) + 1;
      orderId = `${first}${Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('')}`;
    }

    // 7. Encrypt shipping address
    const addressString = `${full_name.trim()}\n${street.trim()}\n${city.trim()}\n${postcode.trim()}\n${country.trim()}`;
    let encryptedAddress: string | null = null;
    try {
      encryptedAddress = encryptAddress(addressString, 'web_anonymous');
    } catch (encErr) {
      console.error('[Checkout] Address encryption failed:', encErr);
    }

    // 8. Atomic stock reservation
    const stockDecrements: Array<{ productId: string; quantity: number }> = [];
    try {
      for (const item of cart.items as ICartItem[]) {
        const product = productMap.get(item.product_id);
        const p = product as Record<string, unknown>;
        const productStock = (p as any).stock as number | null | undefined;
        const variations = p?.variations as Array<{ stock?: number }> | undefined;
        const hasVariationStock = variations?.some((v: { stock?: number }) => v.stock !== undefined && v.stock !== null) ?? false;

        if (productStock !== undefined && productStock !== null) {
          const result = await Product.findOneAndUpdate(
            { _id: item.product_id, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
            { new: true }
          );
          if (!result) {
            throw new Error(`Stock reservation failed for ${item.product_id}`);
          }
          stockDecrements.push({ productId: item.product_id, quantity: item.quantity });
        } else if (hasVariationStock) {
          const result = await Product.findOneAndUpdate(
            {
              _id: item.product_id,
              'variations.stock': { $gte: item.quantity },
            },
            { $inc: { 'variations.$.stock': -item.quantity } },
            { new: true }
          );
          if (!result) {
            throw new Error(`Stock reservation failed for ${item.product_id}`);
          }
          stockDecrements.push({ productId: item.product_id, quantity: item.quantity });
        }
      }
    } catch (stockErr) {
      for (const dec of stockDecrements) {
        await Product.updateOne(
          { _id: dec.productId },
          { $inc: { 'variations.0.stock': dec.quantity } }
        ).catch(() => {});
      }
      return NextResponse.json(
        { error: 'Some items are no longer available. Please review your cart.' },
        { status: 409 }
      );
    }

    // 9. Create order document
    const orderDoc = new Order({
      _id: orderId,
      botId: botId,
      source: 'web',
      status: 'pending',
      web_session_id: sessionId,
      ...(telegramUserId ? { userId: telegramUserId } : {}),
      order_token: orderToken,
      order_number: orderId,
      address_salt: addressSalt,
      amount: displayAmount,
      display_amount: displayAmount,
      fiat_amount: fiatAmount,
      exchange_rate_gbp_usd: gbpUsdRate,
      currency: crypto_currency.toUpperCase(),
      crypto_currency: crypto_currency.toUpperCase(),
      idempotency_key: idempotency_key,
      items_snapshot: itemsSnapshot,
      timestamp: now,
      rate_locked_at: now,
      rate_lock_expires_at: rateLockExpiry,
      commission: commission,
      commission_rate: COMMISSION_RATE,
      paymentStatus: 'pending',
      encrypted_address: encryptedAddress,
      delivery_method: shippingMethod.name,
      shipping_method_code: shipping_method_code,
      shipping_cost: shippingCost,
    });

    await orderDoc.save();

    // 10. Call Python bridge to create SHKeeper invoice
    let paymentData: {
      payment_address?: string;
      crypto_amount?: string;
      exchange_rate?: string;
      expires_at?: string;
    } = {};

    try {
      const bridgeRes = await fetch(
        `${bridgeUrl}/api/web/${botId}/create-invoice`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Bridge-Key': BRIDGE_KEY,
          },
          body: JSON.stringify({
            order_id: orderId,
            fiat_amount: fiatAmount,
            crypto_currency: crypto_currency.toUpperCase(),
            address_salt: addressSalt,
            callback_url: `${bridgeUrl}/api/web/webhook/payment`,
          }),
          signal: AbortSignal.timeout(35000),
        }
      );

      if (bridgeRes.ok) {
        paymentData = await bridgeRes.json();

        const cryptoAmount = parseFloat(paymentData.crypto_amount || '0');
        const exchangeRateUsdCrypto = cryptoAmount > 0 ? fiatAmount / cryptoAmount : 0;

        await Order.updateOne(
          { _id: orderId },
          {
            $set: {
              crypto_amount: cryptoAmount,
              exchange_rate_usd_crypto: exchangeRateUsdCrypto,
              payment_address: paymentData.payment_address,
            },
          }
        );
      } else {
        const errBody = await bridgeRes.json().catch(() => ({}));
        console.error('[Checkout] Bridge invoice creation failed:', errBody);
        await Order.updateOne(
          { _id: orderId },
          { $set: { status: 'pending_payment_setup' } }
        );
      }
    } catch (bridgeErr) {
      console.error('[Checkout] Bridge call failed:', bridgeErr);
      await Order.updateOne(
        { _id: orderId },
        { $set: { status: 'pending_payment_setup' } }
      );
    }

    // 11. Clear the session cart
    await Cart.deleteOne({ bot_id: botId, session_id: sessionId });

    // 12. Build QR data
    const cryptoAmount = paymentData.crypto_amount || '0';
    const paymentAddress = paymentData.payment_address || '';
    const qrSchemes: Record<string, string> = {
      BTC: 'bitcoin',
      LTC: 'litecoin',
      ETH: 'ethereum',
      DOGE: 'dogecoin',
      XMR: 'monero',
    };
    const scheme = qrSchemes[crypto_currency.toUpperCase()] || crypto_currency.toLowerCase();
    const qrData = paymentAddress
      ? `${scheme}:${paymentAddress}?amount=${cryptoAmount}`
      : '';

    return NextResponse.json({
      order_token: orderToken,
      order_number: orderId,
      status: paymentAddress ? 'pending' : 'pending_payment_setup',
      payment: {
        address: paymentAddress,
        amount: cryptoAmount,
        currency: crypto_currency.toUpperCase(),
        qr_data: qrData,
        expires_at: rateLockExpiry.toISOString(),
      },
      conversion: {
        display_amount: displayAmount,
        display_currency: 'GBP',
        fiat_amount: fiatAmount,
        fiat_currency: 'USD',
        rate_gbp_usd: gbpUsdRate,
        rate_usd_crypto: paymentData.exchange_rate
          ? parseFloat(paymentData.exchange_rate)
          : 0,
        locked_at: now.toISOString(),
        expires_at: rateLockExpiry.toISOString(),
      },
      shipping: {
        method: shippingMethod.name,
        cost: shippingCost,
      },
      tracking_url: `/shop/${slug}/order/${orderToken}`,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
