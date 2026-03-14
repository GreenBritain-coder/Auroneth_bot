'use client';

import { useEffect, useState } from 'react';

interface Order {
  _id: string;
  botId: string;
  botName?: string;
  productId: string;
  userId: string;
  paymentStatus: string;
  amount: number;
  commission: number;
  timestamp: string;
  encrypted_address?: string;
  notes?: string;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decryptedAddresses, setDecryptedAddresses] = useState<Record<string, string>>({});
  const [loadingAddresses, setLoadingAddresses] = useState<Record<string, boolean>>({});
  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({});
  const [secretPhraseInputs, setSecretPhraseInputs] = useState<Record<string, string>>({});
  const [showSecretPhraseInput, setShowSecretPhraseInput] = useState<Record<string, boolean>>({});
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const response = await fetch('/api/orders');
      if (response.ok) {
        const data = await response.json();
        setOrders(data);
      } else {
        setError('Failed to fetch orders');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const confirmPayment = async (orderId: string) => {
    if (!confirm('Mark this order as paid? Only do this if you have verified the payment.')) {
      return;
    }
    setConfirmingOrderId(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}/confirm`, { method: 'POST' });
      const data = await response.json();
      if (response.ok && data.success) {
        setOrders(prev =>
          prev.map(o => (o._id === orderId ? { ...o, paymentStatus: 'paid' } : o))
        );
      } else {
        alert(data.error || 'Failed to confirm order');
      }
    } catch (err) {
      alert('Network error');
    } finally {
      setConfirmingOrderId(null);
    }
  };

  const decryptAddress = async (orderId: string | null, secretPhrase?: string) => {
    if (!orderId || orderId === 'undefined' || orderId === 'null') {
      console.error('Cannot decrypt address: invalid order ID', orderId);
      return;
    }

    if (decryptedAddresses[orderId] || loadingAddresses[orderId]) {
      return; // Already decrypted or loading
    }

    console.log('Decrypting address for order:', orderId);
    setLoadingAddresses(prev => ({ ...prev, [orderId]: true }));

    try {
      const response = await fetch(`/api/orders/${orderId}/decrypt-address`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secretPhrase }),
      });
      
      console.log('Decrypt response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.address) {
          setDecryptedAddresses(prev => ({ ...prev, [orderId]: data.address }));
          // Clear any previous errors and hide secret phrase input
          setAddressErrors(prev => {
            const newErrors = { ...prev };
            delete newErrors[orderId];
            return newErrors;
          });
          setShowSecretPhraseInput(prev => {
            const newState = { ...prev };
            delete newState[orderId];
            return newState;
          });
          setSecretPhraseInputs(prev => {
            const newState = { ...prev };
            delete newState[orderId];
            return newState;
          });
        } else {
          setAddressErrors(prev => ({ ...prev, [orderId]: data.message || 'No address available' }));
        }
      } else {
        const errorData = await response.json();
        const errorMessage = errorData.error || 'Failed to decrypt';
        const isSecretPhraseMismatch = errorData.errorCode === 'SECRET_PHRASE_MISMATCH' || 
                                       errorMessage.includes('different secret phrase');
        
        setAddressErrors(prev => ({ ...prev, [orderId]: errorMessage }));
        // Show secret phrase input if it's a mismatch error
        if (isSecretPhraseMismatch && !secretPhrase) {
          setShowSecretPhraseInput(prev => ({ ...prev, [orderId]: true }));
        }
        // Clear from decrypted addresses if it was there
        setDecryptedAddresses(prev => {
          const newAddrs = { ...prev };
          delete newAddrs[orderId];
          return newAddrs;
        });
      }
    } catch (err) {
      setAddressErrors(prev => ({ ...prev, [orderId]: 'Error decrypting address' }));
    } finally {
      setLoadingAddresses(prev => {
        const newState = { ...prev };
        delete newState[orderId];
        return newState;
      });
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  const totalCommission = orders
    .filter((o) => o.paymentStatus === 'paid')
    .reduce((sum, o) => sum + o.commission, 0);

  return (
    <div className="w-full min-w-0">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Orders & Commissions</h1>
        <div className="bg-indigo-50 px-4 py-2 rounded-md">
          <span className="text-sm text-gray-600">Total Commission:</span>
          <span className="ml-2 font-bold text-indigo-700">{totalCommission.toFixed(8)}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white shadow rounded-md overflow-x-auto">
        <table className="min-w-full min-w-[1100px] divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Bot
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Commission
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Address
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Notes
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders
                .map((order, index) => {
                  // Safely handle _id - convert to string if it's an object, handle undefined
                  let orderId: string | null = null;
                  
                  if (order._id) {
                    if (typeof order._id === 'string') {
                      // Check if it's actually a valid ID (not "undefined" string)
                      if (order._id !== 'undefined' && order._id !== 'null' && order._id.trim() !== '') {
                        orderId = order._id;
                      }
                    } else {
                      // It's an object (ObjectId), convert to string
                      const idStr = String(order._id);
                      if (idStr !== 'undefined' && idStr !== 'null' && idStr.trim() !== '') {
                        orderId = idStr;
                      }
                    }
                  }
                  
                  const displayId = orderId 
                    ? `${orderId.substring(0, 8)}...` 
                    : `Order ${index + 1}`;
                  
                  // Ensure unique key - use orderId if available, otherwise use index
                  // Never use "undefined" as a key
                  const uniqueKey = orderId ? `order-${orderId}` : `order-index-${index}`;
                  
                  return { order, orderId, displayId, uniqueKey, index };
                })
                .map(({ order, orderId, displayId, uniqueKey }) => (
                  <tr key={uniqueKey}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                      {displayId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {order.botName || order.botId || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {order.userId || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {order.amount ? order.amount.toFixed(8) : '0.00000000'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {order.commission ? order.commission.toFixed(8) : '0.00000000'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                          order.paymentStatus || 'unknown'
                        )}`}
                      >
                        {order.paymentStatus || 'unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {order.timestamp ? new Date(order.timestamp).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {order.encrypted_address && orderId ? (
                        <div>
                          {decryptedAddresses[orderId] ? (
                            <div className="max-w-xs">
                              <div className="text-xs text-gray-400 mb-1">Decrypted:</div>
                              <div className="font-mono text-xs bg-gray-50 p-2 rounded break-words">
                                {decryptedAddresses[orderId]}
                              </div>
                              <div className="text-xs text-gray-400 mt-1">
                                (Order ID: {orderId.substring(0, 8)}...)
                              </div>
                            </div>
                          ) : addressErrors[orderId] ? (
                            <div className="max-w-xs">
                              <div className="text-xs text-red-600 mb-1">⚠️ Decryption Failed:</div>
                              <div className="text-xs bg-red-50 border border-red-200 text-red-700 p-2 rounded break-words">
                                {addressErrors[orderId].includes('different secret phrase') || addressErrors[orderId].includes('SECRET_PHRASE_MISMATCH') ? (
                                  <div>
                                    <div className="font-semibold mb-1">Secret Phrase Changed</div>
                                    <div className="text-xs mb-2">
                                      The user changed their secret phrase after creating this order. 
                                      The address was encrypted with their old secret phrase and cannot be decrypted with the current one.
                                    </div>
                                  </div>
                                ) : (
                                  addressErrors[orderId]
                                )}
                              </div>
                              {showSecretPhraseInput[orderId] && (
                                <div className="mt-2">
                                  <label className="block text-xs text-gray-700 mb-1">
                                    Enter old secret phrase:
                                  </label>
                                  <input
                                    type="password"
                                    value={secretPhraseInputs[orderId] || ''}
                                    onChange={(e) => setSecretPhraseInputs(prev => ({ ...prev, [orderId]: e.target.value }))}
                                    placeholder="Enter secret phrase used when order was created"
                                    className="text-xs w-full px-2 py-1 border border-gray-300 rounded mb-1"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                        if (orderId && secretPhraseInputs[orderId]) {
                                          decryptAddress(orderId, secretPhraseInputs[orderId]);
                                        }
                                      }}
                                      disabled={!secretPhraseInputs[orderId] || loadingAddresses[orderId]}
                                      className="text-xs text-indigo-600 hover:text-indigo-900 font-medium disabled:opacity-50"
                                    >
                                      Decrypt with Phrase
                                    </button>
                                    <button
                                      onClick={() => {
                                        setShowSecretPhraseInput(prev => {
                                          const newState = { ...prev };
                                          delete newState[orderId];
                                          return newState;
                                        });
                                        setSecretPhraseInputs(prev => {
                                          const newState = { ...prev };
                                          delete newState[orderId];
                                          return newState;
                                        });
                                      }}
                                      className="text-xs text-gray-600 hover:text-gray-900"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                              {!showSecretPhraseInput[orderId] && (
                                <div className="flex gap-2 mt-1">
                                  <button
                                    onClick={() => {
                                      if (orderId && orderId !== 'undefined' && orderId !== 'null') {
                                        // Show secret phrase input
                                        setShowSecretPhraseInput(prev => ({ ...prev, [orderId]: true }));
                                      }
                                    }}
                                    className="text-xs text-indigo-600 hover:text-indigo-900 underline"
                                  >
                                    Enter Secret Phrase
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (orderId && orderId !== 'undefined' && orderId !== 'null') {
                                        // Clear error and retry with current phrase
                                        setAddressErrors(prev => {
                                          const newErrors = { ...prev };
                                          delete newErrors[orderId];
                                          return newErrors;
                                        });
                                        decryptAddress(orderId);
                                      }
                                    }}
                                    className="text-xs text-indigo-600 hover:text-indigo-900 underline"
                                  >
                                    Retry
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                if (orderId && orderId !== 'undefined' && orderId !== 'null') {
                                  console.log('Decrypting address for order:', orderId, 'timestamp:', order.timestamp);
                                  decryptAddress(orderId);
                                } else {
                                  console.error('Invalid order ID:', orderId);
                                }
                              }}
                              disabled={loadingAddresses[orderId] || !orderId}
                              className="text-indigo-600 hover:text-indigo-900 text-xs font-medium disabled:opacity-50"
                            >
                              {loadingAddresses[orderId] ? 'Decrypting...' : '🔓 View Address'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">No address</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {order.notes ? (
                        <div className="max-w-xs">
                          <div className="text-xs text-gray-400 mb-1">📝</div>
                          <div className="text-xs bg-gray-50 p-2 rounded break-words">
                            {order.notes}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {orderId && (order.paymentStatus || '').toLowerCase() !== 'paid' ? (
                        <button
                          onClick={() => confirmPayment(orderId)}
                          disabled={confirmingOrderId === orderId}
                          className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          {confirmingOrderId === orderId ? 'Confirming...' : 'Confirm payment'}
                        </button>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
      </div>

      {orders.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">No orders found.</div>
      )}
    </div>
  );
}

