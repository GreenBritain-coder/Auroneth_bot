import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { Order } from '@/lib/models';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';
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
    
    // Super-admins see all orders, bot-owners only see orders for their bots
    let orders;
    if (payload.role === 'super-admin') {
      orders = await Order.find({}).sort({ timestamp: -1 }).lean();
    } else {
      // Get user's bots
      const { Bot } = await import('@/lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      // Get orders for user's bots
      orders = await Order.find({
        botId: { $in: userBotIds }
      }).sort({ timestamp: -1 }).lean();
    }
    
    // Fetch invoices to get notes - invoices are stored in 'invoices' collection
    // Invoice invoice_id matches order _id
    const db = mongoose.connection.db;
    const invoicesCollection = db.collection('invoices');
    
    // Get all invoice IDs (order IDs) to fetch notes
    const orderIds = orders.map(o => {
      if (o._id) {
        return typeof o._id === 'string' ? o._id : o._id.toString();
      }
      return null;
    }).filter(id => id !== null);
    
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
    const { Bot } = await import('@/lib/models');
    const uniqueBotIds = [...new Set(orders.map(o => {
      const botId = o.botId;
      return typeof botId === 'string' ? botId : botId.toString();
    }))];
    
    const bots = await Bot.find({
      _id: { $in: uniqueBotIds }
    }).lean();
    
    // Create a map of botId -> bot name
    const botNamesMap: Record<string, string> = {};
    bots.forEach(bot => {
      const botId = bot._id.toString();
      botNamesMap[botId] = bot.name || 'Unknown Bot';
    });
    
    console.log(`Found ${orders.length} orders from database`);
    if (orders.length > 0) {
      console.log('Sample order keys:', Object.keys(orders[0]));
      console.log('Sample order _id:', orders[0]._id, typeof orders[0]._id);
    }
    
    // Convert orders to plain objects and ensure _id is a string
    // Using .lean() returns plain JavaScript objects, not Mongoose documents
    const ordersData = orders.map(order => {
      try {
        // With .lean(), order is already a plain object
        // Get _id from the order object
        let orderId: string | null = null;
        
        if (order._id) {
          if (typeof order._id === 'string') {
            orderId = order._id;
          } else if (order._id.toString) {
            orderId = order._id.toString();
          } else {
            orderId = String(order._id);
          }
        }
        
        if (!orderId) {
          console.warn('Order missing _id:', Object.keys(order), order);
          return null;
        }
        
        // Only skip if _id is the literal string "undefined" (not actual undefined/null)
        if (orderId === 'undefined') {
          console.warn('Order has "undefined" string as _id:', orderId);
          return null;
        }
        
        // Log encrypted_address for debugging - compare to see if all orders have same address
        if (order.encrypted_address) {
          const addressHash = require('crypto').createHash('sha256').update(order.encrypted_address).digest('hex').substring(0, 16);
          console.log(`Order ${orderId}: has encrypted_address (length: ${order.encrypted_address.length}, hash: ${addressHash})`);
        } else {
          console.log(`Order ${orderId}: NO encrypted_address`);
        }
        
        const botId = order.botId?.toString() || order.botId;
        
        return {
          ...order,
          _id: orderId, // Explicitly set _id as string
          botId: botId,
          botName: botNamesMap[botId] || 'Unknown Bot',
          productId: order.productId?.toString() || order.productId,
          // Include encrypted_address if it exists (for UI to show "View Address" button)
          // Only include if it's actually set (not empty string)
          encrypted_address: order.encrypted_address && order.encrypted_address.trim() ? order.encrypted_address : undefined,
          // Include notes from invoice if available
          notes: notesMap[orderId] || undefined,
        };
      } catch (error) {
        console.error('Error processing order:', error, order);
        return null;
      }
    }).filter(order => order !== null); // Remove any null entries
    
    // Count orders with addresses for debugging
    const ordersWithAddresses = ordersData.filter(o => o.encrypted_address).length;
    console.log(`Returning ${ordersData.length} orders out of ${orders.length} total`);
    console.log(`Orders with encrypted_address: ${ordersWithAddresses}`);
    
    return NextResponse.json(ordersData);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

