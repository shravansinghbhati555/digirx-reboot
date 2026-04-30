export function AreaChart({
  data,
  labels,
  color = 'var(--brand-500)',
  height = 220,
  yFormat = (v: number) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : String(v)),
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
      <path d={areaPath} fill="url(#areaGrad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}
