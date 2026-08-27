const BASE = process.env.API_BASE ?? 'http://localhost:8000/api';

/**
 * Server-side fetch helper.
 *
 * Marketplace pages are cached briefly rather than rendered per request: a public catalog
 * page changes when the artisan edits it, not on every visitor. `no-store` here would
 * throw away the reason we chose SSR in the first place.
 */
export async function apiGet<T>(path: string, revalidate = 60): Promise<T> {
  const res = await fetch(BASE + path, { next: { revalidate } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export type ShopProduct = {
  id: string;
  title: string | null;
  desc_en: string | null;
  price: number | null;
  gi_claim: string | null;
  certifications: string[];
  images: string[];
};
