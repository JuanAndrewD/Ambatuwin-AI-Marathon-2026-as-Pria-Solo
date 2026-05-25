// AnimatedNumber — counts smoothly from previous value to new value.
import React, { useEffect, useRef, useState } from 'react';

export default function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 2, durationMs = 600 }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
      setDisplay(from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return <span>{prefix}{display.toFixed(decimals)}{suffix}</span>;
}
