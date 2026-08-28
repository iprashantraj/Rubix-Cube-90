/**
 * The app's icon vocabulary. One file, one job.
 *
 * Why a barrel and not `import { Camera } from 'lucide-react'` in every screen:
 *
 *   1. Screens name the MEANING, not the picture. `IconCatalog` survives the day someone
 *      decides a basket reads as "shopping" to an artisan and a shelf reads better. That
 *      is a one-line edit here instead of a grep across 25 routes.
 *   2. It pins the icon set behind a seam. Swapping lucide for anything else later
 *      touches this file only.
 *   3. It stops emoji creeping back in. Emoji render differently on every Android OEM
 *      skin — Samsung, Xiaomi and stock ship three different glyphs for the same
 *      codepoint, several of which are unreadable at 24px on a cracked screen. Icons are
 *      vectors we control, and they inherit `currentColor` so contrast is ours to set.
 *
 * Icon is NEVER the only signal. Design law says icon and text are always paired
 * (docs/Application-Architecture.md §3) — the sole exception is the replay button, which
 * carries an aria-label instead.
 *
 * Names below are verified against lucide-react v1's exports. lucide renamed a lot of
 * icons at v1 (HelpCircle -> CircleQuestionMark, AlertTriangle -> TriangleAlert), so do
 * not restore an older name from memory — check dist/lucide-react.d.ts first.
 */
export {
  // --- bottom nav: the four tabs -------------------------------------------
  House as IconHome,
  Camera as IconCreate,
  ShoppingBasket as IconCatalog,
  Package as IconOrders,
  Wallet as IconMoney,

  // --- core actions ---------------------------------------------------------
  Volume2 as IconReplay, // the one icon-only control in the app
  Check as IconYes,
  X as IconNo,
  Mic as IconMic,
  ArrowRight as IconNext, // "aage" — forward within a flow
  ChevronRight as IconForward, // affordance on a row that leads somewhere
  ChevronLeft as IconBack,
  RotateCcw as IconRetry,
  Send as IconPublish, // the one-tap send-everywhere button
  // The opt-in escape from voice. A keyboard, not a pencil: a pencil means "edit this
  // text", and what we are offering is "the microphone failed you, use the keys instead".
  Keyboard as IconWrite,
  Sparkles as IconEnhance,

  // --- objects and places ---------------------------------------------------
  Image as IconPhoto,
  User as IconUser,
  MapPin as IconPlace,
  Store as IconChannel,
  Languages as IconLanguage,

  /*
   * Craft types, for the /onboard/craft grid. Named by craft, not by object, for the same
   * reason as everything else here — the day a potter's wheel reads better than an amphora
   * that is one line in this file, not a hunt through the grid.
   */
  Spool as IconCraftWeaving,
  Amphora as IconCraftPottery,
  Anvil as IconCraftMetalwork,
  Axe as IconCraftWoodwork,
  Paintbrush as IconCraftPainting,
  Gem as IconCraftJewellery,
  Handbag as IconCraftLeather,
  Leaf as IconCraftBamboo,

  /*
   * --- the marketplaces, on /onboard/channels -------------------------------
   *
   * Four DIFFERENT shapes, and that is the whole requirement. The craft grid works because
   * eight different drawings mean eight different things; the channel grid shipped with one
   * generic mark repeated four times, which put the entire burden on a text label — for the
   * exact users who cannot read one.
   *
   * Deliberately not brand logos. Using the real marks needs licensed assets, and four
   * approximations drawn from memory are both a trademark problem and worse at the job: a
   * bad Amazon swoosh is less recognisable than an honest globe. So these say what each
   * platform IS to an artisan — somewhere far away, a bag, a shop, the app they already use
   * every day.
   *
   * If licensed marks ever arrive, this is the only place that changes.
   */
  Globe as IconChannelAmazon,
  ShoppingBag as IconChannelFlipkart,
  Store as IconChannelMeesho,
  MessageCircle as IconChannelWhatsApp,

  // --- meta -----------------------------------------------------------------
  CircleQuestionMark as IconHelp,
  Settings as IconSettings,
  TriangleAlert as IconAlert,

  /*
   * Status glyphs. Each state gets its own SHAPE, not just its own colour — roughly one
   * man in twelve here cannot tell the green dot from the amber one, and "your listing is
   * live" is not information we are willing to encode in hue alone.
   */
  CircleDot as IconStatusReady,
  Clock as IconStatusPending,
  Circle as IconStatusBlocked,
  CircleCheck as IconStatusDone,
  CircleAlert as IconStatusError,
} from 'lucide-react';
