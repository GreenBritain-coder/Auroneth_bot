'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

interface CartItem {
  product_id: string;
  name: string;
  price: number;
  price_changed: boolean;
  quantity: number;
  line_total: number;
  in_stock: boolean;
  image_url: string;
  unit?: string;
}

interface CartData {
  items: CartItem[];
  subtotal: number;
  discount: number;
  discount_code?: string | null;
  total: number;
  currency: string;
  item_count: number;
  has_stale_prices: boolean;
  has_out_of_stock: boolean;
}

export default function CartPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [applyingDiscount, setApplyingDiscount] = useState(false);

  useEffect(() => {
    fetchCart();
  }, [slug]);

  const fetchCart = async () => {
    try {
      const res = await fetch(`/api/shop/${slug}/cart?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setCart(data.cart);
      }
    } catch (err) {
      console.error('Error fetching cart:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    setUpdating(productId);
    try {
      const res = await fetch(`/api/shop/${slug}/cart`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, quantity }),
      });
      if (res.ok) {
        const data = await res.json();
        setCart(data.cart);
      }
    } catch (err) {
      console.error('Error updating cart:', err);
    } finally {
      setUpdating(null);
    }
  };

  const removeItem = async (productId: string) => {
    setUpdating(productId);
    try {
      const res = await fetch(`/api/shop/${slug}/cart`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
      });
      if (res.ok) {
        const data = await res.json();
        setCart(data.cart);
      }
    } catch (err) {
      console.error('Error removing item:', err);
    } finally {
      setUpdating(null);
    }
  };

  const applyDiscount = async () => {
    if (!discountCode.trim()) return;
    setApplyingDiscount(true);
    setDiscountError(null);
    try {
      const res = await fetch(`/api/shop/${slug}/cart/discount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: discountCode.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setCart(data.cart);
        setDiscountCode('');
      } else {
        setDiscountError(data.error || 'Invalid discount code');
      }
    } catch (err) {
      console.error('Error applying discount:', err);
      setDiscountError('Failed to apply discount');
    } finally {
      setApplyingDiscount(false);
    }
  };

  const currencySymbol = cart?.currency === 'GBP' ? '\u00a3' : '$';

  if (loading) {
    return (
      <div className="text-center py-24">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
        <p className="mt-4 text-gray-400">Loading cart...</p>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
        <h2 className="text-2xl font-bold text-white mb-2">Your cart is empty</h2>
        <p className="text-gray-400 mb-6">Add some products to get started.</p>
        <Link
          href={`/shop/${slug}`}
          className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Continue Shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Shopping Cart</h1>

      {/* Stale Price Warning */}
      {cart.has_stale_prices && (
        <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 mb-6">
          <p className="text-amber-300 text-sm">
            Some prices have changed since you added items. Cart has been updated.
          </p>
        </div>
      )}

      {/* Out of Stock Warning */}
      {cart.has_out_of_stock && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
          <p className="text-red-300 text-sm">
            Some items in your cart are out of stock. Please remove them before proceeding.
          </p>
        </div>
      )}

      {/* Cart Items */}
      <div className="space-y-4 mb-8">
        {cart.items.map((item) => (
          <div
            key={item.product_id}
            className={`bg-gray-800 rounded-lg border p-4 flex items-center gap-4 ${
              !item.in_stock ? 'border-red-700/50 opacity-60' : 'border-gray-700'
            }`}
          >
            {/* Thumbnail */}
            <div className="w-16 h-16 bg-gray-700 rounded-lg overflow-hidden flex-shrink-0">
              {item.image_url ? (
                <Image src={item.image_url} alt={item.name} width={64} height={64} className="w-full h-full object-cover" unoptimized />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">
                  No img
                </div>
              )}
            </div>

            {/* Item Info */}
            <div className="flex-1 min-w-0">
              <Link
                href={`/shop/${slug}/product/${item.product_id}`}
                className="text-white font-medium hover:text-blue-400 transition-colors truncate block"
              >
                {item.name}
              </Link>
              <div className="text-sm text-gray-400 mt-0.5">
                {currencySymbol}{item.price.toFixed(2)} per {item.unit || 'pcs'}
                {item.price_changed && (
                  <span className="ml-2 text-amber-400 text-xs">Price updated</span>
                )}
              </div>
              {!item.in_stock && (
                <span className="text-xs text-red-400">Out of stock</span>
              )}
            </div>

            {/* Quantity Controls */}
            <div className="flex items-center border border-gray-700 rounded-lg">
              <button
                onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                disabled={updating === item.product_id || item.quantity <= 1}
                className="px-2.5 py-1.5 text-gray-400 hover:text-white transition-colors disabled:opacity-30"
              >
                -
              </button>
              <span className="px-3 py-1.5 text-white text-sm font-medium min-w-[2.5rem] text-center">
                {item.quantity}
              </span>
              <button
                onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                disabled={updating === item.product_id || item.quantity >= 10}
                className="px-2.5 py-1.5 text-gray-400 hover:text-white transition-colors disabled:opacity-30"
              >
                +
              </button>
            </div>

            {/* Line Total */}
            <div className="text-right min-w-[5rem]">
              <div className="text-white font-medium">
                {currencySymbol}{item.line_total.toFixed(2)}
              </div>
            </div>

            {/* Remove */}
            <button
              onClick={() => removeItem(item.product_id)}
              disabled={updating === item.product_id}
              className="text-gray-500 hover:text-red-400 transition-colors p-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Discount Code */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Discount code"
            value={discountCode}
            onChange={(e) => { setDiscountCode(e.target.value); setDiscountError(null); }}
            className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={applyDiscount}
            disabled={applyingDiscount || !discountCode.trim()}
            className="px-4 py-2 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            {applyingDiscount ? 'Applying...' : 'Apply'}
          </button>
        </div>
        {discountError && (
          <p className="text-red-400 text-xs mt-2">{discountError}</p>
        )}
        {cart.discount_code && cart.discount > 0 && (
          <p className="text-green-400 text-xs mt-2">
            Discount &quot;{cart.discount_code}&quot; applied: -{currencySymbol}{cart.discount.toFixed(2)}
          </p>
        )}
      </div>

      {/* Order Summary */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Order Summary</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between text-gray-300">
            <span>Subtotal ({cart.item_count} item{cart.item_count !== 1 ? 's' : ''})</span>
            <span>{currencySymbol}{cart.subtotal.toFixed(2)}</span>
          </div>
          {cart.discount > 0 && (
            <div className="flex justify-between text-green-400">
              <span>Discount</span>
              <span>-{currencySymbol}{cart.discount.toFixed(2)}</span>
            </div>
          )}
          <div className="border-t border-gray-700 pt-3 flex justify-between text-white font-semibold text-lg">
            <span>Total</span>
            <span>{currencySymbol}{cart.total.toFixed(2)}</span>
          </div>
        </div>

        <Link
          href={cart.has_out_of_stock ? '#' : `/shop/${slug}/checkout`}
          onClick={(e) => { if (cart.has_out_of_stock) e.preventDefault(); }}
          className={`block w-full mt-6 px-6 py-3 text-center text-white font-medium rounded-lg transition-colors ${
            cart.has_out_of_stock
              ? 'bg-gray-600 cursor-not-allowed opacity-50'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {cart.has_out_of_stock ? 'Remove Out of Stock Items' : 'Proceed to Checkout'}
        </Link>

        <Link
          href={`/shop/${slug}`}
          className="block text-center text-sm text-gray-400 hover:text-white mt-3 transition-colors"
        >
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
