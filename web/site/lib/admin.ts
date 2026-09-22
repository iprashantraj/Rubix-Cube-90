/**
 * The admin console's only data source.
 *
 * 🔑 This file is the seam. Every page below /admin reads through the `get*` functions
 * here and none of them knows where the rows came from. Today there is no admin API —
 * `web/api/routers/` is entirely artisan-scoped, every endpoint resolving `current_artisan`
 * from the token — so these return fixtures and the console deploys as a static Next build
 * with no database, no Redis and no AI box behind it.
 *
 * To put it on the real database, write the routers and change the body of each `get*` to
 * `apiGet('/admin/...')`. The types below are the contract: they are shaped from
 * `api/models.py`, field for field, including the ones that look redundant. `Artisan` here
 * carries `has_pan`/`has_bank` booleans and no PAN number for the same reason the table
 * does — see the header of `models.py` before adding a field.
 *
 * ⚠️ Fixtures are marked. `DEMO` is exported so a page can say so on screen; a demo number
 * that a judge or a coordinator mistakes for a live one is the failure mode this guards.
 */

/** True while the console is serving fixtures. Flip by setting API_BASE. */
export const DEMO = !process.env.API_BASE;

// ── types, mirroring api/models.py ──────────────────────────────────────────

export type Channel =
  | 'marketplace' | 'ondc' | 'gem' | 'amazon' | 'flipkart' | 'meesho' | 'whatsapp';

export type SignupStatus = 'not_started' | 'taught' | 'self_reported_done' | 'connected';

export type OrderState =
  | 'placed' | 'packed' | 'shipped' | 'delivered' | 'settled' | 'cancelled';

export type ListingStatus = 'pending' | 'live' | 'failed' | 'file_ready';

export type AdminArtisan = {
  id: string;
  display_name: string | null;
  phone: string;           // masked at the boundary, see `mask()`
  language: string;
  craft: string | null;
  cluster: string | null;
  district: string | null;
  state: string | null;
  // Readiness flags only. Never the values behind them.
  has_pan: boolean;
  has_bank: boolean;
  has_gst: boolean;
  has_artisan_card: boolean;
  name_check_passed: boolean | null;
  sells_on: Channel[];
  products: number;
  live_listings: number;
  gmv: number;
  joined: string;          // ISO date
};

export type QueueItem = {
  id: string;
  title: string | null;
  artisan: string;
  craft: string | null;
  channel: Channel;
  status: ListingStatus;
  price: number | null;
  floor_price: number | null;
  colour_confirmed: boolean;
  /** Why it is stuck. Null when it is not. */
  blocked_on: string | null;
  updated: string;
};

export type AdminOrder = {
  id: string;
  external_order_id: string | null;
  channel: Channel;
  artisan: string;
  product: string;
  quantity: number;
  amount: number;
  state: OrderState;
  expected_settlement: string | null;
  /** The "Paisa aaya?" tap. Null = not asked yet, false = promised but not arrived. */
  artisan_confirmed_payment: boolean | null;
};

export type ClusterRow = {
  id: string;
  name: string;
  district: string;
  state: string;
  craft: string;
  artisans: number;
  listings: number;
  gmv: number;
  /** Share of this cluster's artisans who published in the last 30 days. */
  adoption: number;
  uplift: number;
  wage_rate_per_hour: number;
};

export type Overview = {
  gmv: number;
  gmv_delta: number;
  artisans: number;
  artisans_added: number;
  listings: number;
  listings_delta: number;
  uplift: number;
  clusters: number;
  clusters_added: number;
  /** 12 months, Apr → Mar. */
  months: { month: string; listings: number; gmv: number }[];
  languages: { label: string; share: number; colour: string }[];
  channels: { channel: Channel; label: string; gmv: number; share: number }[];
  activity: { tag: string; colour: string; head: string; sub: string; when: string }[];
  zero_typing: number;
  median_minutes_to_live: string;
};

export type GemReconRow = {
  id: string;
  gem_order_id: string;
  product: string;
  artisan: string;
  quantity: number;
  amount: number;
  /** What the coordinator read off the GeM dashboard, versus what we hold. */
  gem_state: string;
  our_state: OrderState | null;
  reconciled: boolean;
};

// ── fixtures ────────────────────────────────────────────────────────────────

// Formatting and chart scaling live in `format.mjs` so `node lib/format.test.mjs` can
// check them without a TypeScript loader. Re-exported here so pages have one import.
export { count, rupees, mask, ceiling, line } from './format.mjs';
import { mask } from './format.mjs';

const CLUSTERS: ClusterRow[] = [
  ['cl01', 'Jaipur Blue Pottery CFC', 'Jaipur', 'Rajasthan', 'Blue pottery', 18420, 62180, 412000000, 88, 44, 62],
  ['cl02', 'Varanasi Weavers BLC', 'Varanasi', 'Uttar Pradesh', 'Banarasi weave', 21090, 58640, 387000000, 82, 39, 71],
  ['cl03', 'Birbhum Kantha CFC', 'Birbhum', 'West Bengal', 'Kantha stitch', 16740, 47910, 295000000, 74, 36, 58],
  ['cl04', 'Kutch Bandhani CFC', 'Kutch', 'Gujarat', 'Bandhani', 14260, 41330, 268000000, 69, 33, 65],
  ['cl05', 'Raghurajpur Heritage', 'Puri', 'Odisha', 'Pattachitra', 9880, 28470, 174000000, 58, 31, 54],
  ['cl06', 'Sualkuchi Silk BLC', 'Kamrup', 'Assam', 'Muga silk', 7310, 19260, 121000000, 47, 28, 60],
  ['cl07', 'Chanderi Handloom CFC', 'Ashoknagar', 'Madhya Pradesh', 'Chanderi', 8120, 17940, 93000000, 39, 24, 57],
  ['cl08', 'Srinagar Pashmina CFC', 'Srinagar', 'Jammu & Kashmir', 'Pashmina', 6470, 15830, 86000000, 36, 22, 78],
  ['cl09', 'Bhoodan Pochampally', 'Yadadri', 'Telangana', 'Pochampally ikat', 5940, 13120, 71000000, 33, 21, 63],
  ['cl10', 'Khurja Pottery CFC', 'Bulandshahr', 'Uttar Pradesh', 'Terracotta', 5210, 11480, 58000000, 31, 19, 55],
].map(([id, name, district, state, craft, artisans, listings, gmv, adoption, uplift, wage]) => ({
  id, name, district, state, craft, artisans, listings, gmv, adoption, uplift,
  wage_rate_per_hour: wage,
} as ClusterRow));

const ARTISANS: AdminArtisan[] = [
  ['a01', 'Sunita Devi', '9412300081', 'hi', 'Terracotta', 'cl10', 24, 19, 184000, true, true, false, true, true, ['whatsapp'], '2026-06-14'],
  ['a02', 'Mohammad Irfan', '9335700142', 'hi', 'Banarasi weave', 'cl02', 41, 38, 962000, true, true, true, true, true, ['amazon', 'whatsapp'], '2026-04-02'],
  ['a03', 'Lakshmi Barik', '9438200913', 'or', 'Pattachitra', 'cl05', 17, 12, 231000, false, true, false, true, true, [], '2026-07-21'],
  ['a04', 'Rukhsana Begum', '9906411227', 'ur', 'Pashmina', 'cl08', 9, 9, 1140000, true, true, true, false, true, ['amazon', 'flipkart'], '2026-05-09'],
  ['a05', 'Prakash Chitrakar', '9861200334', 'or', 'Pattachitra', 'cl05', 31, 22, 418000, true, false, false, true, false, ['meesho'], '2026-03-18'],
  ['a06', 'Jayaben Rabari', '9825600478', 'gu', 'Bandhani', 'cl04', 28, 25, 507000, true, true, false, true, true, ['whatsapp', 'meesho'], '2026-05-27'],
  ['a07', 'Anjali Das', '9831100562', 'bn', 'Kantha stitch', 'cl03', 52, 44, 673000, true, true, false, false, true, ['amazon'], '2026-02-11'],
  ['a08', 'Ramesh Prajapat', '9414900836', 'hi', 'Blue pottery', 'cl01', 36, 31, 589000, true, true, true, true, true, ['amazon', 'flipkart', 'whatsapp'], '2026-01-30'],
  ['a09', 'Bhaskar Kalita', '9707300219', 'as', 'Muga silk', 'cl06', 14, 8, 296000, false, false, false, true, null, [], '2026-08-04'],
  ['a10', 'Shanti Koli', '9755400691', 'hi', 'Chanderi', 'cl07', 22, 20, 344000, true, true, false, true, true, ['whatsapp'], '2026-06-30'],
  ['a11', 'Nagamani Reddy', '9490700145', 'te', 'Pochampally ikat', 'cl09', 19, 15, 262000, true, true, false, true, true, ['flipkart'], '2026-07-08'],
  ['a12', 'Gulab Chand', '9928100573', 'hi', 'Blue pottery', 'cl01', 11, 4, 71000, false, true, false, false, false, [], '2026-09-01'],
].map(([id, display_name, phone, language, craft, cluster_id, products, live_listings, gmv,
        has_pan, has_bank, has_gst, has_artisan_card, name_check_passed, sells_on, joined]) => {
  const c = CLUSTERS.find((x) => x.id === cluster_id)!;
  return {
    id, display_name, phone: mask(phone as string), language, craft,
    cluster: c.name, district: c.district, state: c.state,
    has_pan, has_bank, has_gst, has_artisan_card, name_check_passed,
    sells_on, products, live_listings, gmv, joined,
  } as AdminArtisan;
});

const QUEUE: QueueItem[] = [
  ['p01', 'Terracotta Surahi, hand-thrown, 11 inch', 'Sunita Devi', 'Terracotta', 'gem', 'file_ready', 1450, 980, true, null, '2m'],
  ['p02', 'Banarasi silk saree, kadhua buti', 'Mohammad Irfan', 'Banarasi weave', 'amazon', 'live', 18900, 14200, true, null, '9m'],
  ['p03', 'Pattachitra scroll, Krishna Leela', 'Lakshmi Barik', 'Pattachitra', 'marketplace', 'pending', 6400, 4100, false, 'Colour not confirmed after white balance', '14m'],
  ['p04', 'Pashmina shawl, sozni border', 'Rukhsana Begum', 'Pashmina', 'flipkart', 'failed', 42000, 31500, true, 'Flipkart refresh token expired (61 days)', '22m'],
  ['p05', 'Bandhani dupatta, 12-bandh', 'Jayaben Rabari', 'Bandhani', 'gem', 'pending', 2100, 1680, true, 'GeM category template missing for dupattas', '31m'],
  ['p06', 'Kantha throw, running stitch, king', 'Anjali Das', 'Kantha stitch', 'ondc', 'live', 5200, 3900, true, null, '44m'],
  ['p07', 'Blue pottery dinner plate set of 6', 'Ramesh Prajapat', 'Blue pottery', 'amazon', 'live', 3450, 2600, true, null, '51m'],
  ['p08', 'Muga silk mekhela chador', 'Bhaskar Kalita', 'Muga silk', 'marketplace', 'pending', null, 9800, false, 'No price set — floor computed, artisan has not chosen', '1h'],
  ['p09', 'Chanderi stole, zari border', 'Shanti Koli', 'Chanderi', 'meesho', 'pending', 1900, 1450, true, 'Meesho is partner-gated — guided paste queued', '1h'],
  ['p10', 'Pochampally ikat yardage, 5m', 'Nagamani Reddy', 'Pochampally ikat', 'gem', 'file_ready', 7800, 6100, true, null, '2h'],
  ['p11', 'Blue pottery tile, 4x4, floral', 'Gulab Chand', 'Blue pottery', 'marketplace', 'failed', 340, 420, true, 'Price below floor — publish refused', '2h'],
  ['p12', 'Terracotta diya set of 12', 'Sunita Devi', 'Terracotta', 'whatsapp', 'live', 260, 180, true, null, '3h'],
].map(([id, title, artisan, craft, channel, status, price, floor_price, colour_confirmed, blocked_on, updated]) =>
  ({ id, title, artisan, craft, channel, status, price, floor_price, colour_confirmed, blocked_on, updated } as QueueItem));

const ORDERS: AdminOrder[] = [
  ['o01', 'GEM-2026-8841207', 'gem', 'Sunita Devi', 'Terracotta Surahi', 2400, 980000, 'packed', '2026-10-12', null],
  ['o02', '404-7729183-0042816', 'amazon', 'Mohammad Irfan', 'Banarasi silk saree', 1, 18900, 'settled', '2026-09-14', true],
  ['o03', 'OD328841209730', 'flipkart', 'Rukhsana Begum', 'Pashmina shawl', 2, 84000, 'shipped', '2026-10-01', null],
  ['o04', null, 'marketplace', 'Anjali Das', 'Kantha throw', 3, 15600, 'delivered', '2026-09-26', false],
  ['o05', 'GEM-2026-8839114', 'gem', 'Ramesh Prajapat', 'Blue pottery dinner set', 180, 621000, 'delivered', '2026-09-30', false],
  ['o06', null, 'ondc', 'Jayaben Rabari', 'Bandhani dupatta', 40, 84000, 'placed', '2026-10-18', null],
  ['o07', '405-1182774-9930215', 'amazon', 'Ramesh Prajapat', 'Blue pottery plate set', 6, 20700, 'settled', '2026-09-11', true],
  ['o08', null, 'whatsapp', 'Sunita Devi', 'Terracotta diya set', 25, 6500, 'delivered', null, true],
  ['o09', 'GEM-2026-8845663', 'gem', 'Nagamani Reddy', 'Pochampally ikat yardage', 90, 702000, 'placed', '2026-10-22', null],
  ['o10', 'OD328902117441', 'flipkart', 'Rukhsana Begum', 'Pashmina stole', 1, 26000, 'cancelled', null, null],
].map(([id, external_order_id, channel, artisan, product, quantity, amount, state, expected_settlement, artisan_confirmed_payment]) =>
  ({ id, external_order_id, channel, artisan, product, quantity, amount, state, expected_settlement, artisan_confirmed_payment } as AdminOrder));

const GEM_RECON: GemReconRow[] = [
  ['g01', 'GEM-2026-8841207', 'Terracotta Surahi', 'Sunita Devi', 2400, 980000, 'Consignee Receipt pending', 'packed', false],
  ['g02', 'GEM-2026-8839114', 'Blue pottery dinner set', 'Ramesh Prajapat', 180, 621000, 'CRAC generated', 'delivered', false],
  ['g03', 'GEM-2026-8845663', 'Pochampally ikat yardage', 'Nagamani Reddy', 90, 702000, 'Order placed', 'placed', true],
  ['g04', 'GEM-2026-8836902', 'Chanderi stole', 'Shanti Koli', 500, 950000, 'Payment released', null, false],
  ['g05', 'GEM-2026-8833118', 'Kantha cushion cover', 'Anjali Das', 1200, 384000, 'Invoice accepted', 'shipped', false],
].map(([id, gem_order_id, product, artisan, quantity, amount, gem_state, our_state, reconciled]) =>
  ({ id, gem_order_id, product, artisan, quantity, amount, gem_state, our_state, reconciled } as GemReconRow));

const OVERVIEW: Overview = {
  gmv: 2684000000,
  gmv_delta: 41.2,
  artisans: 124860,
  artisans_added: 12430,
  listings: 432190,
  listings_delta: 18.6,
  uplift: 37,
  clusters: 742,
  clusters_added: 61,
  months: [
    ['APR', 18400, 96000000], ['MAY', 22100, 112000000], ['JUN', 25600, 134000000],
    ['JUL', 27700, 143000000], ['AUG', 32300, 172000000], ['SEP', 35800, 186000000],
    ['OCT', 40900, 217000000], ['NOV', 44500, 232000000], ['DEC', 47100, 253000000],
    ['JAN', 50100, 274000000], ['FEB', 52700, 291000000], ['MAR', 55300, 312000000],
  ].map(([month, listings, gmv]) => ({ month, listings, gmv } as Overview['months'][0])),
  languages: [
    { label: 'हिन्दी', share: 31, colour: '#C77914' },
    { label: 'বাংলা', share: 16, colour: '#0F766E' },
    { label: 'मराठी', share: 13, colour: '#4338CA' },
    { label: 'ગુજરાતી', share: 11, colour: '#BE3455' },
    { label: 'தமிழ்', share: 9, colour: '#1D6FD0' },
  ],
  channels: [
    { channel: 'gem', label: 'GeM — government buyers', gmv: 912000000, share: 34 },
    { channel: 'amazon', label: 'Amazon Karigar', gmv: 725000000, share: 27 },
    { channel: 'flipkart', label: 'Flipkart Samarth', gmv: 564000000, share: 21 },
    { channel: 'ondc', label: 'ONDC + direct B2B', gmv: 483000000, share: 18 },
  ],
  activity: [
    { tag: 'VOICE', colour: '#C77914', head: 'Sunita Devi listed Terracotta Surahi', sub: 'Khurja, UP · spoken in हिन्दी · live on GeM + Amazon', when: '2m' },
    { tag: 'GEM', colour: '#4338CA', head: 'Bulk order — 2,400 units', sub: 'Ministry of Tourism · Rajasthan cluster · ₹9.8 L', when: '14m' },
    { tag: 'PRICE', colour: '#0F766E', head: 'Floor guard refused 1 listing', sub: 'Gulab Chand · ₹340 against a ₹420 cost floor', when: '38m' },
    { tag: 'GATE', colour: '#BE3455', head: '84 photographs refused, 71 retaken', sub: 'Light too low · median retake 41s', when: '52m' },
    { tag: 'KYC', colour: '#15803D', head: '612 artisans cleared the name check', sub: 'PM Vishwakarma linkage · booleans only, no documents held', when: '1h' },
  ],
  zero_typing: 92,
  median_minutes_to_live: '6:12',
};

// ── the seam ────────────────────────────────────────────────────────────────
//
// Swap each body for `apiGet('/admin/...')` once the routers exist. Async already, so
// that change does not touch a single caller.

export async function getOverview(): Promise<Overview> { return OVERVIEW; }
export async function getArtisans(): Promise<AdminArtisan[]> { return ARTISANS; }
export async function getArtisan(id: string): Promise<AdminArtisan | undefined> {
  return ARTISANS.find((a) => a.id === id);
}
export async function getQueue(): Promise<QueueItem[]> { return QUEUE; }
export async function getOrders(): Promise<AdminOrder[]> { return ORDERS; }
export async function getClusters(): Promise<ClusterRow[]> { return CLUSTERS; }
export async function getGemRecon(): Promise<GemReconRow[]> { return GEM_RECON; }
