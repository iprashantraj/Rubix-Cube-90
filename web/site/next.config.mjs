/** @type {import('next').NextConfig} */
export default {
  // The marketplace is server-rendered because its product pages have to be indexable —
  // that is the entire reason this surface is Next and not another Vite SPA.
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://localhost:8000/api/:path*' }];
  },
};
