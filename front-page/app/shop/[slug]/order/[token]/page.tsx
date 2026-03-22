'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface OrderItem {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  line_total: number;
  image_url?: string;
  unit?: string;
}

interface OrderData {
  order_token: string;
  status: string;
  items_snapshot: OrderItem[];
  display_amount: number;
  fiat_amount: number;
  crypto_currency: string;
  crypto_amount: number;
  exchange_rate_gbp_usd: number;
  exchange_rate_usd_crypto: number;
  commission: number;
  commission_rate: number;
  rate_locked_at: string;
  rate_lock_expires_at: string;
  payment_received: boolean;
  confirmations: number;
  payment_address: string | null;
  qr_data: string | null;
  shipping: { tracking_number?: string; carrier?: string; status?: string } | null;
  created_at: string;
  updated_at: string;
}

const STATUS_STEPS = [
  { key: 'pending', label: 'Pending Payment' },
  { key: 'paid', label: 'Paid' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'completed', label: 'Completed' },
];

const TERMINAL_STATUSES = ['completed', 'expired', 'cancelled'];

function getStepIndex(status: string): number {
  const idx = STATUS_STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : -1;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending':
    case 'pending_payment_setup':
      return 'text-amber-400';
    case 'paid':
    case 'confirmed':
      return 'text-blue-400';
    case 'shipped':
    case 'delivered':
    case 'completed':
      return 'text-green-400';
    case 'expired':
    case 'cancelled':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case 'pending':
    case 'pending_payment_setup':
      return 'bg-amber-900/30 border-amber-700 text-amber-300';
    case 'paid':
    case 'confirmed':
      return 'bg-blue-900/30 border-blue-700 text-blue-300';
    case 'shipped':
    case 'delivered':
    case 'completed':
      return 'bg-green-900/30 border-green-700 text-green-300';
    case 'expired':
    case 'cancelled':
      return 'bg-red-900/30 border-red-700 text-red-300';
    default:
      return 'bg-gray-900/30 border-gray-700 text-gray-300';
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending Payment';
    case 'pending_payment_setup':
      return 'Setting Up Payment';
    case 'paid':
      return 'Paid';
    case 'confirmed':
      return 'Confirmed';
    case 'shipped':
      return 'Shipped';
    case 'delivered':
      return 'Delivered';
    case 'completed':
      return 'Completed';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export default function OrderTrackingPage() {
  const params = useParams();
  const slug = params.slug as string;
  const token = params.token as string;

  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch full order on mount
  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/shop/${slug}/order/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Order not found');
          return;
        }
        const data = await res.json();
        setOrder(data.order);
      } catch {
        setError('Failed to load order');
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [slug, token]);

  // Poll for status updates every 10s when not in terminal state
  useEffect(() => {
    if (!order || TERMINAL_STATUSES.includes(order.status)) return;

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/shop/${slug}/order/${token}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status !== order.status) {
          // Status changed - refetch full order
          const fullRes = await fetch(`/api/shop/${slug}/order/${token}`);
          if (fullRes.ok) {
            const fullData = await fullRes.json();
            setOrder(fullData.order);
          }
        }
      } catch {
        // Ignore poll errors
      }
    }, 10000);

    pollRef.current = poll;
    return () => clearInterval(poll);
  }, [order?.status, slug, token]);

  const copyAddress = () => {
    if (order?.payment_address) {
      navigator.clipboard.writeText(order.payment_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-24">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
        <p className="mt-4 text-gray-400">Loading order...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Order Not Found</h1>
        <p className="text-gray-400 mb-6">{error || 'This order could not be found.'}</p>
        <Link href={`/shop/${slug}`} className="text-blue-400 hover:underline">
          Back to Shop
        </Link>
      </div>
    );
  }

  const currentStep = getStepIndex(order.status);
  const isTerminal = TERMINAL_STATUSES.includes(order.status);
  const isPending = order.status === 'pending' || order.status === 'pending_payment_setup';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Status Badge */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Order Status</h1>
        <span className={`px-4 py-2 rounded-lg border text-sm font-semibold ${getStatusBadgeClasses(order.status)}`}>
          {formatStatus(order.status)}
        </span>
      </div>

      {/* Status Timeline */}
      {order.status !== 'expired' && order.status !== 'cancelled' && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
          <div className="flex items-center justify-between">
            {STATUS_STEPS.map((step, i) => {
              const isActive = i <= currentStep;
              const isCurrent = i === currentStep;
              return (
                <div key={step.key} className="flex flex-col items-center flex-1">
                  <div className="flex items-center w-full">
                    {i > 0 && (
                      <div className={`flex-1 h-0.5 ${isActive ? 'bg-blue-500' : 'bg-gray-600'}`} />
                    )}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                        isCurrent
                          ? 'bg-blue-500 text-white ring-4 ring-blue-500/30'
                          : isActive
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-700 text-gray-400'
                      }`}
                    >
                      {isActive && i < currentStep ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`flex-1 h-0.5 ${i < currentStep ? 'bg-blue-500' : 'bg-gray-600'}`} />
                    )}
                  </div>
                  <span className={`text-xs mt-2 text-center ${isCurrent ? 'text-blue-400 font-medium' : isActive ? 'text-gray-300' : 'text-gray-500'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expired / Cancelled banner */}
      {(order.status === 'expired' || order.status === 'cancelled') && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-6 text-center">
          <p className="text-red-300 font-medium">
            {order.status === 'expired'
              ? 'This order has expired. The payment window has closed.'
              : 'This order has been cancelled.'}
          </p>
          <Link href={`/shop/${slug}`} className="text-blue-400 hover:underline text-sm mt-2 inline-block">
            Return to shop
          </Link>
        </div>
      )}

      {/* Payment Details (when pending) */}
      {isPending && order.payment_address && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Payment Details</h2>

          <div className="text-center mb-4">
            <p className="text-sm text-gray-400 mb-1">Send exactly</p>
            <p className="text-3xl font-bold text-white font-mono">
              {order.crypto_amount} {order.crypto_currency}
            </p>
          </div>

          {/* QR Code */}
          {order.qr_data && (
            <div className="flex justify-center mb-4">
              <div className="bg-white p-4 rounded-lg">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(order.qr_data)}`}
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
                {order.payment_address}
              </code>
              <button
                onClick={copyAddress}
                className="px-3 py-2 bg-gray-700 text-white text-sm rounded hover:bg-gray-600 transition-colors flex-shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Conversion chain */}
          <div className="bg-gray-900 rounded p-3 text-sm">
            <p className="text-gray-400 mb-1">Conversion</p>
            <p className="text-white font-mono text-sm">
              {'\u00a3'}{order.display_amount.toFixed(2)} GBP
              {' \u2192 '}
              ${order.fiat_amount.toFixed(2)} USD
              {' \u2192 '}
              {order.crypto_amount} {order.crypto_currency}
            </p>
          </div>

          <p className="text-xs text-gray-500 text-center mt-4">
            Payment will be detected automatically.
          </p>
        </div>
      )}

      {/* Pending payment setup */}
      {order.status === 'pending_payment_setup' && !order.payment_address && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mb-4"></div>
          <p className="text-gray-300">Setting up your payment. This may take a moment...</p>
        </div>
      )}

      {/* Payment received info */}
      {order.status === 'paid' && (
        <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 mb-6 text-center">
          <p className="text-blue-300 font-medium">Payment received, waiting for confirmations.</p>
          {order.confirmations > 0 && (
            <p className="text-blue-400 text-sm mt-1">{order.confirmations} confirmation{order.confirmations !== 1 ? 's' : ''}</p>
          )}
        </div>
      )}

      {/* Order Items */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Order Items</h2>
        <div className="space-y-3">
          {order.items_snapshot.map((item, i) => (
            <div key={i} className="flex items-center gap-4">
              {item.image_url && (
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="w-12 h-12 rounded object-cover bg-gray-700 flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{item.name}</p>
                <p className="text-gray-400 text-xs">
                  {'\u00a3'}{item.price.toFixed(2)} x {item.quantity}
                  {item.unit ? ` ${item.unit}` : ''}
                </p>
              </div>
              <p className="text-white text-sm font-medium flex-shrink-0">
                {'\u00a3'}{item.line_total.toFixed(2)}
              </p>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t border-gray-700 mt-4 pt-4 space-y-2 text-sm">
          <div className="flex justify-between text-gray-300">
            <span>Subtotal</span>
            <span>
              {'\u00a3'}
              {order.items_snapshot.reduce((sum, item) => sum + item.line_total, 0).toFixed(2)}
            </span>
          </div>
          {order.commission > 0 && (
            <div className="flex justify-between text-gray-300">
              <span>Service Fee ({(order.commission_rate * 100).toFixed(0)}%)</span>
              <span>{'\u00a3'}{order.commission.toFixed(2)}</span>
            </div>
          )}
          <div className="border-t border-gray-700 pt-2 flex justify-between text-white font-semibold">
            <span>Total</span>
            <span>{'\u00a3'}{order.display_amount.toFixed(2)}</span>
          </div>
          {order.crypto_currency && (
            <div className="flex justify-between text-gray-400 text-xs">
              <span>Paid in {order.crypto_currency}</span>
              <span>{order.crypto_amount} {order.crypto_currency}</span>
            </div>
          )}
        </div>
      </div>

      {/* Shipping Info */}
      {order.shipping && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Shipping Information</h2>
          {order.shipping.carrier && (
            <p className="text-gray-300 text-sm mb-1">
              <span className="text-gray-400">Carrier:</span> {order.shipping.carrier}
            </p>
          )}
          {order.shipping.tracking_number && (
            <p className="text-gray-300 text-sm mb-1">
              <span className="text-gray-400">Tracking:</span>{' '}
              <code className="text-green-400 font-mono">{order.shipping.tracking_number}</code>
            </p>
          )}
          {order.shipping.status && (
            <p className="text-gray-300 text-sm">
              <span className="text-gray-400">Status:</span> {order.shipping.status}
            </p>
          )}
        </div>
      )}

      {/* Bookmark prompt */}
      {!isTerminal && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 text-center">
          <p className="text-sm text-gray-400">
            Save this URL to check your order status later.
          </p>
        </div>
      )}

      {/* Back to shop */}
      <div className="text-center mt-6">
        <Link href={`/shop/${slug}`} className="text-blue-400 hover:underline text-sm">
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
