'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Order {
  _id: string;
  botId: string;
  botName?: string;
  productId: string;
  productName?: string;
  userId: string;
  paymentStatus: string;
  amount: number;
  commission: number;
  currency?: string;
  timestamp: string;
  encrypted_address?: string;
  notes?: string;
  tracking_info?: string;
  source?: 'web' | 'telegram';
  order_number?: number;
  order_token?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  confirmed: 'bg-blue-100 text-blue-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-purple-100 text-purple-800',
  completed: 'bg-emerald-100 text-emerald-800',
  disputed: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-800',
};

const VENDOR_ACTIONS: Record<string, Array<{
  status: string;
  label: string;
  color: string;
  requiresInput?: string;
}>> = {
  pending: [
    { status: 'paid', label: 'Confirm Payment', color: 'bg-green-600 hover:bg-green-700 text-white' },
    { status: 'cancelled', label: 'Cancel', color: 'bg-red-600 hover:bg-red-700 text-white', requiresInput: 'cancellation_reason' },
  ],
  paid: [
    { status: 'confirmed', label: 'Confirm Order', color: 'bg-blue-600 hover:bg-blue-700 text-white' },
    { status: 'cancelled', label: 'Cancel', color: 'bg-red-600 hover:bg-red-700 text-white', requiresInput: 'cancellation_reason' },
    { status: 'refunded', label: 'Refund', color: 'bg-orange-600 hover:bg-orange-700 text-white', requiresInput: 'refund_txid' },
  ],
  confirmed: [
    { status: 'shipped', label: 'Mark Shipped', color: 'bg-indigo-600 hover:bg-indigo-700 text-white', requiresInput: 'tracking_info' },
    { status: 'cancelled', label: 'Cancel', color: 'bg-red-600 hover:bg-red-700 text-white', requiresInput: 'cancellation_reason' },
  ],
  shipped: [
    { status: 'delivered', label: 'Mark Delivered', color: 'bg-green-600 hover:bg-green-700 text-white' },
    { status: 'refunded', label: 'Refund', color: 'bg-orange-600 hover:bg-orange-700 text-white', requiresInput: 'refund_txid' },
  ],
  delivered: [],
  disputed: [
    { status: 'completed', label: 'Resolve', color: 'bg-green-600 hover:bg-green-700 text-white' },
    { status: 'refunded', label: 'Refund', color: 'bg-orange-600 hover:bg-orange-700 text-white', requiresInput: 'refund_txid' },
  ],
  cancelled: [],
  completed: [],
  expired: [],
  refunded: [],
  failed: [],
};

const FILTER_TABS = ['all', 'pending', 'paid', 'confirmed', 'shipped', 'delivered', 'completed', 'cancelled', 'expired'];

function formatAmount(amount: number | undefined, currency?: string): string {
  if (!amount) return '0.00';
  const s = amount.toFixed(8).replace(/\.?0+$/, '');
  if (currency && ['GBP', 'USD', 'EUR'].includes(currency.toUpperCase())) {
    const sym = currency === 'GBP' ? '\u00a3' : currency === 'EUR' ? '\u20ac' : '$';
    return `${sym}${Number(amount).toFixed(2)}`;
  }
  return s;
}

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedAction, setExpandedAction] = useState<{ orderId: string; action: any } | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [decryptedAddresses, setDecryptedAddresses] = useState<Record<string, string>>({});
  const [loadingAddresses, setLoadingAddresses] = useState<Record<string, boolean>>({});

  useEffect(() => { fetchOrders(); }, []);

  const fetchOrders = async () => {
    try {
      const response = await fetch('/api/orders');
      if (response.ok) {
        setOrders(await response.json());
      } else {
        setError('Failed to fetch orders');
      }
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  const handleStatusChange = async (orderId: string, newStatus: string, extra?: Record<string, string>) => {
    setActionLoading(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...extra }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setOrders(prev => prev.map(o =>
          o._id === orderId ? { ...o, paymentStatus: newStatus } : o
        ));
        setExpandedAction(null);
        setActionInput('');
      } else {
        alert(data.error || 'Failed to update status');
      }
    } catch { alert('Network error'); }
    finally { setActionLoading(null); }
  };

  const confirmPayment = async (orderId: string) => {
    if (!confirm('Mark this order as paid? Only do this if you have verified the payment.')) return;
    setActionLoading(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}/confirm`, { method: 'POST' });
      const data = await response.json();
      if (response.ok && data.success) {
        setOrders(prev => prev.map(o => o._id === orderId ? { ...o, paymentStatus: 'paid' } : o));
      } else { alert(data.error || 'Failed'); }
    } catch { alert('Network error'); }
    finally { setActionLoading(null); }
  };

  const decryptAddress = async (orderId: string) => {
    if (decryptedAddresses[orderId] || loadingAddresses[orderId]) return;
    setLoadingAddresses(prev => ({ ...prev, [orderId]: true }));
    try {
      const response = await fetch(`/api/orders/${orderId}/decrypt-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.address) {
          setDecryptedAddresses(prev => ({ ...prev, [orderId]: data.address }));
        }
      }
    } catch {}
    finally { setLoadingAddresses(prev => { const n = { ...prev }; delete n[orderId]; return n; }); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading orders...</div>;

  // Compute counts per status
  const counts: Record<string, number> = { all: orders.length };
  orders.forEach(o => {
    const s = o.paymentStatus || 'unknown';
    counts[s] = (counts[s] || 0) + 1;
  });

  const filtered = activeFilter === 'all'
    ? orders
    : orders.filter(o => o.paymentStatus === activeFilter);

  const totalRevenue = orders.filter(o => o.paymentStatus === 'paid' || o.paymentStatus === 'confirmed' || o.paymentStatus === 'shipped' || o.paymentStatus === 'delivered' || o.paymentStatus === 'completed')
    .reduce((s, o) => s + (o.amount || 0), 0);
  const totalCommission = orders.filter(o => o.paymentStatus === 'paid' || o.paymentStatus === 'confirmed' || o.paymentStatus === 'shipped' || o.paymentStatus === 'delivered' || o.paymentStatus === 'completed')
    .reduce((s, o) => s + (o.commission || 0), 0);

  const inputLabels: Record<string, { title: string; placeholder: string }> = {
    cancellation_reason: { title: 'Cancellation Reason', placeholder: 'Reason for cancellation' },
    refund_txid: { title: 'Refund TX Hash', placeholder: 'Blockchain transaction hash' },
    tracking_info: { title: 'Tracking Reference (internal)', placeholder: 'e.g. RM-AB123456789GB' },
  };

  return (
    <div className="w-full min-w-0">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Orders</h1>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-lg shadow-sm p-3 border border-gray-100">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Total Orders</div>
            <div className="text-xl font-bold text-gray-900 mt-1">{orders.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-3 border border-gray-100">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Needs Action</div>
            <div className="text-xl font-bold text-yellow-600 mt-1">{(counts['pending'] || 0) + (counts['paid'] || 0)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-3 border border-gray-100">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Revenue</div>
            <div className="text-xl font-bold text-gray-900 mt-1">{formatAmount(totalRevenue)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-3 border border-gray-100">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Commission</div>
            <div className="text-xl font-bold text-indigo-600 mt-1">{formatAmount(totalCommission)}</div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1 bg-white rounded-lg shadow-sm p-1 border border-gray-100">
          {FILTER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveFilter(tab)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeFilter === tab
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {(counts[tab] || 0) > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  activeFilter === tab ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  {counts[tab] || 0}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>
      )}

      {/* Order cards */}
      <div className="space-y-3">
        {filtered.map((order) => {
          const orderId = order._id && order._id !== 'undefined' && order._id !== 'null' ? order._id : null;
          if (!orderId) return null;
          const status = order.paymentStatus || 'unknown';
          const actions = VENDOR_ACTIONS[status] || [];
          const currency = (order as any).currency || '';
          const isExpanded = expandedAction?.orderId === orderId;

          return (
            <div key={orderId} className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
              {/* Row 1: ID, Bot, Date, Status */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-mono font-semibold text-gray-900">
                    {order.order_number ? `#${order.order_number}` : `#${orderId.substring(0, 8)}`}
                  </span>
                  {order.source === 'web' && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">WEB</span>
                  )}
                  <span className="text-gray-400">&middot;</span>
                  <span className="text-gray-600">{order.botName || 'Bot'}</span>
                  <span className="text-gray-400">&middot;</span>
                  <span className="text-gray-500">{order.timestamp ? new Date(order.timestamp).toLocaleDateString() : ''}</span>
                </div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}`}>
                  {status}
                </span>
              </div>

              {/* Row 2: User/Product + Amounts */}
              <div className="flex items-center justify-between text-sm mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">
                    {order.source === 'web' ? 'Web order' : <>User: <span className="font-mono text-gray-700">{order.userId || 'N/A'}</span></>}
                  </span>
                  {order.productName && (
                    <span className="text-gray-500 truncate max-w-[200px]">{order.productName}</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-gray-700">
                    <span className="text-gray-400 text-xs">Amount:</span>{' '}
                    <span className="font-semibold">{formatAmount(order.amount, currency)} {currency}</span>
                  </span>
                  <span className="text-gray-500">
                    <span className="text-gray-400 text-xs">Comm:</span>{' '}
                    <span className="font-medium">{formatAmount(order.commission, currency)} {currency}</span>
                  </span>
                </div>
              </div>

              {/* Row 3: Notes */}
              {order.notes && (
                <div className="text-xs text-gray-500 mb-3 bg-gray-50 rounded p-2">
                  Notes: {order.notes}
                </div>
              )}

              {/* Row 4: Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Status transition actions */}
                {status === 'pending' ? (
                  <>
                    <button
                      onClick={() => confirmPayment(orderId)}
                      disabled={actionLoading === orderId}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                    >
                      {actionLoading === orderId ? '...' : 'Confirm Payment'}
                    </button>
                    <button
                      onClick={() => {
                        setExpandedAction({ orderId, action: VENDOR_ACTIONS.pending[1] });
                        setActionInput('');
                      }}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  actions.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (action.requiresInput) {
                          setExpandedAction({ orderId, action });
                          setActionInput('');
                        } else {
                          if (confirm(`${action.label}?`)) {
                            handleStatusChange(orderId, action.status);
                          }
                        }
                      }}
                      disabled={actionLoading === orderId}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium ${action.color} disabled:opacity-50`}
                    >
                      {actionLoading === orderId ? '...' : action.label}
                    </button>
                  ))
                )}

                {/* Address */}
                {order.encrypted_address && (
                  decryptedAddresses[orderId] ? (
                    <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700 max-w-[200px] truncate">
                      {decryptedAddresses[orderId]}
                    </span>
                  ) : (
                    <button
                      onClick={() => decryptAddress(orderId)}
                      disabled={loadingAddresses[orderId]}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    >
                      {loadingAddresses[orderId] ? 'Decrypting...' : 'View Address'}
                    </button>
                  )
                )}

                {/* View detail */}
                <button
                  onClick={() => router.push(`/admin/orders/${orderId}`)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 ml-auto"
                >
                  View Details
                </button>
              </div>

              {/* Expanded input for actions requiring input */}
              {isExpanded && expandedAction && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-sm font-medium text-gray-700 mb-2">
                    {inputLabels[expandedAction.action.requiresInput]?.title || 'Input Required'}
                  </div>
                  <input
                    type="text"
                    value={actionInput}
                    onChange={(e) => setActionInput(e.target.value)}
                    placeholder={inputLabels[expandedAction.action.requiresInput]?.placeholder || ''}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 mb-2"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const key = expandedAction.action.requiresInput;
                        const extra: Record<string, string> = {};
                        if (key && actionInput) extra[key] = actionInput;
                        handleStatusChange(orderId, expandedAction.action.status, extra);
                      }}
                      disabled={actionLoading === orderId || (expandedAction.action.requiresInput !== 'tracking_info' && !actionInput)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium ${expandedAction.action.color} disabled:opacity-50`}
                    >
                      {actionLoading === orderId ? 'Processing...' : `Confirm ${expandedAction.action.label}`}
                    </button>
                    <button
                      onClick={() => { setExpandedAction(null); setActionInput(''); }}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm border border-gray-100">
          {activeFilter === 'all' ? 'No orders yet.' : `No ${activeFilter} orders.`}
        </div>
      )}
    </div>
  );
}
