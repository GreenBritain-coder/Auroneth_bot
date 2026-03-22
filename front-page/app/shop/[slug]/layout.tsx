import Link from 'next/link';
import Image from 'next/image';
import connectDB from '../../../lib/db';
import { Bot, Cart } from '../../../lib/models';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

async function getShopData(slug: string) {
  await connectDB();
  const bot = await Bot.findOne({
    web_shop_slug: slug,
    web_shop_enabled: true,
  }).lean();
  return bot;
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
  const cartCount = await getCartCount(String(bot._id), sessionId);

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
              <Link
                href={`/shop/${slug}/cart`}
                className="relative p-2 text-gray-300 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </Link>
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
