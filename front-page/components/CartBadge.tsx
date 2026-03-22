'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface CartBadgeProps {
  slug: string;
  initialCount: number;
}

export default function CartBadge({ slug, initialCount }: CartBadgeProps) {
  const [count, setCount] = useState(initialCount);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/shop/${slug}/cart?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setCount(data.cart?.item_count || 0);
      }
    } catch {
      // ignore
    }
  }, [slug]);

  useEffect(() => {
    // Listen for cart updates from product pages
    const handler = () => refreshCount();
    window.addEventListener('cart-updated', handler);

    // Also poll every 5 seconds in case of cross-tab updates
    const interval = setInterval(refreshCount, 5000);

    return () => {
      window.removeEventListener('cart-updated', handler);
      clearInterval(interval);
    };
  }, [refreshCount]);

  return (
    <Link
      href={`/shop/${slug}/cart`}
      className="relative p-2 text-gray-300 hover:text-white transition-colors"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100-4 2 2 0 000-4z" />
      </svg>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
