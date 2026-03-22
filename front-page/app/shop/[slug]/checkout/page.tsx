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

interface ShippingMethod {
  code: string;
  name: string;
  cost: number;
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
  shipping?: {
    method: string;
    cost: number;
  };
  tracking_url: string;
}

type CheckoutStep = 'address' | 'select' | 'paying' | 'confirmed';

interface AddressErrors {
  fullName?: string;
  street?: string;
  city?: string;
  postcode?: string;
  country?: string;
  shippingMethod?: string;
}

export default function CheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [cart, setCart] = useState<CartData | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [step, setStep] = useState<CheckoutStep>('address');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idempotencyKeyRef = useRef<string>('');

  // Address form state
  const [fullName, setFullName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');
  const [country, setCountry] = useState('United Kingdom');
  const [selectedShipping, setSelectedShipping] = useState<string>('STD');
  const [shippingCost, setShippingCost] = useState(0);
  const [addressErrors, setAddressErrors] = useState<AddressErrors>({});

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

  // Fetch cart, payment methods, shipping methods, and check for pending order
  useEffect(() => {
    const init = async () => {
      try {
        const [cartRes, methodsRes, shippingRes, pendingRes] = await Promise.all([
          fetch(`/api/shop/${slug}/cart?t=${Date.now()}`),
          fetch(`/api/shop/${slug}/payment-methods`),
          fetch(`/api/shop/${slug}/shipping-methods`),
          fetch(`/api/shop/${slug}/order/pending`),
        ]);

        // Check for pending order first - resume if found
        if (pendingRes.ok) {
          const pendingData = await pendingRes.json();
          if (pendingData.order && pendingData.order.payment?.address) {
            setCheckout(pendingData.order);
            setStep('paying');
            if (cartRes.ok) {
              const cartData = await cartRes.json();
              if (cartData.cart) setCart(cartData.cart);
            }
            if (methodsRes.ok) {
              const methodsData = await methodsRes.json();
              setMethods(methodsData.methods || []);
            }
            if (shippingRes.ok) {
              const shippingData = await shippingRes.json();
              setShippingMethods(shippingData.methods || []);
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

        if (shippingRes.ok) {
          const shippingData = await shippingRes.json();
          const methods = shippingData.methods || [];
          setShippingMethods(methods);
          // Set default shipping cost
          if (methods.length > 0) {
            const defaultMethod = methods.find((m: ShippingMethod) => m.code === 'STD') || methods[0];
            setSelectedShipping(defaultMethod.code);
            setShippingCost(defaultMethod.cost);
          }
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

  // Update shipping cost when method changes
  const handleShippingChange = (code: string) => {
    setSelectedShipping(code);
    const method = shippingMethods.find(m => m.code === code);
    setShippingCost(method?.cost || 0);
  };

  // Validate address form
  const validateAddress = (): boolean => {
    const errors: AddressErrors = {};
    if (!fullName.trim() || fullName.trim().length < 2) errors.fullName = 'Full name required (min 2 characters)';
    if (!street.trim() || street.trim().length < 5) errors.street = 'Street address required (min 5 characters)';
    if (!city.trim() || city.trim().length < 2) errors.city = 'City required (min 2 characters)';
    if (!postcode.trim() || postcode.trim().length < 3) errors.postcode = 'Postcode required (min 3 characters)';
    if (!country.trim()) errors.country = 'Country required';
    if (!selectedShipping) errors.shippingMethod = 'Please select a shipping method';
    setAddressErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleContinueToPayment = () => {
    if (validateAddress()) {
      setStep('select');
    }
  };

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
          shipping_address: {
            full_name: fullName.trim(),
            street: street.trim(),
            city: city.trim(),
            postcode: postcode.trim(),
            country: country.trim(),
          },
          shipping_method_code: selectedShipping,
        }),
      });

      const data = await res.json();

      if (res.status === 409 && data.order_token) {
        router.push(`/shop/${slug}/order/${data.order_token}`);
        return;
      }

      if (!res.ok) {
        setError(data.error || 'Checkout failed');
        const newKey = crypto.randomUUID();
        idempotencyKeyRef.current = newKey;
        sessionStorage.setItem(`checkout_idempotency_${slug}`, newKey);
        return;
      }

      setCheckout(data);
      setStep('paying');
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
  }, [selectedCoin, submitting, slug, router, fullName, street, city, postcode, country, selectedShipping]);

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
  const totalWithShipping = cart ? Math.round((cart.total + shippingCost) * 100) / 100 : 0;

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
                {checkout.shipping && checkout.shipping.cost > 0 && (
                  <div className="flex justify-between text-gray-400 text-xs">
                    <span>(includes {checkout.shipping.method}: {currencySymbol}{checkout.shipping.cost.toFixed(2)})</span>
                  </div>
                )}
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

  // Order summary component (used in address and select steps)
  const OrderSummary = () => (
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
        <div className="flex justify-between text-gray-300">
          <span>Shipping ({shippingMethods.find(m => m.code === selectedShipping)?.name || 'Standard'})</span>
          <span>{shippingCost === 0 ? 'Free' : `${currencySymbol}${shippingCost.toFixed(2)}`}</span>
        </div>
        <div className="border-t border-gray-700 pt-2 flex justify-between text-white font-semibold text-lg">
          <span>Total</span>
          <span>{currencySymbol}{totalWithShipping.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );

  // Step: Address form
  if (step === 'address') {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-white mb-6">Checkout</h1>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8 text-sm">
          <span className="px-3 py-1 bg-blue-600 text-white rounded-full font-medium">1. Address</span>
          <span className="text-gray-600">&#8594;</span>
          <span className="px-3 py-1 bg-gray-700 text-gray-400 rounded-full">2. Payment</span>
          <span className="text-gray-600">&#8594;</span>
          <span className="px-3 py-1 bg-gray-700 text-gray-400 rounded-full">3. Confirm</span>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Shipping Address Form */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Shipping Address</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); setAddressErrors(prev => ({ ...prev, fullName: undefined })); }}
                className={`w-full bg-gray-900 border ${addressErrors.fullName ? 'border-red-500' : 'border-gray-700'} rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                placeholder="John Smith"
              />
              {addressErrors.fullName && <p className="text-red-400 text-xs mt-1">{addressErrors.fullName}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Street Address</label>
              <input
                type="text"
                value={street}
                onChange={(e) => { setStreet(e.target.value); setAddressErrors(prev => ({ ...prev, street: undefined })); }}
                className={`w-full bg-gray-900 border ${addressErrors.street ? 'border-red-500' : 'border-gray-700'} rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                placeholder="123 High Street"
              />
              {addressErrors.street && <p className="text-red-400 text-xs mt-1">{addressErrors.street}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => { setCity(e.target.value); setAddressErrors(prev => ({ ...prev, city: undefined })); }}
                  className={`w-full bg-gray-900 border ${addressErrors.city ? 'border-red-500' : 'border-gray-700'} rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                  placeholder="London"
                />
                {addressErrors.city && <p className="text-red-400 text-xs mt-1">{addressErrors.city}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Postcode</label>
                <input
                  type="text"
                  value={postcode}
                  onChange={(e) => { setPostcode(e.target.value); setAddressErrors(prev => ({ ...prev, postcode: undefined })); }}
                  className={`w-full bg-gray-900 border ${addressErrors.postcode ? 'border-red-500' : 'border-gray-700'} rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                  placeholder="SW1A 1AA"
                />
                {addressErrors.postcode && <p className="text-red-400 text-xs mt-1">{addressErrors.postcode}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Country</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="United Kingdom">United Kingdom</option>
                <option value="Ireland">Ireland</option>
                <option value="France">France</option>
                <option value="Germany">Germany</option>
                <option value="Netherlands">Netherlands</option>
                <option value="Belgium">Belgium</option>
                <option value="Spain">Spain</option>
                <option value="Italy">Italy</option>
                <option value="Portugal">Portugal</option>
                <option value="Austria">Austria</option>
                <option value="Switzerland">Switzerland</option>
                <option value="Sweden">Sweden</option>
                <option value="Norway">Norway</option>
                <option value="Denmark">Denmark</option>
                <option value="Poland">Poland</option>
                <option value="Czech Republic">Czech Republic</option>
                <option value="United States">United States</option>
                <option value="Canada">Canada</option>
                <option value="Australia">Australia</option>
              </select>
            </div>
          </div>
        </div>

        {/* Shipping Method Selection */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Shipping Method</h3>
          {shippingMethods.length === 0 ? (
            <p className="text-gray-400 text-sm">Loading shipping methods...</p>
          ) : (
            <div className="space-y-3">
              {shippingMethods.map((method) => (
                <label
                  key={method.code}
                  className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedShipping === method.code
                      ? 'border-blue-500 bg-blue-900/20 ring-2 ring-blue-500/50'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="shipping"
                      value={method.code}
                      checked={selectedShipping === method.code}
                      onChange={() => handleShippingChange(method.code)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-white font-medium">{method.name}</span>
                  </div>
                  <span className="text-white font-semibold">
                    {method.cost === 0 ? 'Free' : `${currencySymbol}${method.cost.toFixed(2)}`}
                  </span>
                </label>
              ))}
            </div>
          )}
          {addressErrors.shippingMethod && <p className="text-red-400 text-xs mt-2">{addressErrors.shippingMethod}</p>}
        </div>

        {/* Order Summary */}
        <OrderSummary />

        {/* Continue Button */}
        <button
          onClick={handleContinueToPayment}
          className="w-full px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors text-lg"
        >
          Continue to Payment
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

  // Step: Select crypto
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Checkout</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8 text-sm">
        <span className="px-3 py-1 bg-green-700 text-white rounded-full font-medium">1. Address</span>
        <span className="text-gray-600">&#8594;</span>
        <span className="px-3 py-1 bg-blue-600 text-white rounded-full font-medium">2. Payment</span>
        <span className="text-gray-600">&#8594;</span>
        <span className="px-3 py-1 bg-gray-700 text-gray-400 rounded-full">3. Confirm</span>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Order Summary */}
      <OrderSummary />

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

      <button
        onClick={() => setStep('address')}
        className="block w-full text-center text-sm text-gray-400 hover:text-white mt-4 transition-colors"
      >
        Back to Shipping Details
      </button>
    </div>
  );
}
