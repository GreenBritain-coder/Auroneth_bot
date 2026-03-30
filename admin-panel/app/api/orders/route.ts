import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';

export const dynamic = 'force-dynamic';
import { Order } from '../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../lib/auth';
import mongoose from 'mongoose';

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectDB();

    // Pagination
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') || '1'));
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 100); // Max 100 per page
    const skip = (page - 1) * limit;

    // Super-admins see all orders, bot-owners only see orders for their bots
    const query = payload.role === 'super-admin' ? {} : {};
    let userBotIds: string[] = [];

    if (payload.role !== 'super-admin') {
      // Get user's bots
      const { Bot } = await import('../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      userBotIds = userBots.map(b => b._id.toString());
      query.botId = { $in: userBotIds };
    }

    // Get total count for pagination
    const total = await Order.countDocuments(query);

    // Get paginated orders
    const orders = await Order.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Fetch invoices to get notes - invoices are stored in 'invoices' collection
    // Invoice invoice_id matches order _id
    const db = mongoose.connection.db;
    if (!db) throw new Error('Database not connected');
    const invoicesCollection = db.collection('invoices');
    
    // Get all invoice IDs (order IDs) to fetch notes
    const orderIds = orders.map(o => {
      if (o._id) {
        return typeof o._id === 'string' ? o._id : String(o._id);
      }
      return null;
    }).filter((id): id is string => id !== null);
    
    // Fetch invoices for these orders
    const invoices = await invoicesCollection.find({
      invoice_id: { $in: orderIds }
    }).toArray();
    
    // Create a map of invoice_id -> notes for quick lookup
    const notesMap: Record<string, string> = {};
    invoices.forEach(invoice => {
      if (invoice.invoice_id && invoice.notes) {
        notesMap[invoice.invoice_id] = invoice.notes;
      }
    });
    
    // Fetch bot names for all unique botIds
    const { Bot } = await import('../../../lib/models');
    const uniqueBotIds = [...new Set(orders.map(o => {
      const botId = o.botId;
      return botId != null ? (typeof botId === 'string' ? botId : String(botId)) : undefined;
    }))].filter((id): id is string => id !== undefined);
    
    const bots = await Bot.find({
      _id: { $in: uniqueBotIds }
    }).lean();
    
    // Create a map of botId -> bot name
    const botNamesMap: Record<string, string> = {};
    bots.forEach(bot => {
      const botId = String(bot._id);
      botNamesMap[botId] = bot.name || 'Unknown Bot';
    });
    
    // Fetch product names for all unique product IDs in order items
    const { Product } = await import('../../../lib/models');
    const allProductIds = new Set<string>();
    orders.forEach(o => {
      if (o.productId) allProductIds.add(String(o.productId));
      if (o.items && Array.isArray(o.items)) {
        o.items.forEach((item: any) => {
          if (item.product_id) allProductIds.add(String(item.product_id));
        });
      }
      // Web orders store items in items_snapshot
      const snapshot = (o as any).items_snapshot;
      if (snapshot && Array.isArray(snapshot)) {
        snapshot.forEach((item: any) => {
          if (item.product_id) allProductIds.add(String(item.product_id));
        });
      }
    });
    const products = await Product.find({
      _id: { $in: [...allProductIds] }
    }).lean();
    const productNamesMap: Record<string, string> = {};
    const productVariationsMap: Record<string, Array<{ name: string }>> = {};
    products.forEach((p: any) => {
      productNamesMap[String(p._id)] = p.name || 'Unknown Product';
      productVariationsMap[String(p._id)] = p.variations || [];
    });

    // Convert orders to plain objects and ensure _id is a string
    // Using .lean() returns plain JavaScript objects, not Mongoose documents
    const ordersData = orders.map(order => {
      try {
        let orderId: string | null = null;

        if (order._id) {
          orderId = typeof order._id === 'string' ? order._id : String(order._id);
        }

        if (!orderId || orderId === 'undefined') {
          return null;
        }

        const botId = order.botId != null ? String(order.botId) : order.botId;
        const isWebOrder = (order as any).source === 'web';

        // Normalize web order fields to match Telegram order format
        const amount = order.amount || (order as any).display_amount || 0;
        const currency = order.currency || (order as any).crypto_currency || '';
        const timestamp = order.timestamp || (order as any).created_at;
        const userId = order.userId || (isWebOrder ? 'web' : undefined);

        // For web orders, derive product info from items_snapshot
        let productName = order.productId ? productNamesMap[String(order.productId)] : undefined;
        const itemsSnapshot = (order as any).items_snapshot as Array<{ product_id: string; name: string; quantity: number; price: number; line_total: number }> | undefined;
        if (!productName && itemsSnapshot?.length) {
          productName = itemsSnapshot.map(i => i.name).join(', ');
        }

        // Build items array for web orders from items_snapshot if no items field
        const items = order.items?.map((item: any) => {
          const pid = String(item.product_id || '');
          const baseName = item.product_name || (pid ? productNamesMap[pid] : undefined);
          const variations = pid ? productVariationsMap[pid] : [];
          const variationIndex = item.variation_index;
          const variationName = (variationIndex != null && variations && variationIndex < variations.length)
            ? variations[variationIndex].name
            : null;
          const displayName = baseName && variationName ? `${baseName} - ${variationName}` : (baseName || variationName);
          return {
            ...item,
            product_name: displayName,
          };
        }) || itemsSnapshot?.map((item: any) => ({
          ...item,
          product_name: item.name,
        }));

        return {
          ...order,
          _id: orderId,
          botId: botId,
          botName: botNamesMap[botId] || 'Unknown Bot',
          productId: order.productId != null ? String(order.productId) : (itemsSnapshot?.[0]?.product_id || undefined),
          productName,
          amount,
          currency,
          timestamp,
          userId,
          source: isWebOrder ? 'web' : 'telegram',
          order_number: (order as any).order_number || undefined,
          items,
          encrypted_address: order.encrypted_address && order.encrypted_address.trim() ? order.encrypted_address : undefined,
          notes: notesMap[orderId] || undefined,
        };
      } catch (error) {
        console.error('Error processing order:', error, order);
        return null;
      }
    }).filter(order => order !== null);

    return NextResponse.json({
      data: ordersData,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

