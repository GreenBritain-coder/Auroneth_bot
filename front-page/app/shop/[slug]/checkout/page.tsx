'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface CartItem {
  product_id: string;
  name: string;
  price: number;
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
  has_out_of_stock: boolean;
}

interface PaymentMethod {
  currency: string;
  name: string;
  icon: string;
}

interface CheckoutResponse {
  order_token: string;
  status: string;
  payment: {
    address: string;
    amount: string;
    currency: string;
    qr_data: string;
    expires_at: string;
  };
  conversion: {
    display_amount: number;
    display_currency: string;
    fiat_amount: number;
    fiat_currency: string;
    rate_gbp_usd: number;
    rate_usd_crypto: number;
    locked_at: string;
    expires_at: string;
  };
  tracking_url: string;
}

type CheckoutStep = 'select' | 'paying' | 'confirmed';

export default function CheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [cart, setCart] = useState<CartData | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [step, setStep] = useState<CheckoutStep>('select');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idempotencyKeyRef = useRef<string>('');

  // Generate or restore idempotency key from sessionStorage
  useEffect(() => {
    const storageKey = `checkout_idempotency_${slug}`;
    const existing = sessionStorage.getItem(storageKey);
    if (existing) {
      idempotencyKeyRef.current = existing;
    } else {
      const newKey = crypto.randomUUID();
      idempotencyKeyRef.current = newKey;
      sessionStorage.setItem(storageKey, newKey);
    }
  }, [slug]);

  // Fetch cart, payment methods, and check for pending order on mount
  useEffect(() => {
    const init = async () => {
      try {
        const [cartRes, methodsRes, pendingRes] = await Promise.all([
          fetch(`/api/shop/${slug}/cart?t=${Date.now()}`),
          fetch(`/api/shop/${slug}/payment-methods`),
          fetch(`/api/shop/${slug}/order/pending`),
        ]);

        // Check for pending order first — resume if found
        if (pendingRes.ok) {
          const pendingData = await pendingRes.json();
          if (pendingData.order && pendingData.order.payment?.address) {
            setCheckout(pendingData.order);
            setStep('paying');
            // Still load cart for display
            if (cartRes.ok) {
              const cartData = await cartRes.json();
              if (cartData.cart) setCart(cartData.cart);
            }
            if (methodsRes.ok) {
              const methodsData = await methodsRes.json();
              setMethods(methodsData.methods || []);
            }
            setLoading(false);
            return;
          }
        }

        if (cartRes.ok) {
          const cartData = await cartRes.json();
          if (!cartData.cart || cartData.cart.items.length === 0) {
            router.replace(`/shop/${slug}/cart`);
            return;
          }
          if (cartData.cart.has_out_of_stock) {
            router.replace(`/shop/${slug}/cart`);
            return;
          }
          setCart(cartData.cart);
        } else {
          router.replace(`/shop/${slug}/cart`);
          return;
        }

        if (methodsRes.ok) {
          const methodsData = await methodsRes.json();
          setMethods(methodsData.methods || []);
        }
      } catch (err) {
        console.error('Init error:', err);
        setError('Failed to load checkout');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [slug, router]);

  // Countdown timer
  useEffect(() => {
    if (!checkout) return;
    const expiresAt = new Date(checkout.payment.expires_at).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0 && pollRef.current) {
        clearInterval(pollRef.current);
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [checkout]);

  // Poll for payment status
  useEffect(() => {
    if (!checkout || step !== 'paying') return;

    const poll = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/shop/${slug}/order/${checkout.order_token}/status`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'paid' || data.status === 'confirmed') {
            setStep('confirmed');
            clearInterval(poll);
          }
        }
      } catch {
        // Ignore poll errors
      }
    }, 5000);

    pollRef.current = poll;
    return () => clearInterval(poll);
  }, [checkout, step, slug]);

  const handleCheckout = useCallback(async () => {
    if (!selectedCoin || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/shop/${slug}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crypto_currency: selectedCoin,
          idempotency_key: idempotencyKeyRef.current,
        }),
      });

      const data = await res.json();

      if (res.status === 409 && data.order_token) {
        // Idempotency hit - redirect to existing order
        router.push(`/shop/${slug}/order/${data.order_token}`);
        return;
      }

      if (!res.ok) {
        setError(data.error || 'Checkout failed');
        // Generate new key for retry
        const newKey = crypto.randomUUID();
        idempotencyKeyRef.current = newKey;
        sessionStorage.setItem(`checkout_idempotency_${slug}`, newKey);
        return;
      }

      setCheckout(data);
      setStep('paying');
      // Clear idempotency key — next checkout will get a fresh one
      sessionStorage.removeItem(`checkout_idempotency_${slug}`);
    } catch (err) {
      console.error('Checkout error:', err);
      setError('Network error. Please try again.');
      const retryKey = crypto.randomUUID();
      idempotencyKeyRef.current = retryKey;
      sessionStorage.setItem(`checkout_idempotency_${slug}`, retryKey);
    } finally {
      setSubmitting(false);
    }
  }, [selectedCoin, submitting, slug, router]);

  const copyAddress = () => {
    if (checkout?.payment.address) {
      navigator.clipboard.writeText(checkout.payment.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const currencySymbol = cart?.currency === 'GBP' ? '\u00a3' : '$';

  if (loading) {
    return (
      <div className="text-center py-24">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
        <p className="mt-4 text-gray-400">Loading checkout...</p>
      </div>
    );
  }

  if (!cart) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="text-gray-400">Cart is empty.</p>
        <Link href={`/shop/${slug}`} className="text-blue-400 hover:underline mt-2 inline-block">
          Continue Shopping
        </Link>
      </div>
    );
  }

  // Step: Payment confirmed - auto-redirect to order tracking
  if (step === 'confirmed' && checkout) {
    router.replace(`/shop/${slug}/order/${checkout.order_token}`);
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Payment Received!</h1>
        <p className="text-gray-400 mb-4">Redirecting to your order...</p>
      </div>
    );
  }

  // Step: Paying - show payment details
  if (step === 'paying' && checkout) {
    const expired = countdown <= 0;

    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-white mb-6">Complete Payment</h1>

        {/* Rate lock timer */}
        <div className={`rounded-lg p-3 mb-6 text-center text-sm font-medium ${
          expired ? 'bg-red-900/30 border border-red-700 text-red-300' :
          countdown < 120 ? 'bg-amber-900/30 border border-amber-700 text-amber-300' :
          'bg-blue-900/30 border border-blue-700 text-blue-300'
        }`}>
          {expired ? 'Rate expired. Please go back and try again.' :
            `Rate locked for ${formatTime(countdown)}`}
        </div>

        {/* Conversion chain */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
          <p className="text-sm text-gray-400 mb-1">Conversion</p>
          <p className="text-white font-mono text-sm">
            {currencySymbol}{checkout.conversion.display_amount.toFixed(2)} GBP
            {' \u2192 '}
            ${checkout.conversion.fiat_amount.toFixed(2)} USD
            {' \u2192 '}
            {checkout.payment.amount} {checkout.payment.currency}
          </p>
        </div>

        {/* Payment details */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
          <div className="text-center mb-6">
            <p className="text-sm text-gray-400 mb-1">Send exactly</p>
            <p className="text-3xl font-bold text-white font-mono">
              {checkout.payment.amount} {checkout.payment.currency}
            </p>
          </div>

          {/* QR Code */}
          {checkout.payment.qr_data && (
            <div className="flex justify-center mb-6">
              <div className="bg-white p-4 rounded-lg">
                {/* Use a simple QR placeholder - rendered via img from QR API */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkout.payment.qr_data)}`}
                  alt="Payment QR Code"
                  width={200}
                  height={200}
                  className="block"
                />
              </div>
            </div>
          )}

          {/* Address */}
          <div className="mb-4">
            <p className="text-sm text-gray-400 mb-1">Payment Address</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-green-400 font-mono break-all">
                {checkout.payment.address}
              </code>
              <button
                onClick={copyAddress}
                className="px-3 py-2 bg-gray-700 text-white text-sm rounded hover:bg-gray-600 transition-colors flex-shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-500 text-center">
            Payment will be detected automatically. You can close this page and check back later.
          </p>
        </div>

        {/* Order summary (collapsed) */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Order Summary</h3>
          <div className="space-y-1 text-sm">
            {checkout.conversion && (
              <>
                <div className="flex justify-between text-gray-300">
                  <span>Total ({cart.currency})</span>
                  <span>{currencySymbol}{checkout.conversion.display_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-300">
                  <span>Total (USD)</span>
                  <span>${checkout.conversion.fiat_amount.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="text-center">
          <Link
            href={`/shop/${slug}/order/${checkout.order_token}`}
            className="text-blue-400 hover:underline text-sm"
          >
            Go to order tracking page
          </Link>
        </div>
      </div>
    );
  }

  // Step: Select crypto
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Checkout</h1>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Order Summary */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
        <h3 className="text-lg font-semibold text-white mb-4">Order Summary</h3>
        <div className="space-y-2 mb-4">
          {cart.items.map((item) => (
            <div key={item.product_id} className="flex justify-between text-sm text-gray-300">
              <span>{item.name} x{item.quantity}</span>
              <span>{currencySymbol}{item.line_total.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-700 pt-3 space-y-2 text-sm">
          <div className="flex justify-between text-gray-300">
            <span>Subtotal</span>
            <span>{currencySymbol}{cart.subtotal.toFixed(2)}</span>
          </div>
          {cart.discount > 0 && (
            <div className="flex justify-between text-green-400">
              <span>Discount</span>
              <span>-{currencySymbol}{cart.discount.toFixed(2)}</span>
            </div>
          )}
          <div className="border-t border-gray-700 pt-2 flex justify-between text-white font-semibold text-lg">
            <span>Total</span>
            <span>{currencySymbol}{cart.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Crypto Selector */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
        <h3 className="text-lg font-semibold text-white mb-4">Select Payment Method</h3>
        {methods.length === 0 ? (
          <p className="text-gray-400 text-sm">No payment methods available. Please try again later.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {methods.map((method) => (
              <button
                key={method.currency}
                onClick={() => setSelectedCoin(method.currency)}
                className={`p-4 rounded-lg border text-center transition-all ${
                  selectedCoin === method.currency
                    ? 'border-blue-500 bg-blue-900/30 text-white ring-2 ring-blue-500/50'
                    : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'
                }`}
              >
                <div className="font-bold text-lg">{method.currency}</div>
                <div className="text-xs text-gray-400 mt-1">{method.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pay Button */}
      <button
        onClick={handleCheckout}
        disabled={!selectedCoin || submitting || methods.length === 0}
        className="w-full px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-lg"
      >
        {submitting
          ? 'Creating payment...'
          : selectedCoin
          ? `Pay with ${selectedCoin}`
          : 'Select a cryptocurrency'}
      </button>

      <Link
        href={`/shop/${slug}/cart`}
        className="block text-center text-sm text-gray-400 hover:text-white mt-4 transition-colors"
      >
        Back to Cart
      </Link>
    </div>
  );
}
