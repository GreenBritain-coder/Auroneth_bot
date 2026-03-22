'use client';

import { useState } from 'react';

interface DeployStep {
  step: string;
  status: string;
  detail?: string;
}

interface DeployResult {
  success: boolean;
  summary?: {
    vendorName: string;
    vendorNum: number;
    botId: string;
    appUuid: string;
    appName: string;
    domain: string;
    fqdn: string;
  };
  steps: DeployStep[];
  error?: string;
}

const STATUS_STYLES: Record<string, string> = {
  done: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-gray-100 text-gray-800',
};

export default function DeployVendorPage() {
  const [botToken, setBotToken] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState('');

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setDeploying(true);

    try {
      const res = await fetch('/api/deploy-vendor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken, vendorName }),
      });

      const data: DeployResult = await res.json();
      setResult(data);

      if (!res.ok) {
        setError(data.error || 'Deployment failed');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setDeploying(false);
    }
  };

  const handleReset = () => {
    setBotToken('');
    setVendorName('');
    setResult(null);
    setError('');
  };

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Deploy New Vendor</h2>
        <p className="mt-1 text-sm text-gray-600">
          Provision a new bot vendor end-to-end: MongoDB record, Coolify app, env vars, deploy, and webhook.
        </p>
      </div>

      {/* Deploy Form */}
      {!result && (
        <div className="bg-white shadow rounded-lg p-6 max-w-lg">
          <form onSubmit={handleDeploy} className="space-y-4">
            <div>
              <label htmlFor="botToken" className="block text-sm font-medium text-gray-700">
                Bot Token
              </label>
              <input
                id="botToken"
                type="text"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                required
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-500">Get this from @BotFather on Telegram</p>
            </div>

            <div>
              <label htmlFor="vendorName" className="block text-sm font-medium text-gray-700">
                Vendor Name
              </label>
              <input
                id="vendorName"
                type="text"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="Cannabis Kings"
                required
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {error && !result && (
              <div className="rounded-md bg-red-50 p-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={deploying}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deploying ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Deploying...
                </span>
              ) : (
                'Deploy Vendor'
              )}
            </button>
          </form>
        </div>
      )}

      {/* Deployment Progress / Result */}
      {result && (
        <div className="space-y-6 max-w-2xl">
          {/* Steps */}
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {result.success ? 'Deployment Complete' : 'Deployment Failed'}
              </h3>
            </div>
            <ul className="divide-y divide-gray-200">
              {result.steps.map((step, i) => (
                <li key={i} className="px-6 py-3 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-500 w-5">{i + 1}.</span>
                    <span className="text-sm font-medium text-gray-900">{step.step}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    {step.detail && (
                      <span className="text-xs text-gray-500 max-w-xs truncate">{step.detail}</span>
                    )}
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        STATUS_STYLES[step.status] || STATUS_STYLES.pending
                      }`}
                    >
                      {step.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Summary Card */}
          {result.success && result.summary && (
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Vendor Summary</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase">Vendor</dt>
                  <dd className="text-sm text-gray-900">
                    {result.summary.vendorName} (#{result.summary.vendorNum})
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase">Bot ID</dt>
                  <dd className="text-sm font-mono text-gray-900">{result.summary.botId}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase">Coolify App</dt>
                  <dd className="text-sm font-mono text-gray-900">{result.summary.appUuid}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase">Domain</dt>
                  <dd className="text-sm text-gray-900">{result.summary.domain}</dd>
                </div>
              </dl>

              <div className="mt-4 rounded-md bg-blue-50 p-3">
                <p className="text-sm text-blue-800">
                  <strong>Next steps:</strong> Add DNS A record for{' '}
                  <code className="text-xs bg-blue-100 px-1 rounded">{result.summary.domain}</code>{' '}
                  pointing to <code className="text-xs bg-blue-100 px-1 rounded">111.90.140.72</code>,
                  then wait 2-5 min for the Coolify build to finish.
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Reset Button */}
          <button
            onClick={handleReset}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Deploy Another Vendor
          </button>
        </div>
      )}
    </div>
  );
}
