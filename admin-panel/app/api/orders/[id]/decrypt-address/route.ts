import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { Order, User } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';

/**
 * API endpoint to decrypt order address
 * Requires admin authentication and user's secret phrase
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

    // Validate order ID
    const orderId = params.id;
    if (!orderId || orderId === 'undefined' || orderId === 'null' || orderId.trim() === '') {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    // Get optional secret phrase from request body (for manual entry)
    let manualSecretPhrase: string | undefined;
    try {
      const body = await request.json();
      manualSecretPhrase = body.secretPhrase;
    } catch (e) {
      // No body or invalid JSON - that's fine, we'll use user's current secret phrase
    }

    await connectDB();

    // Get order - Orders from Python bot use UUID strings, not MongoDB ObjectIds
    // Use MongoDB native collection to bypass Mongoose's ObjectId casting
    const order = await Order.collection.findOne({ _id: orderId } as any);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Check permissions - bot owners can only decrypt their own bot's orders
    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      // Handle both string and ObjectId botId from order
      const orderBotId = typeof order.botId === 'string' ? order.botId : order.botId.toString();
      if (!userBotIds.includes(orderBotId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }
    }

    if (!order.encrypted_address) {
      return NextResponse.json({ 
        address: null,
        message: 'No address stored for this order'
      });
    }

    // Get user's secret phrase - userId might be string or ObjectId
    const userId = typeof order.userId === 'string' ? order.userId : order.userId.toString();
    // Use native collection to avoid ObjectId casting issues
    let user = await User.collection.findOne({ _id: userId });
    
    // If not found, try as ObjectId
    if (!user) {
      try {
        const mongoose = require('mongoose');
        const objectId = new mongoose.Types.ObjectId(userId);
        user = await User.collection.findOne({ _id: objectId });
      } catch (e) {
        // Not a valid ObjectId, user stays null
      }
    }
    // Use manual secret phrase if provided, otherwise use user's current secret phrase
    let secretPhraseToUse: string | undefined;
    
    if (manualSecretPhrase) {
      secretPhraseToUse = manualSecretPhrase;
      console.log('Using manually provided secret phrase for decryption');
    } else if (user && user.secret_phrase) {
      secretPhraseToUse = user.secret_phrase;
    }
    
    if (!secretPhraseToUse) {
      return NextResponse.json({ 
        error: 'User secret phrase not found. Please provide the secret phrase manually if the user changed it.' 
      }, { status: 404 });
    }

    // Decrypt address using the decryption utility
    const { decryptAddress } = await import('../../../../lib/address_decryption');
    
    console.log('Attempting to decrypt address for order:', orderId);
    console.log('User ID:', userId);
    console.log('Has encrypted_address:', !!order.encrypted_address);
    console.log('Encrypted address length:', order.encrypted_address?.length || 0);
    console.log('Encrypted address (first 40 chars):', order.encrypted_address?.substring(0, 40) || 'N/A');
    console.log('Using secret phrase:', manualSecretPhrase ? 'Manual (provided)' : 'User current');
    console.log('Order has secret_phrase_hash:', !!order.secret_phrase_hash);
    
    // Try with the selected secret phrase
    let decryptionResult = await decryptAddress(order.encrypted_address, secretPhraseToUse);
    
    // If decryption fails, check the reason
    if (!decryptionResult.success) {
      console.error('Decryption failed:', decryptionResult.error);
      
      const errorMsg = decryptionResult.error || 'Failed to decrypt address';
      const isHMACError = errorMsg.includes('HMAC') || errorMsg.includes('Invalid Token');
      
      // Check if secret phrase changed (only if we have hash to compare)
      if (isHMACError && order.secret_phrase_hash && user && user.secret_phrase) {
      const crypto = require('crypto');
      const currentPhraseHash = crypto.createHash('sha256').update(user.secret_phrase).digest('hex');
      
        console.log('HMAC error detected. Checking if secret phrase changed...');
      console.log('Order secret_phrase_hash:', order.secret_phrase_hash);
      console.log('Current secret_phrase_hash:', currentPhraseHash);
      
      if (currentPhraseHash !== order.secret_phrase_hash) {
        // Secret phrase doesn't match - user changed it after order creation
        return NextResponse.json({ 
          error: 'Decryption failed: The address was encrypted with a different secret phrase. ' +
                 'The user changed their secret phrase after creating this order. ' +
                 'To view the address, you need the secret phrase that was active when the order was created. ' +
                 'The order was encrypted with secret phrase hash: ' + order.secret_phrase_hash.substring(0, 16) + '...',
          errorCode: 'SECRET_PHRASE_MISMATCH',
          orderSecretPhraseHash: order.secret_phrase_hash
        }, { status: 400 });
        } else {
          // Secret phrase matches but decryption still fails - likely encryption key mismatch
          console.error('Secret phrase hash matches, but decryption failed. This indicates encryption key mismatch.');
          console.error('Verify ADDRESS_ENCRYPTION_KEY is the same in both telegram-bot-service and admin-panel');
          
          return NextResponse.json({ 
            error: 'Decryption failed: The encryption key does not match. ' +
                   'This order was encrypted with a different ADDRESS_ENCRYPTION_KEY than the one currently configured. ' +
                   'Possible causes:\n' +
                   '1. The order was created before ADDRESS_ENCRYPTION_KEY was set in the bot service\n' +
                   '2. The ADDRESS_ENCRYPTION_KEY in admin-panel/.env.local does not match telegram-bot-service/.env\n' +
                   '3. The admin panel server needs to be restarted to pick up the new environment variable\n\n' +
                   'Note: Orders encrypted before ADDRESS_ENCRYPTION_KEY was set cannot be decrypted.',
            errorCode: 'ENCRYPTION_KEY_MISMATCH'
          }, { status: 400 });
        }
      } else if (isHMACError) {
        // HMAC error but no hash to compare - likely encryption key or secret phrase issue
        return NextResponse.json({ 
          error: 'Decryption failed: Invalid Token (HMAC verification failed). ' +
                 'Possible causes:\n' +
                 '1. The user changed their secret phrase after creating this order\n' +
                 '2. The ADDRESS_ENCRYPTION_KEY does not match between services\n' +
                 '3. The order was encrypted before ADDRESS_ENCRYPTION_KEY was properly configured\n\n' +
                 'Try entering the secret phrase manually if the user changed it, or verify the encryption keys match.',
          errorCode: 'DECRYPTION_FAILED'
        }, { status: 400 });
      }
      
      return NextResponse.json({ 
        error: errorMsg
      }, { status: 500 });
    }
    
    return NextResponse.json({
      address: decryptionResult.address,
      success: true
    });
  } catch (error: any) {
    console.error('Error decrypting address:', error);
    console.error('Error stack:', error.stack);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

