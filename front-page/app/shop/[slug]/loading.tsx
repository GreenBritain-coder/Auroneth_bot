export default function ShopLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero skeleton */}
      <div className="mb-8">
        <div className="h-8 w-64 bg-gray-700 rounded animate-pulse mb-3"></div>
        <div className="h-4 w-96 bg-gray-700/60 rounded animate-pulse"></div>
      </div>

      {/* Product grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="h-48 bg-gray-700 animate-pulse"></div>
            <div className="p-4 space-y-3">
              <div className="h-4 w-3/4 bg-gray-700 rounded animate-pulse"></div>
              <div className="h-4 w-1/2 bg-gray-700/60 rounded animate-pulse"></div>
              <div className="h-8 w-full bg-gray-700/40 rounded animate-pulse mt-4"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
