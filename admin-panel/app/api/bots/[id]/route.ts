import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '../../../../lib/db';
import { Bot } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';

export async function GET(
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

    await connectDB();
    const bot = await Bot.findById(params.id);

    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Check ownership: super-admins can access any bot, bot-owners only their own
    if (payload.role !== 'super-admin' && bot.owner !== payload.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // For bot-owners: compute rating and rating_count from reviews (dynamic)
    const botResponse = bot.toObject ? bot.toObject() : { ...bot };
    if (payload.role !== 'super-admin') {
      const db = mongoose.connection.db;
      if (db) {
        const reviews = db.collection('reviews');
        const botIdStr = String(params.id);
        let reviewDocs = await reviews.find({ bot_id: botIdStr }).toArray();
        if (reviewDocs.length === 0 && /^[a-f0-9]{24}$/i.test(botIdStr)) {
          reviewDocs = await reviews.find({ bot_id: new mongoose.Types.ObjectId(botIdStr) }).toArray();
        }
        if (reviewDocs.length > 0) {
          const avgRating = reviewDocs.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / reviewDocs.length;
          // Convert 1-5 scale to percentage (e.g. 4.5/5 = 90%)
          const ratingPct = (avgRating / 5 * 100).toFixed(2);
          (botResponse as any).rating = ratingPct;
          (botResponse as any).rating_count = String(reviewDocs.length);
        }
      }
    }

    return NextResponse.json(botResponse);
  } catch (error) {
    console.error('Error fetching bot:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    await connectDB();
    
    // Check ownership first
    const existingBot = await Bot.findById(params.id);
    if (!existingBot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    if (payload.role !== 'super-admin' && existingBot.owner !== payload.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const data = await request.json();
    
    console.log('PATCH request - User role:', payload.role);
    console.log('PATCH request - Data received:', JSON.stringify(data, null, 2));
    
    // Bot-owners cannot change owner, super-admins can
    if (payload.role !== 'super-admin' && data.owner) {
      delete data.owner;
    }
    
    // Only super-admins can modify categories, featured, and rating fields
    if (payload.role !== 'super-admin') {
      delete data.categories;
      delete data.featured;
      delete data.rating;
      delete data.rating_count;
    } else {
      console.log('Super-admin updating - categories:', data.categories, 'featured:', data.featured);
    }

    // Build update object
    const updateData: any = { ...data };
    
    // Always handle cut_off_time explicitly (ensure it's saved even if empty)
    if (data.cut_off_time !== undefined) {
      const trimmed = typeof data.cut_off_time === 'string' ? data.cut_off_time.trim() : '';
      updateData.cut_off_time = trimmed;
      console.log('Processing cut_off_time from request:', data.cut_off_time, '->', trimmed);
    }
    
    // For super-admins, explicitly handle categories and featured
    if (payload.role === 'super-admin') {
      // Always set categories (even if empty array)
      updateData.categories = Array.isArray(data.categories) ? data.categories : [];
      // Always set featured (even if false)
      updateData.featured = data.featured !== undefined ? Boolean(data.featured) : false;
    } else {
      // Remove if not super-admin
      delete updateData.categories;
      delete updateData.featured;
    }

    console.log('Updating with data:', JSON.stringify(updateData, null, 2));

    // Update all fields manually to ensure they're saved
    // Use existingBot which was already fetched for ownership check
    Object.keys(updateData).forEach((key) => {
      if (key === 'messages' || key === 'inline_action_messages') {
        // For nested objects, replace entirely
        (existingBot as any)[key] = updateData[key];
      } else if (key === 'main_buttons' && Array.isArray(updateData[key])) {
        (existingBot as any)[key] = updateData[key];
      } else if (key === 'menu_inline_buttons' && Array.isArray(updateData[key])) {
        (existingBot as any)[key] = updateData[key];
      } else if (key === 'categories' && Array.isArray(updateData[key])) {
        (existingBot as any)[key] = updateData[key];
      } else if (key === 'shipping_methods' && Array.isArray(updateData[key])) {
        (existingBot as any)[key] = updateData[key];
      } else if (key === 'custom_buttons' && Array.isArray(updateData[key])) {
        (existingBot as any)[key] = updateData[key];
      } else {
        (existingBot as any)[key] = updateData[key];
      }
    });

    // Mark all fields as modified to ensure Mongoose saves them
    existingBot.markModified('messages');
    existingBot.markModified('inline_action_messages');
    existingBot.markModified('main_buttons');
    existingBot.markModified('menu_inline_buttons');
    if (updateData.categories) {
      existingBot.markModified('categories');
    }
    // Explicitly mark cut_off_time as modified to ensure it's saved
    if ('cut_off_time' in updateData) {
      existingBot.markModified('cut_off_time');
      console.log('Marked cut_off_time as modified, value:', updateData.cut_off_time);
    }
    // Explicitly mark rating fields as modified so they persist to MongoDB
    if ('rating' in updateData) {
      existingBot.markModified('rating');
    }
    if ('rating_count' in updateData) {
      existingBot.markModified('rating_count');
    }
    if ('shipping_methods' in updateData) {
      existingBot.markModified('shipping_methods');
    }
    if ('custom_buttons' in updateData) {
      existingBot.markModified('custom_buttons');
    }

    // Save the bot to ensure all changes are persisted
    await existingBot.save();
    
    // Fetch fresh from database using lean() to get raw document
    const updatedBot = await Bot.findById(params.id).lean();
    
    console.log('Bot after update - categories:', updatedBot?.categories, 'featured:', updatedBot?.featured, 'cut_off_time:', updatedBot?.cut_off_time);
    console.log('Bot document keys:', Object.keys(updatedBot || {}));
    console.log('Full bot document:', JSON.stringify(updatedBot, null, 2));
    
    // Return the updated bot with all fields
    return NextResponse.json(updatedBot);
  } catch (error) {
    console.error('Error updating bot:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    await connectDB();
    
    // Check ownership first
    const bot = await Bot.findById(params.id);
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    if (payload.role !== 'super-admin' && bot.owner !== payload.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await Bot.findByIdAndDelete(params.id);
    return NextResponse.json({ message: 'Bot deleted' });
  } catch (error) {
    console.error('Error deleting bot:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

