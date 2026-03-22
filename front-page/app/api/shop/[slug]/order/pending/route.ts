import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../../lib/db';
import { Bot, Order } from '../../../../../../lib/models';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sessionId = request.cookies.get('shop_session_id')?.value;
  if (!sessionId) {
    return NextResponse.json({ order: null });
  }

  await connectDB();

  const bot = await Bot.findOne({
    web_shop_slug: slug,
    web_shop_enabled: true,
  }).lean();

  if (!bot) {
    return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  }

  // Find most recent pending order for this session
  const order = await Order.findOne({
    botId: String(bot._id),
    web_session_id: sessionId,
    paymentStatus: 'pending',
  })
    .sort({ created_at: -1 })
    .lean() as Record<string, unknown> | null;

  if (!order) {
    return NextResponse.json({ order: null });
  }

  // Check if rate lock has expired (15 min)
  const expiresAt = order.rate_lock_expires_at as Date | undefined;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return NextResponse.json({ order: null });
  }

  // Build QR data from payment address
  const paymentAddress = (order.payment_address as string) || (order.paymentDetails as any)?.address || '';
  const cryptoAmount = order.crypto_amount || '';
  const cryptoCurrency = (order.crypto_currency as string) || '';
  const qrSchemes: Record<string, string> = {
    BTC: 'bitcoin', LTC: 'litecoin', ETH: 'ethereum', DOGE: 'dogecoin', XMR: 'monero',
  };
  const scheme = qrSchemes[cryptoCurrency] || cryptoCurrency.toLowerCase();
  const qrData = paymentAddress ? `${scheme}:${paymentAddress}?amount=${cryptoAmount}` : '';

  return NextResponse.json({
    order: {
      order_token: order.order_token,
      order_number: order.order_number || order._id,
      status: order.paymentStatus || order.status,
      payment: {
        address: paymentAddress,
        amount: cryptoAmount,
        currency: cryptoCurrency,
        qr_data: qrData,
        expires_at: order.rate_lock_expires_at || '',
      },
      conversion: {
        display_amount: order.display_amount,
        display_currency: 'GBP',
        fiat_amount: order.fiat_amount,
        fiat_currency: 'USD',
        rate_gbp_usd: order.exchange_rate_gbp_usd,
        rate_usd_crypto: order.exchange_rate_usd_crypto,
        locked_at: order.rate_locked_at,
        expires_at: order.rate_lock_expires_at,
      },
      tracking_url: `/shop/${slug}/order/${order.order_token}`,
      items_snapshot: order.items_snapshot,
    },
  });
}
