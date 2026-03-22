import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import connectDB from '../../../../../lib/db';
import { Bot, Cart, Product, Order, ICartItem } from '../../../../../lib/models';
import { getProductPrice } from '../../../../../lib/product-utils';
import { getGbpToUsdRate } from '../../../../../lib/exchange-rates';

export const dynamic = 'force-dynamic';

// Bridge URL now read from bot document per-request
const BRIDGE_KEY = process.env.BRIDGE_API_KEY || '';
const COMMISSION_RATE = 0.10; // 10% service fee

async function getBotBySlug(slug: string) {
  await connectDB();
  return Bot.findOne({ web_shop_slug: slug, web_shop_enabled: true }).lean();
}

function getSessionId(request: NextRequest): string | null {
  return request.cookies.get('shop_session_id')?.value || null;
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
    const bridgeUrl = (bot as any).bridge_url || (bot as any).webhook_url || process.env.BRIDGE_API_URL || "http://localhost:8000";
    const sessionId = getSessionId(request);
    if (!sessionId) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    const body = await request.json();
    const { crypto_currency, idempotency_key } = body;

    if (!crypto_currency || typeof crypto_currency !== 'string') {
      return NextResponse.json({ error: 'crypto_currency required' }, { status: 400 });
    }
    if (!idempotency_key || typeof idempotency_key !== 'string') {
      return NextResponse.json({ error: 'idempotency_key required' }, { status: 400 });
    }

    await connectDB();

    // 1. Check idempotency - return existing order if already created
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

      // Check stock: null/undefined = unlimited (matches Telegram bot behavior)
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
      // No stock field = unlimited = allow

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

    // 4. Calculate totals server-side
    const serviceFee = Math.ceil(subtotal * COMMISSION_RATE * 100) / 100;
    const discount = cart.discount_amount || 0;
    const displayAmount = Math.round((subtotal + serviceFee - discount) * 100) / 100;

    // 5. Fetch exchange rate GBP -> USD
    const gbpUsdRate = await getGbpToUsdRate();
    const fiatAmount = Math.round(displayAmount * gbpUsdRate * 100) / 100;

    // 6. Generate order identifiers
    const orderToken = randomUUID();
    const addressSalt = randomBytes(32).toString('hex');
    const orderId = randomUUID();
    const now = new Date();
    const rateLockExpiry = new Date(now.getTime() + 15 * 60 * 1000);

    // 7. Atomic stock reservation - decrement stock for each item
    const stockDecrements: Array<{ productId: string; quantity: number }> = [];
    try {
      for (const item of cart.items as ICartItem[]) {
        const product = productMap.get(item.product_id);
        const variations = (product as Record<string, unknown>)?.variations as Array<{ stock?: number }> | undefined;

        if (variations && variations.length > 0) {
          // Decrement stock in first variation with sufficient stock
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
      // Rollback all stock decrements
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

    // 8. Create order document
    const orderDoc = new Order({
      _id: orderId,
      botId: botId,
      source: 'web',
      status: 'pending',
      web_session_id: sessionId,
      order_token: orderToken,
      address_salt: addressSalt,
      display_amount: displayAmount,
      fiat_amount: fiatAmount,
      exchange_rate_gbp_usd: gbpUsdRate,
      crypto_currency: crypto_currency.toUpperCase(),
      idempotency_key: idempotency_key,
      items_snapshot: itemsSnapshot,
      rate_locked_at: now,
      rate_lock_expires_at: rateLockExpiry,
      commission: serviceFee,
      commission_rate: COMMISSION_RATE,
      paymentStatus: 'pending',
    });

    await orderDoc.save();

    // 9. Call Python bridge to create SHKeeper invoice
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

        // Update order with payment details from SHKeeper
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
        // Order stays in pending - background retry can pick it up
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

    // 10. Clear the session cart
    await Cart.deleteOne({ bot_id: botId, session_id: sessionId });

    // 11. Build QR data
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
      tracking_url: `/shop/${slug}/order/${orderToken}`,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
