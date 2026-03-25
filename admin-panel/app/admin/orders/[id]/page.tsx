'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface StatusHistoryEntry {
  from_status: string | null;
  to_status: string;
  changed_by: string;
  changed_at: string;
  note?: string;
}

interface OrderDetail {
  _id: string;
  botId: string;
  botName?: string;
  productId: string;
  userId: string;
  paymentStatus: string;
  amount: number;
  commission: number;
  currency?: string;
  timestamp: string;
  encrypted_address?: string;
  source?: string;
  items?: Array<{ product_id: string; product_name?: string; variation_index?: number; quantity: number; price: number }>;
  delivery_method?: string;
  shipping_cost?: number;
  tracking_info?: string;
  cancellation_reason?: string;
  cancelled_by?: string;
  dispute_reason?: string;
  refund_txid?: string;
  status_history?: StatusHistoryEntry[];
  paid_at?: string;
  confirmed_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  completed_at?: string;
  disputed_at?: string;
  expired_at?: string;
  cancelled_at?: string;
  refunded_at?: string;
}

// Allowed transitions for vendors from admin panel
const VENDOR_TRANSITIONS: Record<string, Array<{ status: string; label: string; color: string; requiresInput?: string }>> = {
  pending: [
    { status: 'paid', label: 'Confirm Payment', color: 'bg-green-600 hover:bg-green-700' },
    { status: 'cancelled', label: 'Cancel Order', color: 'bg-red-600 hover:bg-red-700', requiresInput: 'cancellation_reason' },
  ],
  paid: [
    { status: 'confirmed', label: 'Confirm Order', color: 'bg-blue-600 hover:bg-blue-700' },
    { status: 'cancelled', label: 'Cancel Order', color: 'bg-red-600 hover:bg-red-700', requiresInput: 'cancellation_reason' },
    { status: 'refunded', label: 'Refund', color: 'bg-orange-600 hover:bg-orange-700', requiresInput: 'refund_txid' },
  ],
  confirmed: [
    { status: 'shipped', label: 'Mark Shipped', color: 'bg-indigo-600 hover:bg-indigo-700', requiresInput: 'tracking_info' },
    { status: 'cancelled', label: 'Cancel Order', color: 'bg-red-600 hover:bg-red-700', requiresInput: 'cancellation_reason' },
    { status: 'refunded', label: 'Refund', color: 'bg-orange-600 hover:bg-orange-700', requiresInput: 'refund_txid' },
  ],
  shipped: [
    { status: 'delivered', label: 'Mark Delivered', color: 'bg-green-600 hover:bg-green-700' },
    { status: 'refunded', label: 'Refund', color: 'bg-orange-600 hover:bg-orange-700', requiresInput: 'refund_txid' },
  ],
  delivered: [],
  disputed: [
    { status: 'completed', label: 'Resolve (Complete)', color: 'bg-green-600 hover:bg-green-700' },
    { status: 'refunded', label: 'Refund', color: 'bg-orange-600 hover:bg-orange-700', requiresInput: 'refund_txid' },
  ],
  cancelled: [
    { status: 'refunded', label: 'Refund', color: 'bg-orange-600 hover:bg-orange-700', requiresInput: 'refund_txid' },
  ],
  completed: [],
  expired: [],
  refunded: [],
  failed: [],
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  confirmed: 'bg-blue-100 text-blue-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  disputed: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-800',
};

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Address decryption state
  const [decryptedAddress, setDecryptedAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  // Modal state for actions requiring input
  const [showModal, setShowModal] = useState(false);
  const [modalAction, setModalAction] = useState<{ status: string; label: string; requiresInput?: string } | null>(null);
  const [modalInput, setModalInput] = useState('');
  const [modalNote, setModalNote] = useState('');

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  const fetchOrder = async () => {
    try {
      setLoading(true);
      // Fetch from orders list API and find by ID
      const response = await fetch('/api/orders');
      if (response.ok) {
        const orders = await response.json();
        const found = orders.find((o: any) => String(o._id) === orderId);
        if (found) {
          setOrder(found);
        } else {
          setError('Order not found');
        }
      } else {
        setError('Failed to fetch order');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDecryptAddress = async () => {
    setAddressLoading(true);
    setAddressError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/decrypt-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setDecryptedAddress(data.address);
      } else {
        setAddressError(data.error || 'Failed to decrypt address');
      }
    } catch (err) {
      setAddressError('Network error');
    } finally {
      setAddressLoading(false);
    }
  };

  const handleAction = async (targetStatus: string, requiresInput?: string) => {
    if (requiresInput) {
      setModalAction({ status: targetStatus, label: targetStatus, requiresInput });
      setModalInput('');
      setModalNote('');
      setShowModal(true);
      return;
    }

    await executeTransition(targetStatus);
  };

  const executeTransition = async (targetStatus: string, extraFields?: Record<string, string>) => {
    setActionLoading(true);
    setError('');

    try {
      const body: Record<string, any> = {
        status: targetStatus,
        note: modalNote || undefined,
        ...extraFields,
      };

      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setShowModal(false);
        setModalAction(null);
        // Refresh order data
        await fetchOrder();
      } else {
        setError(data.error || 'Failed to update status');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleModalSubmit = () => {
    if (!modalAction) return;

    const extraFields: Record<string, string> = {};
    if (modalAction.requiresInput) {
      if (modalAction.requiresInput === 'tracking_info') {
        // Tracking info is optional for shipped
        if (modalInput.trim()) {
          extraFields.tracking_info = modalInput.trim();
        }
      } else if (modalAction.requiresInput === 'cancellation_reason') {
        if (!modalInput.trim()) {
          setError('Cancellation reason is required');
          return;
        }
        extraFields.cancellation_reason = modalInput.trim();
      } else if (modalAction.requiresInput === 'refund_txid') {
        if (!modalInput.trim()) {
          setError('Refund transaction hash is required');
          return;
        }
        extraFields.refund_txid = modalInput.trim();
      }
    }

    executeTransition(modalAction.status, extraFields);
  };

  if (loading) {
    return <div className="text-center py-8">Loading order...</div>;
  }

  if (!order) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">{error || 'Order not found'}</p>
        <button
          onClick={() => router.push('/admin/orders')}
          className="text-indigo-600 hover:text-indigo-800"
        >
          Back to Orders
        </button>
      </div>
    );
  }

  const actions = VENDOR_TRANSITIONS[order.paymentStatus] || [];
  const statusColor = STATUS_COLORS[order.paymentStatus] || 'bg-gray-100 text-gray-800';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => router.push('/admin/orders')}
            className="text-sm text-indigo-600 hover:text-indigo-800 mb-2 inline-block"
          >
            &larr; Back to Orders
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            Order #{orderId.substring(0, 8)}...
          </h1>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusColor}`}>
          {order.paymentStatus}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
          <button onClick={() => setError('')} className="float-right text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Order Info */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Order Details</h2>
          <dl className="space-y-3">
            <div>
              <dt className="text-sm text-gray-500">Order ID</dt>
              <dd className="font-mono text-sm">{orderId}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">User ID</dt>
              <dd className="font-mono text-sm">{order.userId}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Amount</dt>
              <dd className="text-sm font-medium">
                £{Number(order.amount).toFixed(2)}
                {order.currency && !['GBP','USD','EUR'].includes(order.currency.toUpperCase()) && (
                  <span className="ml-1 text-xs text-gray-400">via {order.currency}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Commission</dt>
              <dd className="text-sm">£{Number(order.commission).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Created</dt>
              <dd className="text-sm">{order.timestamp ? new Date(order.timestamp).toLocaleString() : 'N/A'}</dd>
            </div>
            {order.delivery_method && (
              <div>
                <dt className="text-sm text-gray-500">Delivery Method</dt>
                <dd className="text-sm">{order.delivery_method} {order.shipping_cost ? `(+£${order.shipping_cost.toFixed(2)})` : ''}</dd>
              </div>
            )}
            {order.tracking_info && (
              <div>
                <dt className="text-sm text-gray-500">Tracking</dt>
                <dd className="text-sm font-mono bg-gray-50 p-2 rounded">{order.tracking_info}</dd>
              </div>
            )}
            {order.cancellation_reason && (
              <div>
                <dt className="text-sm text-gray-500">Cancellation Reason</dt>
                <dd className="text-sm text-red-700">{order.cancellation_reason}</dd>
              </div>
            )}
            {order.dispute_reason && (
              <div>
                <dt className="text-sm text-gray-500">Dispute Reason</dt>
                <dd className="text-sm text-red-700">{order.dispute_reason}</dd>
              </div>
            )}
            {order.refund_txid && (
              <div>
                <dt className="text-sm text-gray-500">Refund TX</dt>
                <dd className="font-mono text-xs bg-gray-50 p-2 rounded break-all">{order.refund_txid}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Actions + Shipping Address */}
        <div className="space-y-6">
          {/* Shipping Address */}
          {order.encrypted_address && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Shipping Address</h2>
              {decryptedAddress ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <pre className="text-sm text-gray-900 whitespace-pre-wrap font-sans">{decryptedAddress}</pre>
                  <button
                    onClick={() => setDecryptedAddress(null)}
                    className="mt-3 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Hide address
                  </button>
                </div>
              ) : (
                <div>
                  {addressError && (
                    <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 rounded mb-3">
                      {addressError}
                    </div>
                  )}
                  <button
                    onClick={handleDecryptAddress}
                    disabled={addressLoading}
                    className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {addressLoading ? 'Decrypting...' : 'View Shipping Address'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            {actions.length > 0 ? (
              <div className="space-y-3">
                {actions.map((action) => (
                  <button
                    key={action.status}
                    onClick={() => handleAction(action.status, action.requiresInput)}
                    disabled={actionLoading}
                    className={`w-full px-4 py-2 rounded-md text-white font-medium ${action.color} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {actionLoading ? 'Processing...' : action.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No actions available for this status.</p>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white shadow rounded-lg p-6 mt-6">
        <h2 className="text-lg font-semibold mb-4">Timeline</h2>
        {order.status_history && order.status_history.length > 0 ? (
          <div className="space-y-4">
            {order.status_history.map((entry, idx) => (
              <div key={idx} className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-indigo-500"></div>
                <div>
                  <div className="text-sm text-gray-900">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[entry.to_status] || 'bg-gray-100 text-gray-800'}`}>
                      {entry.to_status}
                    </span>
                    {entry.from_status && (
                      <span className="text-gray-500 ml-2 text-xs">from {entry.from_status}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {entry.changed_at ? new Date(entry.changed_at).toLocaleString() : 'N/A'}
                    {entry.changed_by && <span className="ml-2">by {entry.changed_by}</span>}
                  </div>
                  {entry.note && (
                    <div className="text-xs text-gray-600 mt-1 italic">{entry.note}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2 text-sm text-gray-500">
            <div>Order created: {order.timestamp ? new Date(order.timestamp).toLocaleString() : 'N/A'}</div>
            {order.paid_at && <div>Payment confirmed: {new Date(order.paid_at).toLocaleString()}</div>}
            {order.confirmed_at && <div>Order confirmed: {new Date(order.confirmed_at).toLocaleString()}</div>}
            {order.shipped_at && <div>Shipped: {new Date(order.shipped_at).toLocaleString()}</div>}
            {order.delivered_at && <div>Delivered: {new Date(order.delivered_at).toLocaleString()}</div>}
            {order.completed_at && <div>Completed: {new Date(order.completed_at).toLocaleString()}</div>}
            <p className="text-xs text-gray-400 mt-2">Detailed timeline will be available for new orders.</p>
          </div>
        )}
      </div>

      {/* Items */}
      {order.items && order.items.length > 0 && (
        <div className="bg-white shadow rounded-lg p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4">Items</h2>
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2">Product</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2">Qty</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {order.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="py-2 text-sm">{item.product_name || <span className="font-mono text-gray-400">{item.product_id?.substring(0, 12)}...</span>}</td>
                  <td className="py-2 text-sm">{item.quantity}</td>
                  <td className="py-2 text-sm">{item.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal for actions requiring input */}
      {showModal && modalAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {modalAction.requiresInput === 'tracking_info' && 'Mark as Shipped'}
              {modalAction.requiresInput === 'cancellation_reason' && 'Cancel Order'}
              {modalAction.requiresInput === 'refund_txid' && 'Issue Refund'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {modalAction.requiresInput === 'tracking_info' && 'Tracking Info (optional)'}
                  {modalAction.requiresInput === 'cancellation_reason' && 'Cancellation Reason (required)'}
                  {modalAction.requiresInput === 'refund_txid' && 'Refund Transaction Hash (required)'}
                </label>
                <input
                  type="text"
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  placeholder={
                    modalAction.requiresInput === 'tracking_info'
                      ? 'e.g. Royal Mail - AB123456789GB'
                      : modalAction.requiresInput === 'cancellation_reason'
                      ? 'Reason for cancellation'
                      : 'Blockchain transaction hash'
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={modalNote}
                  onChange={(e) => setModalNote(e.target.value)}
                  placeholder="Internal note for the timeline"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => { setShowModal(false); setModalAction(null); setError(''); }}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleModalSubmit}
                disabled={actionLoading}
                className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
