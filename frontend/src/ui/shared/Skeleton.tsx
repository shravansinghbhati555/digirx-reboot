import type { CSSProperties } from 'react';

export function Skeleton({
  width,
  height = 14,
  radius = 8,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="skel"
      style={{
        width: width ?? '100%',
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

export function ListItemSkeleton({ avatar = true }: { avatar?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
      {avatar && <Skeleton width={32} height={32} radius={16} />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Skeleton width="55%" height={11} />
        <Skeleton width="35%" height={9} />
      </div>
    </div>
  );
}
