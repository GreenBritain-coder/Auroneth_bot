import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../lib/db';
import { Order, Bot } from '../../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../../lib/auth';
import mongoose from 'mongoose';

/**
 * Valid state transitions for the order state machine.
 * Key = current status, Value = array of allowed next statuses.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:   ['paid', 'expired', 'cancelled'],
  paid:      ['confirmed', 'cancelled', 'refunded'],
  confirmed: ['shipped', 'cancelled', 'refunded'],
  shipped:   ['delivered', 'refunded'],
  delivered: ['completed', 'disputed'],
  disputed:  ['refunded', 'completed'],
  cancelled: ['refunded'],
  // Terminal states: expired, completed, refunded — no outgoing transitions
};

const INVOICE_STATUS_MAP: Record<string, string> = {
  pending: 'Pending Payment',
  paid: 'Paid',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  disputed: 'Disputed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const BUYER_MESSAGES: Record<string, string> = {
  paid: 'Your payment for Order #{order_id} has been confirmed! The vendor will review your order shortly.',
  confirmed: 'Great news! Order #{order_id} has been confirmed by the vendor and is being prepared.',
  shipped: 'Order #{order_id} has been shipped!',
  delivered: 'Order #{order_id} has been marked as delivered. Please confirm receipt or open a dispute if there\'s an issue.',
  completed: 'Order #{order_id} is now complete. Thank you for your purchase!',
  disputed: 'Dispute opened for Order #{order_id}. The vendor has been notified.',
  expired: 'Order #{order_id} has expired. The payment deadline passed.',
  cancelled: 'Order #{order_id} has been cancelled.{reason}',
  refunded: 'A refund for Order #{order_id} has been issued.{txid}',
};

/**
 * POST /api/orders/{id}/status
 *
 * Body: {
 *   status: string,              // Required: target status
 *   note?: string,               // Optional: note for history
 *   tracking_info?: string,      // Optional: tracking text (for shipped)
 *   cancellation_reason?: string, // Optional: reason (for cancelled)
 *   refund_txid?: string,        // Optional: blockchain tx hash (for refunded)
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Auth check
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const orderId = params.id;
    if (!orderId || orderId === 'undefined' || orderId === 'null' || orderId.trim() === '') {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const body = await request.json();
    const newStatus = body.status;
    const note = body.note || null;
    const trackingInfo = body.tracking_info || null;
    const cancellationReason = body.cancellation_reason || null;
    const refundTxid = body.refund_txid || null;

    if (!newStatus || typeof newStatus !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "status" field' }, { status: 400 });
    }

    await connectDB();

    // Find order using raw collection (string _id)
    const order = await Order.collection.findOne({ _id: orderId } as any);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Permission check: bot owners can only manage their own bot's orders
    if (payload.role !== 'super-admin') {
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      const orderBotId = typeof order.botId === 'string' ? order.botId : order.botId?.toString();
      if (!orderBotId || !userBotIds.includes(orderBotId)) {
        return NextResponse.json({ error: 'Unauthorized - not your bot' }, { status: 403 });
      }
    }

    const currentStatus = order.paymentStatus || 'pending';

    // Validate transition
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      return NextResponse.json({
        error: `Cannot transition from '${currentStatus}' to '${newStatus}'. Allowed: [${allowed.join(', ')}]`,
      }, { status: 400 });
    }

    const now = new Date();

    // Build $set update
    const updateSet: Record<string, any> = {
      paymentStatus: newStatus,
      [`${newStatus}_at`]: now,
    };

    if (trackingInfo) {
      updateSet.tracking_info = trackingInfo;
    }
    if (cancellationReason) {
      updateSet.cancellation_reason = cancellationReason;
      updateSet.cancelled_by = 'vendor';
    }
    if (refundTxid) {
      updateSet.refund_txid = refundTxid;
    }

    // Build history entry
    const historyEntry = {
      from_status: currentStatus,
      to_status: newStatus,
      changed_by: `vendor:${payload.userId}`,
      changed_at: now,
      note: note,
    };

    // Atomic update: only proceed if status hasn't changed concurrently
    const result = await Order.collection.findOneAndUpdate(
      { _id: orderId, paymentStatus: currentStatus } as any,
      {
        $set: updateSet,
        $push: { status_history: historyEntry } as any,
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({
        error: 'Concurrent update conflict - order status may have changed',
      }, { status: 409 });
    }

    // Update invoice status
    const db = mongoose.connection.db;
    if (db) {
      const invoicesCollection = db.collection('invoices');
      const invoiceStatus = INVOICE_STATUS_MAP[newStatus] || newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
      await invoicesCollection.updateOne(
        { invoice_id: orderId },
        { $set: { status: invoiceStatus, updated_at: now } }
      );
    }

    // Send buyer notification via Telegram bot
    try {
      await notifyBuyer(order, newStatus, trackingInfo, cancellationReason, refundTxid);
    } catch (notifyErr) {
      console.error('[OrderStatus] Failed to notify buyer:', notifyErr);
      // Don't fail the request if notification fails
    }

    return NextResponse.json({
      success: true,
      message: `Order ${orderId} transitioned from '${currentStatus}' to '${newStatus}'`,
      orderId,
      previousStatus: currentStatus,
      newStatus,
    });
  } catch (error: any) {
    console.error('Error updating order status:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Send a Telegram notification to the buyer about the status change.
 * Uses the bot token from the bot config to send a message.
 */
async function notifyBuyer(
  order: any,
  newStatus: string,
  trackingInfo?: string | null,
  cancellationReason?: string | null,
  refundTxid?: string | null,
) {
  const db = mongoose.connection.db;
  if (!db) return;

  const botConfig = await db.collection('bots').findOne({ _id: order.botId });
  if (!botConfig || !botConfig.token) return;

  const orderId = String(order._id);
  const template = BUYER_MESSAGES[newStatus];
  if (!template) return;

  const message = template
    .replace('{order_id}', orderId)
    .replace('{reason}', cancellationReason ? `\nReason: ${cancellationReason}` : '')
    .replace('{txid}', refundTxid ? `\nTransaction: ${refundTxid}` : '');

  // Use Telegram Bot API directly via fetch
  const botToken = botConfig.token;
  const userId = order.userId;

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        text: message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`[OrderStatus] Telegram API error: ${errorData}`);
    }
  } catch (err) {
    console.error('[OrderStatus] Error sending Telegram message:', err);
  }
}
