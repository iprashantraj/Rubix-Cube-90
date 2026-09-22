/** @type {import('next').NextConfig} */
export default {
  // The marketplace is server-rendered because its product pages have to be indexable —
  // that is the entire reason this surface is Next and not another Vite SPA.
  //
  // ⚠️ Conditional on API_BASE. Without it there is no backend to proxy to, and a rewrite
  // pointing at localhost:8000 from a Vercel deploy is a 502 waiting for whoever clicks
  // it. The admin console reads fixtures in that mode (see `lib/admin.ts`), so nothing
  // needs the proxy until the API is actually deployed somewhere.
  async rewrites() {
    if (!process.env.API_BASE) return [];
    const target = process.env.API_BASE.replace(/\/api\/?$/, '');
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};
