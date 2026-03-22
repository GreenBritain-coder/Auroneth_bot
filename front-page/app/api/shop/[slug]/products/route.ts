import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '../../../../../lib/db';
import { Bot, Product } from '../../../../../lib/models';
import { getProductPrice } from '../../../../../lib/product-utils';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    await connectDB();
    const { slug } = await params;

    const bot = await Bot.findOne({
      web_shop_slug: slug,
      web_shop_enabled: true,
    }).lean();

    if (!bot) {
      return NextResponse.json(
        { error: 'Shop not found or disabled' },
        { status: 404 }
      );
    }

    const botId = String(bot._id);
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const subcategory = searchParams.get('subcategory');
    const cursor = searchParams.get('cursor');
    const limit = Math.min(parseInt(searchParams.get('limit') || '24', 10), 100);

    const filter: Record<string, unknown> = { bot_ids: botId };
    if (subcategory) {
      filter.subcategory_id = subcategory;
    } else if (category) {
      filter.category_id = category;
    }
    if (cursor) {
      filter._id = { $gt: new mongoose.Types.ObjectId(cursor) };
    }

    const products = await Product.find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .lean();

    const hasMore = products.length > limit;
    const page = hasMore ? products.slice(0, limit) : products;

    const normalized = page.map((p) => ({
      _id: p._id,
      name: p.name,
      price: getProductPrice(p),
      currency: p.currency,
      image_url: p.image_url || '',
      unit: p.unit || 'pcs',
      variations: p.variations || [],
    }));

    return NextResponse.json({
      products: normalized,
      next_cursor: hasMore ? String(page[page.length - 1]._id) : null,
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
