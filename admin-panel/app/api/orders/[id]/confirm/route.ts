import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../lib/db';
import { Order, Bot } from '../../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../../lib/auth';
import mongoose from 'mongoose';

/**
 * API endpoint to manually confirm an order payment
 * Use when webhook hasn't worked or payment was verified off-chain
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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

    await connectDB();

    const order = await Order.collection.findOne({ _id: orderId } as any);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Check permissions - bot owners can only confirm their own bot's orders
    if (payload.role !== 'super-admin') {
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      const orderBotId = typeof order.botId === 'string' ? order.botId : order.botId?.toString();
      if (!orderBotId || !userBotIds.includes(orderBotId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }
    }

    const currentStatus = order.paymentStatus;
    if (currentStatus === 'paid') {
      return NextResponse.json({
        success: true,
        message: 'Order is already marked as paid',
        orderId,
      });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: 'Database connection error' }, { status: 500 });
    }

    const invoicesCollection = db.collection('invoices');
    const commissionsCollection = db.collection('commissions');

    const now = new Date();

    // Atomic update with state machine pattern: only transition if still pending
    const updateResult = await Order.collection.findOneAndUpdate(
      { _id: orderId, paymentStatus: { $in: ['pending', 'failed'] } } as any,
      {
        $set: {
          paymentStatus: 'paid',
          paid_at: now,
          paymentDetails: {
            status: 'confirmed',
            provider: 'manual',
            manually_confirmed: true,
            confirmed_at: now,
          },
        },
        $push: {
          status_history: {
            from_status: currentStatus,
            to_status: 'paid',
            changed_by: `vendor:${payload.userId}`,
            changed_at: now,
            note: 'Manual payment confirmation from admin panel',
          },
        } as any,
      },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      return NextResponse.json({
        error: `Cannot confirm: order status is '${currentStatus}', expected 'pending'`,
      }, { status: 400 });
    }

    // Update invoice status (try multiple lookup strategies)
    let invoice = await invoicesCollection.findOne({ invoice_id: orderId });
    if (!invoice) {
      invoice = await invoicesCollection.findOne({ payment_invoice_id: orderId });
    }
    if (invoice && invoice.status !== 'Paid') {
      await invoicesCollection.updateOne(
        { _id: invoice._id },
        { $set: { status: 'Paid', updated_at: now } }
      );
    } else if (!invoice) {
      await invoicesCollection.updateOne(
        { invoice_id: orderId },
        { $set: { status: 'Paid', updated_at: now } }
      );
      await invoicesCollection.updateMany(
        { payment_invoice_id: orderId },
        { $set: { status: 'Paid', updated_at: now } }
      );
    }

    // Create commission record if not exists
    const existingCommission = await commissionsCollection.findOne({ orderId });
    if (!existingCommission) {
      await commissionsCollection.insertOne({
        botId: order.botId,
        orderId,
        amount: order.commission ?? 0,
        timestamp: new Date(),
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Order confirmed successfully',
      orderId,
    });
  } catch (error: any) {
    console.error('Error confirming order:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
