import React from 'react';
import {interpolate, Easing} from 'remotion';
import {
  LogIn, Camera, ImageDown, HelpCircle, Mic, IndianRupee,
  FileText, Send, Store, Database, Package,
} from 'lucide-react';
import {C, SANS, MONO} from '../speaker2/ui';

/**
 * The Technical Approach flowchart, artisan path, laid out as a tree the viewer watches
 * build. The whole chart is on screen the whole time — future nodes ghosted — so there is
 * always a sense of how far through the walk we are.
 *
 * Serpentine rows: row 0 runs left→right, row 1 right→left, row 2 left→right. That keeps
 * every connector either a straight horizontal or one elbow, which is what makes it read
 * as a diagram rather than a list.
 */

export type GNode = {
  id: string;
  label: string;
  sub?: string;
  Icon: React.ComponentType<{size?: number; strokeWidth?: number; color?: string}>;
  /** Grid slot. row 0..2, col 0..3. */
  row: number;
  col: number;
  /** Seconds at which this node lands. Retiming the walk is editing this column. */
  at: number;
  decision?: boolean;
};

export const NODES: GNode[] = [
  {id: 'login',   label: 'Role-based login',    sub: 'her beneficiary ID',      Icon: LogIn,       row: 0, col: 0, at: 3.6},
  {id: 'capture', label: 'Guided capture',      sub: 'blur · light · framing',  Icon: Camera,      row: 0, col: 1, at: 12.7},
  {id: 'enhance', label: 'Image enhanced',      sub: 'background out',          Icon: ImageDown,   row: 0, col: 2, at: 22.2},
  {id: 'good',    label: 'Image good?',         sub: 'no → retake',             Icon: HelpCircle,  row: 0, col: 3, at: 23.6, decision: true},
  {id: 'voice',   label: 'Voice catalogue',     sub: 'read back, then yes',     Icon: Mic,         row: 1, col: 3, at: 30.2},
  {id: 'price',   label: 'AI dynamic pricing',  sub: 'floor, then market',      Icon: IndianRupee, row: 1, col: 2, at: 39.7},
  {id: 'seo',     label: 'SEO catalogue',       sub: 'one catalogue',           Icon: FileText,    row: 1, col: 1, at: 47.2},
  {id: 'listing', label: 'One-tap listing',     sub: 'seven formats',           Icon: Send,        row: 1, col: 0, at: 48.4},
  {id: 'market',  label: 'Marketplaces',        sub: 'ours + external',         Icon: Store,       row: 2, col: 0, at: 49.6},
  {id: 'db',      label: 'One database',        sub: 'PostgreSQL spine',        Icon: Database,    row: 2, col: 1, at: 57.7},
  {id: 'order',   label: 'Order placed',        sub: 'tracked · price learns',  Icon: Package,     row: 2, col: 2, at: 58.9},
];

export const NODE_W = 330;
export const NODE_H = 132;
const COL_X = [170, 585, 1000, 1415];
const ROW_Y = [250, 545, 840];

export const nodeBox = (n: GNode) => ({
  x: COL_X[n.col],
  y: ROW_Y[n.row],
  cx: COL_X[n.col] + NODE_W / 2,
  cy: ROW_Y[n.row] + NODE_H / 2,
});

export const indexAt = (t: number) => {
  let i = -1;
  NODES.forEach((n, k) => {
    if (t >= n.at) i = k;
  });
  return i;
};

/** Elbow path from node a to node b. Same row → straight; row change → drop and across. */
const connector = (a: GNode, b: GNode) => {
  const A = nodeBox(a);
  const B = nodeBox(b);
  if (a.row === b.row) {
    const dir = b.col > a.col ? 1 : -1;
    const x1 = dir > 0 ? A.x + NODE_W : A.x;
    const x2 = dir > 0 ? B.x : B.x + NODE_W;
    return `M${x1} ${A.cy} L${x2} ${B.cy}`;
  }
  // Drop out of the bottom of `a`, then into the top of `b`.
  const midY = (A.y + NODE_H + B.y) / 2;
  return `M${A.cx} ${A.y + NODE_H} L${A.cx} ${midY} L${B.cx} ${midY} L${B.cx} ${B.y}`;
};

/** Tip of the arrow for a -> b, and its rotation in degrees. */
const arrowHead = (a: GNode, b: GNode) => {
  const A = nodeBox(a);
  const B = nodeBox(b);
  if (a.row === b.row) {
    const rightwards = b.col > a.col;
    return {x: rightwards ? B.x : B.x + NODE_W, y: B.cy, rot: rightwards ? 0 : 180};
  }
  return {x: B.cx, y: B.y, rot: 90};
};

const Arrow: React.FC<{d: string; head: {x: number; y: number; rot: number}; progress: number; dim: boolean}> = ({
  d, head, progress, dim,
}) => {
  const ref = React.useRef<SVGPathElement>(null);
  const [len, setLen] = React.useState(600);
  React.useEffect(() => {
    if (ref.current) setLen(ref.current.getTotalLength());
  }, [d]);
  const col = dim ? C.hairStrong : C.coral;
  return (
    <g opacity={dim ? 0.5 : 1}>
      <path
        ref={ref}
        d={d}
        fill="none"
        stroke={col}
        strokeWidth={dim ? 2 : 3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={len}
        strokeDashoffset={len * (1 - progress)}
      />
      <g transform={`translate(${head.x} ${head.y}) rotate(${head.rot})`} opacity={progress > 0.92 ? 1 : 0}>
        <path d="M-11 -7 L0 0 L-11 7" fill="none" stroke={col} strokeWidth={dim ? 2 : 3}
          strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
};

export const NodeCard: React.FC<{
  n: GNode;
  state: 'future' | 'past' | 'now';
  pop: number;
  /** Omit to place the card in its own flowchart slot; pass 0,0 to let a parent place it. */
  at?: {x: number; y: number};
}> = ({n, state, pop, at}) => {
  const {x, y} = at ?? nodeBox(n);
  const now = state === 'now';
  const future = state === 'future';
  const Icon = n.Icon;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: NODE_W,
        height: NODE_H,
        borderRadius: n.decision ? 18 : 14,
        border: `2px solid ${future ? C.hair : C.coral}`,
        background: now ? C.coral : '#fff',
        opacity: future ? 0.38 : 1,
        transform: `scale(${0.94 + pop * 0.06})`,
        boxShadow: now ? '0 14px 38px rgba(156,61,36,0.30)' : '0 1px 3px rgba(28,25,23,0.07)',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '0 22px',
        boxSizing: 'border-box',
      }}
    >
      <Icon size={34} strokeWidth={2} color={now ? '#fff' : C.coral} />
      <div style={{minWidth: 0}}>
        <div style={{font: `600 25px/1.15 ${SANS}`, color: now ? '#fff' : C.ink, letterSpacing: '-0.01em'}}>
          {n.label}
        </div>
        {n.sub ? (
          <div style={{font: `400 18px/1.25 ${SANS}`, color: now ? 'rgba(255,255,255,0.82)' : C.muted, marginTop: 5}}>
            {n.sub}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * The whole chart. `t` is seconds into the section; `draw` is how far the connector into
 * the current node has drawn (0..1). `hideIndex` blanks one node so the morphing chip can
 * stand in for it without the original showing through underneath.
 */
export const Graph: React.FC<{t: number; draw: number; hideIndex?: number; opacity: number}> = ({
  t, draw, hideIndex, opacity,
}) => {
  const active = indexAt(t);
  return (
    <div style={{position: 'absolute', inset: 0, opacity}}>
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        {NODES.slice(1).map((n, k) => {
          const i = k + 1;
          const d = connector(NODES[i - 1], n);
          const p = i < active ? 1 : i === active ? draw : 0;
          return (
            <Arrow key={n.id} d={d} head={arrowHead(NODES[i - 1], n)}
              progress={i <= active ? p : 1} dim={i > active} />
          );
        })}
        {/* The slide's one loop, drawn rather than implied. */}
        {(() => {
          const g = NODES.findIndex((n) => n.id === 'good');
          const c = NODES.findIndex((n) => n.id === 'capture');
          const G = nodeBox(NODES[g]);
          const Cc = nodeBox(NODES[c]);
          const show = interpolate(t, [NODES[g].at + 0.4, NODES[g].at + 1.2], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          const top = G.y - 74;
          return (
            <g opacity={show}>
              <path
                d={`M${G.cx} ${G.y} L${G.cx} ${top} L${Cc.cx} ${top} L${Cc.cx} ${Cc.y}`}
                fill="none" stroke={C.coral} strokeWidth={2.5} strokeDasharray="9 9" strokeLinejoin="round"
              />
              <path d={`M${Cc.cx - 8} ${Cc.y - 12} L${Cc.cx} ${Cc.y - 2} L${Cc.cx + 8} ${Cc.y - 12}`}
                fill="none" stroke={C.coral} strokeWidth={2.5} />
              <text x={(G.cx + Cc.cx) / 2} y={top - 14} textAnchor="middle" fill={C.coral}
                style={{font: `500 19px ${MONO}`}}>
                she retakes it
              </text>
            </g>
          );
        })()}
      </svg>

      {NODES.map((n, i) => {
        if (i === hideIndex) return null;
        const state = i > active ? 'future' : i === active ? 'now' : 'past';
        const pop = interpolate(t, [n.at, n.at + 0.4], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.6)),
        });
        return <NodeCard key={n.id} n={n} state={state as 'future' | 'past' | 'now'} pop={i <= active ? pop : 0} />;
      })}
    </div>
  );
};
