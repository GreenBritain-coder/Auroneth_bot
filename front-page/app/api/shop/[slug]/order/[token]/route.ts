import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../../lib/db';
import { Bot, Order } from '../../../../../../lib/models';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; token: string }> }
) {
  const { slug, token } = await params;

  await connectDB();

  const bot = await Bot.findOne({
    web_shop_slug: slug,
    web_shop_enabled: true,
  }).lean();

  if (!bot) {
    return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
  }

  const order = await Order.findOne({
    order_token: token,
    botId: String(bot._id),
  }).lean() as Record<string, unknown> | null;

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const paymentDetails = (order.paymentDetails || {}) as Record<string, unknown>;

  const status = (order.paymentStatus || order.status || 'pending') as string;

  return NextResponse.json({
    order: {
      order_token: order.order_token,
      order_number: order.order_number || null,
      status,
      items_snapshot: order.items_snapshot,
      display_amount: order.display_amount,
      fiat_amount: order.fiat_amount,
      crypto_currency: order.crypto_currency,
      crypto_amount: order.crypto_amount,
      exchange_rate_gbp_usd: order.exchange_rate_gbp_usd,
      exchange_rate_usd_crypto: order.exchange_rate_usd_crypto,
      commission: order.commission,
      commission_rate: order.commission_rate,
      rate_locked_at: order.rate_locked_at,
      rate_lock_expires_at: order.rate_lock_expires_at,
      payment_received: status !== 'pending',
      confirmations: (paymentDetails.confirmations as number) ?? 0,
      payment_address: (paymentDetails.address as string) ?? null,
      qr_data: (paymentDetails.qr_data as string) ?? null,
      shipping: (order as Record<string, unknown>).shipping ?? null,
      created_at: order.created_at,
      updated_at: order.updated_at,
    },
  });
}
