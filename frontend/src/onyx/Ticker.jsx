import React, { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

/* Hardware-accelerated number ticker (Framer spring). */
export default function Ticker({ value, prefix = '', suffix = '', decimals = 2, absolute = false, className = '', style }) {
  const sv = useSpring(value || 0, { stiffness: 80, damping: 18, mass: 0.7 });
  useEffect(() => { sv.set(value || 0); }, [value, sv]);
  const text = useTransform(sv, (v) => {
    const n = absolute ? Math.abs(v) : v;
    return prefix + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  });
  return <motion.span className={`tick-num ${className}`} style={style}>{text}</motion.span>;
}
