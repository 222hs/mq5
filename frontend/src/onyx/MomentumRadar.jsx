import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import { useTradingStore } from '../store/useTradingStore';

/* TradingView Lightweight Charts, premium dark theme, no gridlines,
   amber volume. Fed a real-time candlestick array from the store. */
export default function MomentumRadar() {
  const el = useRef(null);
  const chart = useRef(null);
  const candleSeries = useRef(null);
  const volSeries = useRef(null);
  const candles = useTradingStore((s) => s.candles);
  const positions = useTradingStore((s) => s.positions);
  const priceLines = useRef([]);

  useEffect(() => {
    if (!el.current) return undefined;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#7b808c', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(255,176,0,0.4)', width: 1, style: 3, labelBackgroundColor: '#FFB000' },
        horzLine: { color: 'rgba(255,176,0,0.4)', width: 1, style: 3, labelBackgroundColor: '#FFB000' },
      },
    });
    chart.current = c;
    candleSeries.current = c.addCandlestickSeries({
      upColor: '#00E676', downColor: '#FF3D00', wickUpColor: '#00E676', wickDownColor: '#FF3D00', borderVisible: false,
    });
    volSeries.current = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '', color: 'rgba(255,176,0,0.4)' });
    volSeries.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    return () => { c.remove(); chart.current = null; };
  }, []);

  useEffect(() => {
    if (!candleSeries.current) return;
    const n = candles.length;
    if (!n) { candleSeries.current.setData([]); volSeries.current.setData([]); return; }

    const parseT = (c) => {
      const raw = c.t ?? c.time;
      if (raw == null) return null;
      if (typeof raw === 'number') return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
      const ms = new Date(raw).getTime();
      return isNaN(ms) ? null : Math.floor(ms / 1000);
    };
    let times = candles.map(parseT);
    const ascendingUnique = times.every((t, i) => t != null && (i === 0 || t > times[i - 1]));
    if (!ascendingUnique) {
      const now = Math.floor(Date.now() / 1000);
      times = candles.map((_, i) => now - (n - 1 - i) * 60); // synthesize valid M1 axis
    }

    candleSeries.current.setData(candles.map((c, i) => ({ time: times[i], open: +c.o, high: +c.h, low: +c.l, close: +c.c })));

    const hasVol = candles.some((c) => c.v != null || c.tick_volume != null || c.volume != null);
    volSeries.current.setData(hasVol
      ? candles.map((c, i) => ({ time: times[i], value: +(c.v ?? c.tick_volume ?? c.volume ?? 0), color: (+c.c >= +c.o) ? 'rgba(0,230,118,0.35)' : 'rgba(255,61,0,0.35)' }))
      : []);
  }, [candles]);

  // ── رسم الصفقات المفتوحة كخطوط عند سعر الدخول (تُفلتر لتطابق الشارت) ──
  useEffect(() => {
    if (!candleSeries.current) return;
    priceLines.current.forEach((pl) => { try { candleSeries.current.removePriceLine(pl); } catch { /* noop */ } });
    priceLines.current = [];
    const last = candles.length ? +candles[candles.length - 1].c : null;
    positions.forEach((p) => {
      const price = +(p.price_open ?? p.open ?? 0);
      if (!price) return;
      // اعرض فقط الصفقات القريبة من سعر الشارت (يستبعد رمز آخر مثل BTC على شارت الذهب)
      if (last && Math.abs(price - last) / last > 0.25) return;
      const isBuy = String(p.type || '').toUpperCase() === 'BUY';
      const prof = +(p.profit || 0);
      const pl = candleSeries.current.createPriceLine({
        price,
        color: isBuy ? '#00E676' : '#FF3D00',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${isBuy ? 'BUY' : 'SELL'} ${prof >= 0 ? '+' : ''}${prof.toFixed(2)}`,
      });
      priceLines.current.push(pl);
    });
  }, [positions, candles]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 300 }}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {candles.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 11, letterSpacing: 2 }}>
          AWAITING MOMENTUM FEED
        </div>
      )}
    </div>
  );
}
