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

  useEffect(() => {
    // Decode token to get role (simple base64 decode of payload)
    const token = document.cookie
      .split('; ')
      .find(row => row.startsWith('admin_token='))
      ?.split('=')[1];
    
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        console.log('Token payload:', payload); // Debug log
        setUserRole(payload.role || 'bot-owner');
      } catch (e) {
        console.error('Error decoding token:', e); // Debug log
      }
    } else {
      console.log('No token found in cookies'); // Debug log
    }
  }, []);

  const handleLogout = () => {
    document.cookie = 'admin_token=; path=/; max-age=0';
    router.push('/login');
  };

  const navItems = [
    { href: '/admin/bots', label: 'Bots' },
    { href: '/admin/categories', label: 'Categories' },
    { href: '/admin/products', label: 'Products' },
    { href: '/admin/discounts', label: 'Discounts' },
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/commissions', label: 'Earnings' },
    { href: '/admin/contacts', label: 'Contacts' },
    { href: '/admin/users', label: 'Users' },
  ];

  // Add "Manage Users" link for super-admins only
  const adminNavItems = userRole === 'super-admin' 
    ? [...navItems, { href: '/admin/users-manage', label: 'Manage Users' }]
    : navItems;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-gray-900">Admin Panel</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {adminNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      pathname === item.href
                        ? 'border-indigo-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {userRole && (
                <span className={`text-xs px-2 py-1 rounded-full ${
                  userRole === 'super-admin' 
                    ? 'bg-purple-100 text-purple-800' 
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {userRole === 'super-admin' ? 'Super Admin' : 'Bot Owner'}
                </span>
              )}
              <button
                onClick={handleLogout}
                className="text-gray-500 hover:text-gray-700 px-3 py-2 text-sm font-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

