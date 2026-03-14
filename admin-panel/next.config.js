/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Only use standalone output in production
  ...(process.env.NODE_ENV === 'production' && { output: 'standalone' }),
  // Ensure environment variables are available in middleware
  env: {
    JWT_SECRET: process.env.JWT_SECRET,
    ADDRESS_ENCRYPTION_KEY: process.env.ADDRESS_ENCRYPTION_KEY,
  },
}

module.exports = nextConfig
