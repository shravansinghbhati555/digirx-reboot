import { useCallback, useState, type CSSProperties } from 'react';

/**
 * Returns props to spread onto a wrapper + a `shake()` to fire the shake animation.
 * Use as: const { shakeProps, shake } = useShake();
 *         <div {...shakeProps}> ... </div>
 *         on validation/server failure: shake();
 */
export function useShake() {
  const [count, setCount] = useState(0);
  const trigger = useCallback(() => setCount((c) => c + 1), []);
  const style: CSSProperties | undefined = count > 0 ? { animation: 'shakeX 240ms var(--ease-out)' } : undefined;
  return {
    shakeProps: { key: count, style },
    shake: trigger,
  };
}
