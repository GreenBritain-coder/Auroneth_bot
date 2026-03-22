'use client';

import { useEffect, useState } from 'react';

interface BotCommission {
  botId: string;
  botName: string;
  owner?: string;
  totalCommission: number;
  orderCount: number;
  totalOrderAmount: number;
  commissionsByCurrency: Record<string, { commission: number; orderCount: number; totalAmount: number }>;
}

interface EarningsSummary {
  totalEarned: number;
  totalPendingPayout: number;
  availableForPayout: number;
  orderCount: number;
  pendingPayoutCount: number;
  isSuperAdmin?: boolean;
  commissionRate?: number; // Commission rate percentage (e.g., 2 for 2%)
  commissionsByBot?: BotCommission[]; // Per-bot commission breakdown (super-admin only)
  earningsByCurrency?: Record<string, { totalEarned: number; orderCount: number }>;
  pendingPayoutsByCurrency?: Record<string, number>;
  availableByCurrency?: Record<string, number>;
}

interface Payout {
  _id: string;
  userId?: string;
  ownerUsername?: string; // Bot owner's username (for super-admin view)
  amount: number;
  currency?: string; // Currency code (BTC, LTC, etc.)
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  walletAddress?: string;
  requestedAt: string;
  processedAt?: string;
  notes?: string;
}

function formatAmount(amount: number, currency?: string): string {
  const c = (currency || '').toUpperCase();
  if (c === 'GBP') return `£${amount.toFixed(2)}`;
  if (c === 'USD') return `$${amount.toFixed(2)}`;
  if (c === 'EUR') return `€${amount.toFixed(2)}`;
  return amount.toFixed(8);
}

export default function CommissionsPage() {
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('LTC'); // Default to LTC
  const [walletAddress, setWalletAddress] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [summaryRes, payoutsRes] = await Promise.all([
        fetch('/api/commissions'),
        fetch('/api/commissions/payouts'),
      ]);

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
      }

      if (payoutsRes.ok) {
        const payoutsData = await payoutsRes.json();
        setPayouts(payoutsData);
      }
    } catch (err) {
      setError('Failed to fetch commission data');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const payoutAmount = parseFloat(amount);
    if (!payoutAmount || payoutAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!walletAddress.trim()) {
      setError('Please enter a wallet address');
      return;
    }

    if (summary) {
      // Check balance for the selected currency
      const selectedCurrency = currency.toUpperCase();
      const availableForCurrency = summary.availableByCurrency?.[selectedCurrency] || 
        (selectedCurrency === 'BTC' ? summary.availableForPayout : 0);
      
      if (availableForCurrency <= 0) {
        setError(`No funds available for payout in ${selectedCurrency}. Current balance: ${availableForCurrency.toFixed(8)}`);
        return;
      }
      if (payoutAmount > availableForCurrency) {
        setError(`Amount exceeds available balance in ${selectedCurrency} (${availableForCurrency.toFixed(8)})`);
        return;
      }
    }

    try {
      setRequesting(true);
      const response = await fetch('/api/commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: payoutAmount,
          currency: currency,
          walletAddress: walletAddress.trim(),
        }),
      });

      if (response.ok) {
        setSuccess('Payout request submitted successfully!');
        setAmount('');
        setCurrency('LTC'); // Reset to default
        setWalletAddress('');
        fetchData(); // Refresh data
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to submit payout request');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setRequesting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'approved':
        return 'bg-blue-100 text-blue-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleProcessPayout = async (payoutId: string) => {
    const payoutEntry = payouts.find(p => p._id === payoutId);
    const payoutCurrency = payoutEntry?.currency || 'crypto';
    if (!confirm(`Process this payout? This will attempt to send ${payoutCurrency} to the wallet address.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/commissions/payouts/${payoutId}/process`, {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess('Payout processed successfully!');
        fetchData(); // Refresh data
      } else {
        setError(data.error || 'Failed to process payout');
        if (data.instructions) {
          alert(data.instructions.join('\n'));
        }
      }
    } catch (err) {
      setError('Network error. Please try again.');
    }
  };

  const handleDeletePayout = async (payoutId: string) => {
    if (!confirm('Delete this payout request? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/commissions/payouts/${payoutId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Payout deleted successfully!');
        fetchData(); // Refresh data
      } else {
        setError(data.error || 'Failed to delete payout');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    }
  };


  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {summary?.isSuperAdmin ? 'Platform Commissions' : 'Earnings & Payouts'}
      </h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      {/* Earnings Summary */}
      {summary && (
        <>
          {summary.isSuperAdmin && summary.commissionRate && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-blue-900">Commission Rate</div>
                  <div className="text-2xl font-bold text-blue-600">{summary.commissionRate}%</div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="text-sm text-gray-600 mb-1">
                {summary.isSuperAdmin ? 'Total Platform Commission' : 'Total Earned'}
              </div>
              <div className="text-2xl font-bold text-gray-900">
                {formatAmount(summary.totalEarned, Object.keys(summary.earningsByCurrency || {})[0])}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {summary.isSuperAdmin 
                  ? `Commission from ${summary.orderCount} paid order${summary.orderCount !== 1 ? 's' : ''}`
                  : `${summary.orderCount} paid order${summary.orderCount !== 1 ? 's' : ''}`
                }
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <div className="text-sm text-gray-600 mb-1">Pending Payouts</div>
              <div className="text-2xl font-bold text-yellow-600">
                {formatAmount(summary.totalPendingPayout, Object.keys(summary.earningsByCurrency || {})[0])}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {summary.pendingPayoutCount} request{summary.pendingPayoutCount !== 1 ? 's' : ''}
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <div className="text-sm text-gray-600 mb-1">Available for Payout</div>
              <div className="text-2xl font-bold text-green-600">
                {formatAmount(summary.availableForPayout, Object.keys(summary.earningsByCurrency || {})[0])}
              </div>
            </div>
          </div>

          {/* Per-Bot Commission Breakdown (Super-Admin Only) */}
          {summary.isSuperAdmin && summary.commissionsByBot && summary.commissionsByBot.length > 0 && (
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Commissions by Bot</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Bot Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Orders
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Order Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Commission
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {summary.commissionsByBot.map((bot) => (
                      <tr key={bot.botId}>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{bot.botName}</div>
                          {bot.owner && (
                            <div className="text-xs text-gray-500">Owner: {bot.owner.substring(0, 8)}...</div>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                          {bot.orderCount}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatAmount(bot.totalOrderAmount)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-indigo-600">
                          {formatAmount(bot.totalCommission)}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-500">
                          {Object.keys(bot.commissionsByCurrency).length > 0 && (
                            <div className="space-y-1">
                              {Object.entries(bot.commissionsByCurrency).map(([currency, data]) => (
                                <div key={currency} className="text-xs">
                                  <span className="font-medium">{currency}:</span> {formatAmount(data.commission, currency)} ({data.orderCount} orders)
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                        Total Commission:
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-indigo-600">
                        {formatAmount(summary.commissionsByBot.reduce((sum, bot) => sum + bot.totalCommission, 0))}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Per-Currency Breakdown */}
          {summary.earningsByCurrency && Object.keys(summary.earningsByCurrency).length > 0 && (
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Earnings by Currency</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(summary.earningsByCurrency).map(([currency, data]) => {
                  const pending = summary.pendingPayoutsByCurrency?.[currency] || 0;
                  const available = summary.availableByCurrency?.[currency] || 0;
                  return (
                    <div key={currency} className="border border-gray-200 rounded-lg p-4">
                      <div className="text-sm font-medium text-gray-700 mb-2">{currency}</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Earned:</span>
                          <span className="font-medium">{formatAmount(data.totalEarned, currency)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Pending:</span>
                          <span className="font-medium text-yellow-600">{formatAmount(pending, currency)}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                          <span className="text-gray-700 font-medium">Available:</span>
                          <span className="font-bold text-green-600">{formatAmount(available, currency)}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {data.orderCount} order{data.orderCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Request Payout Form - Only for bot owners */}
      {!summary?.isSuperAdmin && (
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Request Payout</h2>
        <form onSubmit={handleRequestPayout}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              >
                <option value="BTC">BTC (Bitcoin)</option>
                <option value="LTC">LTC (Litecoin)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount ({currency})
              </label>
              <input
                type="number"
                step="0.00000001"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00000000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
              {summary && (
                <div className="text-xs text-gray-500 mt-1">
                  Max: {(summary.availableByCurrency?.[currency.toUpperCase()] || 0).toFixed(8)} {currency}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Wallet Address
              </label>
              <input
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder={currency === "BTC" ? "bc1q..." : currency === "LTC" ? "ltc1q..." : "0x..."}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={requesting || !summary || summary.availableForPayout <= 0}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {requesting ? 'Submitting...' : 'Request Payout'}
          </button>
        </form>
      </div>
      )}

      {/* Payout History */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Payout History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Date
                </th>
                {summary?.isSuperAdmin && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Bot Owner
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Wallet Address
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Notes
                </th>
                {summary?.isSuperAdmin && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={summary?.isSuperAdmin ? 7 : 6} className="px-6 py-4 text-center text-gray-500">
                    No payout requests yet
                  </td>
                </tr>
              ) : (
                payouts.map((payout) => (
                  <tr key={payout._id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(payout.requestedAt).toLocaleDateString()}
                    </td>
                    {summary?.isSuperAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {payout.ownerUsername || payout.userId?.substring(0, 8) + '...'}
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatAmount(payout.amount, payout.currency)} {payout.currency || 'BTC'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 font-mono">
                      {payout.walletAddress || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                          payout.status
                        )}`}
                      >
                        {payout.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {payout.notes || '-'}
                    </td>
                    {summary?.isSuperAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                        {payout.status === 'approved' && (
                          <button
                            onClick={() => handleProcessPayout(payout._id)}
                            className="text-indigo-600 hover:text-indigo-900 font-medium"
                          >
                            Process Payout
                          </button>
                        )}
                        {payout.status === 'pending' && (
                          <button
                            onClick={() => handleDeletePayout(payout._id)}
                            className="text-red-600 hover:text-red-900 font-medium"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

