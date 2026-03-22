'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on navigation (mobile)
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => setUserRole(data.role || 'bot-owner'))
      .catch(() => setUserRole('bot-owner'));
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const navItems = [
    { href: '/admin/bots', label: 'Bots', icon: '🤖' },
    { href: '/admin/products', label: 'Products', icon: '📦' },
    { href: '/admin/categories', label: 'Categories', icon: '📁' },
    { href: '/admin/orders', label: 'Orders', icon: '🧾' },
    { href: '/admin/commissions', label: 'Earnings', icon: '💰' },
    { href: '/admin/discounts', label: 'Discounts', icon: '🏷️' },
    { href: '/admin/contacts', label: 'Contacts', icon: '💬' },
    { href: '/admin/users', label: 'Users', icon: '👥' },
  ];

  const adminItems = userRole === 'super-admin' ? [
    { href: '/admin/deploy-vendor', label: 'Deploy', icon: '🚀' },
    { href: '/admin/users-manage', label: 'Manage Users', icon: '🔧' },
  ] : [];

  const getRoleBadge = () => {
    if (!userRole) return null;
    if (userRole === 'super-admin') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
          Super Admin
        </span>
      );
    }
    if (userRole === 'demo') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
          Demo
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
        Bot Owner
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {userRole === 'demo' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center">
          <span className="text-amber-800 text-sm font-medium">
            Demo Mode — You are viewing a demo account. Changes will not be saved.
          </span>
        </div>
      )}

      {/* Mobile top bar */}
      <div className="lg:hidden bg-white shadow-sm border-b border-gray-200 px-4 h-14 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-900">Auroneth</h1>
        <div>{getRoleBadge()}</div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50" />
        </div>
      )}

      <div className="flex">
        {/* Sidebar */}
        <aside className={`
          fixed inset-y-0 left-0 z-50 w-56 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out
          lg:translate-x-0 lg:static lg:z-auto
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          ${userRole === 'demo' ? 'lg:top-[41px]' : ''}
        `}>
          <div className="flex flex-col h-full">
            {/* Logo */}
            <div className="hidden lg:flex items-center h-14 px-4 border-b border-gray-200">
              <h1 className="text-lg font-bold text-gray-900">Auroneth</h1>
              <div className="ml-auto">{getRoleBadge()}</div>
            </div>

            {/* Nav links */}
            <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    pathname === item.href || pathname.startsWith(item.href + '/')
                      ? 'bg-indigo-50 text-indigo-700 border-l-3 border-indigo-500'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span className="mr-3 text-base">{item.icon}</span>
                  {item.label}
                </Link>
              ))}

              {/* Admin section */}
              {adminItems.length > 0 && (
                <>
                  <div className="pt-4 pb-1 px-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Admin</p>
                  </div>
                  {adminItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        pathname === item.href
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <span className="mr-3 text-base">{item.icon}</span>
                      {item.label}
                    </Link>
                  ))}
                </>
              )}
            </nav>

            {/* Bottom section */}
            <div className="border-t border-gray-200 p-3">
              <button
                onClick={handleLogout}
                className="flex items-center w-full px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                <span className="mr-3 text-base">🚪</span>
                Logout
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-h-screen">
          <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
