import Link from 'next/link';
import Image from 'next/image';
import connectDB from '../../../lib/db';
import { Bot, Cart } from '../../../lib/models';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import TelegramLinkStatus from '../../../components/TelegramLinkStatus';
import CartBadge from '../../../components/CartBadge';

async function getShopData(slug: string) {
  await connectDB();
  const bot = await Bot.findOne({
    web_shop_slug: slug,
    web_shop_enabled: true,
  }).lean();
  return bot;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  await connectDB();
  const bot = await Bot.findOne({
    web_shop_slug: slug,
    web_shop_enabled: true,
  }).lean() as Record<string, unknown> | null;

  if (!bot) {
    return { title: 'Shop Not Found' };
  }

  const title = `${bot.name} | Auroneth Web Shop`;
  const description =
    (bot.web_shop_description as string) ||
    (bot.description as string) ||
    `Browse products at ${bot.name} on Auroneth.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      ...(bot.profile_picture_url ? { images: [{ url: bot.profile_picture_url as string }] } : {}),
    },
  };
}

async function getCartCount(botId: string, sessionId: string | undefined) {
  if (!sessionId) return 0;
  await connectDB();
  const cart = await Cart.findOne({ bot_id: botId, session_id: sessionId }).lean() as { items: Array<{ quantity: number }> } | null;
  if (!cart) return 0;
  return cart.items.reduce((sum, i) => sum + i.quantity, 0);
}

export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const bot = await getShopData(slug);

  if (!bot) {
    notFound();
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get('shop_session_id')?.value;
  const telegramUsername = cookieStore.get('telegram_username')?.value || null;
  const cartCount = await getCartCount(String(bot._id), sessionId);

  // Bot's Telegram username for the login widget
  const botTelegramUsername = (bot as Record<string, unknown>).telegram_username as string | undefined;
  const botId = String(bot._id);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Shop Header */}
      <header className="bg-gray-800/80 border-b border-gray-700 shadow-sm backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href={`/shop/${slug}`} className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image
                src="/logo.png"
                alt={bot.name}
                width={48}
                height={48}
                className="h-10 w-auto object-contain"
              />
              <span className="text-lg font-bold text-white">{bot.name}</span>
            </Link>

            <div className="flex items-center gap-4">
              {botTelegramUsername && (
                <TelegramLinkStatus
                  botUsername={botTelegramUsername}
                  botId={botId}
                  initialLinkedUsername={
                    telegramUsername ? `@${telegramUsername}` : null
                  }
                />
              )}
              <CartBadge slug={slug} initialCount={cartCount} />
            </div>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main>{children}</main>

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Image
                src="/logo.png"
                alt="Auroneth"
                width={32}
                height={32}
                className="h-6 w-auto object-contain"
              />
              <span className="text-sm text-gray-400">Powered by Auroneth</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <Link href="/" className="hover:text-white transition-colors">Marketplace</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
