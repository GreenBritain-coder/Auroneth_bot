import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { Bot, Product, Category } from '../../../../lib/models';

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
    const [productsCount, categoriesCount] = await Promise.all([
      Product.countDocuments({ bot_ids: botId }),
      Category.countDocuments({ bot_ids: botId }),
    ]);

    const res = NextResponse.json({
      shop: {
        name: bot.name,
        slug: bot.web_shop_slug,
        description: bot.description || '',
        banner_url: (bot as Record<string, unknown>).web_shop_banner_url || null,
        profile_picture_url: bot.profile_picture_url || null,
        categories_count: categoriesCount,
        products_count: productsCount,
      },
    });
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res;
  } catch (error) {
    console.error('Error fetching shop config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
