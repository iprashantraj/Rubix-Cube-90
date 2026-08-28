/**
 * The shapes the API actually returns.
 *
 * Written from the screens that consume them and from web/api/routers/*.py, not invented.
 * Every field here is one some screen reads today; anything the server sends that nothing
 * renders is deliberately absent rather than transcribed for completeness — a type that
 * lists fields nobody uses stops being a description of the contract and becomes a second
 * thing to keep in step with it.
 *
 * ⚠️ These are a CLIENT-SIDE claim about a server we do not typecheck against. They make
 * screens safe to refactor; they do not make the payload correct. Optional markers reflect
 * what the app must survive, not what the server promises.
 */

/** A row in the artisan's own catalogue. `GET /products`. */
export type Product = {
  id: string;
  title?: string | null;
  image?: string | null;
  price?: number | null;
  /** 🔒 The publish gate. Every channel adapter refuses an unconfirmed product. */
  colour_confirmed?: boolean;
};

/**
 * The six order states, normalised from Beckn callbacks, Amazon notifications and
 * Flipkart webhooks before they ever reach the app.
 */
export type OrderState =
  | 'placed'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'settled'
  | 'cancelled';

/** A row in the unified inbox. `GET /orders`. */
export type Order = {
  id: string;
  state: OrderState;
  amount: number;
  quantity: number;
  /** Raw channel name — a proper noun in every language we ship, never translated. */
  channel: string;
  /**
   * What the ARTISAN says landed, not what the channel says it sent. The gap between the
   * two is the settlement-delay evidence /earnings exists to collect.
   */
  artisan_confirmed_payment?: boolean;
  expected_settlement_date?: string | null;
  payment_state?: string | null;
};

/** One selling destination. `GET /channels`. */
export type Channel = {
  id: string;
  name: string;
  /** A = nothing needed, B = one-time OAuth, C = file upload, D = guided browser. */
  tier: 'A' | 'B' | 'C' | 'D';
  /** Tier B truth, from an encrypted refresh token held server-side. */
  connected?: boolean;
  /** Tier C/D truth, and self-reported — we cannot verify a GeM account exists. */
  signup_status?: string | null;
};

/**
 * The artisan's own profile. `GET /me`.
 *
 * 🔒 The readiness flags are BOOLEANS and that is the whole design: has_pan is true or
 * false, and the number itself never enters this app, this store, or our database. What we
 * do not store cannot leak (spec §14.1).
 */
export type Me = {
  display_name?: string | null;
  craft?: string | null;
  pincode?: string | null;
  language?: string | null;
  has_pan?: boolean;
  has_bank?: boolean;
  has_gst?: boolean;
  has_artisan_card?: boolean;
};

/** `GET /me/gst-route` — the server owns this decision, never the app. */
export type GstRoute = {
  route: 'already_registered' | 'enrolment_only' | 'needs_pan_first' | 'full_registration';
  /** The i18n key the server chose. Spoken AND shown, so they cannot disagree. */
  voice_key: string;
};

/** One channel's outcome from a publish fan-out. */
export type PublishResult = {
  /**
   * `dry_run` is a real outcome, not a test artefact: a tier-B channel the artisan has not
   * connected yet reports the listing it WOULD have sent. Publish.jsx counts it separately
   * and says so out loud — "it did not go" must never be the half of the sentence that
   * gets cut off.
   */
  status: 'live' | 'file_ready' | 'failed' | 'pending' | 'dry_run';
  message_key?: string | null;
  /**
   * Where the artisan can fetch the artifact, for channels that produce a file rather than
   * a push. Today only GeM: `/api/publish/gem/{product_id}.xlsx`, which builds the sheet on
   * request because it is a pure function of the product and a stored copy would go stale
   * the moment they corrected a title.
   *
   * ⚠️ This used to be a fabricated `s3://gem/{id}.xlsx` naming an object nobody wrote.
   * The artisan was told their file was ready and there was nothing at the other end.
   */
  artifact_url?: string | null;
};

/** `POST /publish` and `GET /publish/{id}`. */
export type PublishJob = {
  job_id: string;
  status: 'running' | 'done';
  results: Record<string, PublishResult>;
};

/**
 * `POST /price` — the pricing quote.
 *
 * ⚠️ Arithmetic, not a model (docs/decisions.md). The LLM never produces a price; there is
 * no training data for "what should this handicraft cost". The breakdown is spoken so the
 * artisan can hear how the number was reached rather than being handed it.
 */
export type Quote = {
  /** The lowest price that still pays material + labour + margin. Never undercut. */
  floor: number;
  suggested_price: number;
  /** Channel-adjusted list price — what the marketplace shows before its own discounting. */
  mrp: number;
  /** Comparable listings, when any were found. Null is normal, not an error. */
  market_range: { low: number; high: number } | null;
  /** True when every comparable sits BELOW the floor — i.e. the market is underpaying. */
  below_floor_warning?: boolean;
  breakdown?: { material: number; labour: number; margin: number } | null;
  breakdown_voice_hi?: string | null;
};

/**
 * A channel's guided-setup script. `GET /channels/{id}/selectorpack`.
 *
 * Versioned JSON fetched at runtime, never compiled into the app (docs/decisions.md) — a
 * marketplace changing its DOM has to be a config push, not an app release rural users
 * never install.
 */
export type SelectorPack = {
  steps?: {
    key: string;
    /** i18n key spoken for this step. */
    voice_key?: string;
    /** Which listing field this step fills, when it fills one. */
    field?: string;
  }[];
};
