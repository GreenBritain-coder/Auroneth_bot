import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../lib/db';
import { Bot, Category, Subcategory } from '../../../../../lib/models';

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
    const [categories, subcategories] = await Promise.all([
      Category.find({ bot_ids: botId }).sort({ order: 1 }).lean(),
      Subcategory.find({ bot_ids: botId }).sort({ order: 1 }).lean(),
    ]);

    const subsByCategory = new Map<string, Array<{ _id: unknown; name: string }>>();
    for (const sub of subcategories) {
      const key = sub.category_id;
      if (!subsByCategory.has(key)) {
        subsByCategory.set(key, []);
      }
      subsByCategory.get(key)!.push({ _id: sub._id, name: sub.name });
    }

    const tree = categories.map((cat) => ({
      _id: cat._id,
      name: cat.name,
      subcategories: subsByCategory.get(String(cat._id)) || [],
    }));

    const res = NextResponse.json({ categories: tree });
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res;
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
