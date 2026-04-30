/**
 * Soft duotone illustration for empty states (brand-100 + brand-500).
 * Floats 6 px with a 4 s loop unless prefers-reduced-motion.
 */
export function EmptyIllustration({ kind = 'folder', size = 100 }: { kind?: 'folder' | 'patients' | 'calendar' | 'receipt' | 'documents' | 'bell'; size?: number }) {
  const w = size;
  const h = Math.round(size * 0.85);
  return (
    <svg width={w} height={h} viewBox="0 0 200 170" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', margin: '0 auto', animation: 'float6 4s ease-in-out infinite' }}>
      <ellipse cx="100" cy="148" rx="74" ry="6" fill="var(--brand-100)" opacity="0.6" />
      {kind === 'folder' && (
        <>
          <rect x="34" y="44" width="132" height="92" rx="14" fill="var(--brand-100)" />
          <path d="M34 58 L80 58 L92 44 L166 44 V72 H34 Z" fill="var(--brand-500)" opacity="0.18" />
          <rect x="44" y="78" width="112" height="48" rx="8" fill="white" stroke="var(--brand-500)" strokeOpacity="0.2" />
          <rect x="56" y="92" width="40" height="6" rx="3" fill="var(--brand-500)" opacity="0.35" />
          <rect x="56" y="106" width="68" height="5" rx="2.5" fill="var(--brand-500)" opacity="0.2" />
        </>
      )}
      {kind === 'patients' && (
        <>
          <rect x="40" y="48" width="120" height="88" rx="12" fill="var(--brand-100)" />
          <circle cx="100" cy="78" r="14" fill="var(--brand-500)" opacity="0.25" />
          <path d="M76 116 Q100 96 124 116" stroke="var(--brand-500)" strokeOpacity="0.4" strokeWidth="3" strokeLinecap="round" fill="none" />
          <rect x="56" y="124" width="88" height="6" rx="3" fill="white" />
        </>
      )}
      {kind === 'calendar' && (
        <>
          <rect x="38" y="46" width="124" height="94" rx="12" fill="var(--brand-100)" />
          <rect x="38" y="46" width="124" height="22" rx="12" fill="var(--brand-500)" opacity="0.2" />
          <line x1="62" y1="38" x2="62" y2="58" stroke="var(--brand-500)" strokeWidth="3" strokeLinecap="round" />
          <line x1="138" y1="38" x2="138" y2="58" stroke="var(--brand-500)" strokeWidth="3" strokeLinecap="round" />
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect key={`${r}-${c}`} x={56 + c * 24} y={80 + r * 14} width="14" height="8" rx="2" fill={r === 1 && c === 1 ? 'var(--brand-500)' : 'white'} opacity={r === 1 && c === 1 ? 1 : 0.65} />
            )),
          )}
        </>
      )}
      {kind === 'receipt' && (
        <>
          <path d="M58 36 V146 L72 138 L86 146 L100 138 L114 146 L128 138 L142 146 V36 L128 44 L114 36 L100 44 L86 36 L72 44 Z" fill="var(--brand-100)" />
          <line x1="76" y1="62" x2="124" y2="62" stroke="var(--brand-500)" strokeWidth="3" strokeOpacity="0.5" strokeLinecap="round" />
          <line x1="76" y1="80" x2="124" y2="80" stroke="var(--brand-500)" strokeWidth="3" strokeOpacity="0.35" strokeLinecap="round" />
          <line x1="76" y1="98" x2="108" y2="98" stroke="var(--brand-500)" strokeWidth="3" strokeOpacity="0.25" strokeLinecap="round" />
          <line x1="76" y1="116" x2="124" y2="116" stroke="var(--brand-500)" strokeWidth="3" strokeOpacity="0.4" strokeLinecap="round" />
        </>
      )}
      {kind === 'documents' && (
        <>
          <rect x="46" y="40" width="86" height="110" rx="10" fill="var(--brand-100)" />
          <rect x="60" y="56" width="58" height="6" rx="3" fill="var(--brand-500)" opacity="0.4" />
          <rect x="60" y="72" width="44" height="5" rx="2.5" fill="var(--brand-500)" opacity="0.25" />
          <rect x="60" y="86" width="58" height="5" rx="2.5" fill="var(--brand-500)" opacity="0.25" />
          <rect x="60" y="100" width="40" height="5" rx="2.5" fill="var(--brand-500)" opacity="0.25" />
          <rect x="78" y="62" width="86" height="110" rx="10" fill="white" stroke="var(--brand-500)" strokeOpacity="0.35" />
          <rect x="92" y="78" width="58" height="6" rx="3" fill="var(--brand-500)" opacity="0.4" />
          <rect x="92" y="94" width="44" height="5" rx="2.5" fill="var(--brand-500)" opacity="0.25" />
          <rect x="92" y="108" width="58" height="5" rx="2.5" fill="var(--brand-500)" opacity="0.25" />
        </>
      )}
      {kind === 'bell' && (
        <>
          <circle cx="100" cy="92" r="48" fill="var(--brand-100)" />
          <path d="M100 64 C84 64 78 78 78 92 V104 L72 112 H128 L122 104 V92 C122 78 116 64 100 64 Z" fill="var(--brand-500)" opacity="0.25" />
          <path d="M92 118 Q100 124 108 118" stroke="var(--brand-500)" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="100" cy="60" r="4" fill="var(--brand-500)" opacity="0.5" />
        </>
      )}
    </svg>
  );
}
