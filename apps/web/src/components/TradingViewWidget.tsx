import { useEffect, useRef } from 'react';
import type { Timeframe } from '../lib/types';

const TF: Record<Timeframe, string> = { '5m': '5', '1H': '60', '1D': 'D', '1W': 'W' };

/**
 * Official TradingView Advanced Chart embed (free widget). It shows TradingView's own
 * data and drawing tools; its data is not readable by ALPHA TERMINAL and the viewer's
 * TradingView login/saved layouts are not carried into the embed.
 */
export function TradingViewWidget({ symbol, tf, height = 520 }: { symbol: string; tf: Timeframe; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !symbol) return;
    el.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: TF[tf],
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'kr',
      backgroundColor: '#0b0d22',
      gridColor: 'rgba(35, 38, 77, 0.6)',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      calendar: false,
      studies: ['STD;VWAP', 'STD;RSI'],
      support_host: 'https://www.tradingview.com',
    });
    el.appendChild(script);
    return () => { el.innerHTML = ''; };
  }, [symbol, tf]);
  return <div className="tradingview-widget-container tv-embed" ref={ref} style={{ height }} />;
}
