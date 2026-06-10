import { formatMoneyCompact } from './primitives';

export function AreaChart({
  data,
  labels,
  color = 'var(--brand-500)',
  height = 220,
  yFormat = (v: number) => formatMoneyCompact(v),
}: {
  data: number[];
  labels: string[];
  color?: string;
  height?: number;
  yFormat?: (v: number) => string;
}) {
  const w = 800;
  const h = height;
  const pad = { t: 16, r: 16, b: 32, l: 56 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const safeData = data.length > 1 ? data : [...data, 0];
  const max = Math.max(...safeData, 1) * 1.1;
  const min = 0;
  const xStep = cw / Math.max(safeData.length - 1, 1);
  const yScale = (v: number) => ch - ((v - min) / (max - min || 1)) * ch;
  const pts = safeData.map((v, i) => [pad.l + i * xStep, pad.t + yScale(v)] as const);
  const linePath = `M ${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')}`;
  const areaPath = `${linePath} L ${pts[pts.length - 1][0]},${pad.t + ch} L ${pts[0][0]},${pad.t + ch} Z`;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((max / yTicks) * i));

  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }

  // CSS draw-in animations on these elements use `forwards`, which means
  // they only run on mount and then freeze. When `data` changes (range
  // change or polling refresh) React updates the `d` attribute in place
  // but the animation doesn't replay — leaving the path stuck in its
  // previous final-keyframe state, sometimes with a stale dasharray that
  // hides the new geometry. Keying each animated node by a data signature
  // forces React to unmount and remount them, restarting the animation
  // with the new path. Cheap (paths are leaves) and removes the
  // stale-render bug without giving up the entry effect.
  const dataKey = `${data.length}|${safeData[0]}|${safeData[safeData.length - 1]}|${max.toFixed(2)}|${color}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height, display: 'block' }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {tickVals.map((v, i) => {
        const y = pad.t + yScale(v);
        return (
          <g key={i}>
            <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
            <text x={pad.l - 8} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-subtle)" fontFamily="Inter">
              {yFormat(v)}
            </text>
          </g>
        );
      })}
      {labels.map((l, i) => {
        if (i % Math.ceil(labels.length / 7) !== 0 && i !== labels.length - 1) return null;
        const x = pad.l + i * xStep;
        return (
          <text key={i} x={x} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--text-subtle)" fontFamily="Inter">
            {l}
          </text>
        );
      })}
      <path key={`area-${dataKey}`} d={areaPath} fill="url(#areaGrad)"
        style={{ opacity: 0, animation: 'pathFadeIn 800ms var(--ease-out) 200ms forwards' }} />
      <path key={`line-${dataKey}`} d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{
          strokeDasharray: len.toFixed(1),
          strokeDashoffset: len.toFixed(1),
          animation: 'pathDraw 800ms var(--ease-out) forwards',
          ['--draw-len' as never]: len.toFixed(1),
        }} />
      <circle key={`dot-${dataKey}`} cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill={color} stroke="var(--surface)" strokeWidth="2"
        style={{ opacity: 0, animation: 'pathFadeIn 200ms var(--ease-out) 780ms forwards' }} />
    </svg>
  );
}
