import React, { useState, useEffect, useRef } from 'react';

/* Smoothly counts from the previous value to the new one on every change. */
export default function AnimatedNumber({ value = 0, prefix = '', suffix = '', decimals = 2, absolute = false, className = '', style = {} }) {
  const [disp, setDisp] = useState(value || 0);
  const from = useRef(value || 0);

  useEffect(() => {
    const a = from.current;
    const b = Number(value) || 0;
    const start = performance.now();
    const dur = 650;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisp(a + (b - a) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const shown = absolute ? Math.abs(disp) : disp;
  return (
    <span className={className} style={style}>
      {prefix}{shown.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
    </span>
  );
}
