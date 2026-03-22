import Link from 'next/link';

export default function ShopNotFound() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center px-4">
        <h1 className="text-6xl font-bold text-gray-600 mb-4">404</h1>
        <h2 className="text-2xl font-bold text-white mb-4">This shop is not available</h2>
        <p className="text-gray-400 mb-8 max-w-md">
          The shop you&apos;re looking for doesn&apos;t exist or has been disabled by the vendor.
        </p>
        <Link
          href="/"
          className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Back to Marketplace
        </Link>
      </div>
    </div>
  );
}
