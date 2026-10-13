import { useEffect, useRef } from 'react';
import {
  CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers, CrosshairMode,
  type IChartApi, type ISeriesApi, type LogicalRange, type Logical, type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import type { Analysis, Bar, Num } from '../lib/types';
import { fmtPrice } from '../lib/format';

export type Overlay = 'volume' | 'ema20' | 'sma50' | 'sma200' | 'vwap' | 'structure' | 'fvg' | 'ob' | 'levels' | 'profile' | 'rsi' | 'macd';

export const C = {
  up: '#2fd27a', down: '#ff5470', ema: '#e5b970', sma50: '#7aa2f7', sma200: '#c58af9', vwap: '#5bc0eb',
  grid: '#1a1d40', obBull: '#3d8bff', obBear: '#d65cff', text: '#8a8fbf', bg: '#0b0d22', provisional: '#9aa7ad',
};

interface Props {
  bars: Bar[];
  analysis: Analysis;
  show: Set<Overlay>;
  intraday: boolean;
  height?: number;
  watermark?: string;
}

const T = (t: number) => t as UTCTimestamp;

function lineData(bars: Bar[], values: Num[]) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) { const v = values[i]; if (v !== null && Number.isFinite(v)) out.push({ time: T(bars[i].time), value: v }); }
  return out;
}

export function PriceChart({ bars, analysis, show, intraday, height = 420, watermark }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const range = useRef<LogicalRange | null>(null);
  const showKey = [...show].sort().join(',');

  // Keep the user's zoom when only toggles change; reset it when the instrument/timeframe changes.
  const dataKey = bars.length ? `${bars[0].time}-${bars.length}` : 'empty';
  const lastDataKey = useRef(dataKey);
  if (lastDataKey.current !== dataKey) { range.current = null; lastDataKey.current = dataKey; }

  useEffect(() => {
    const el = wrap.current;
    if (!el || !bars.length) return;
    const chart: IChartApi = createChart(el, {
      autoSize: true,
      localization: { locale: 'en-US' },
      layout: { background: { color: C.bg }, textColor: C.text, fontSize: 11, fontFamily: 'Inter, sans-serif', panes: { separatorColor: '#23264d', separatorHoverColor: '#3a3f7a' } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#23264d' },
      timeScale: { borderColor: '#23264d', timeVisible: intraday, secondsVisible: false, rightOffset: 6 },
    });

    const candle: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
    });
    candle.setData(bars.map((b) => ({ time: T(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));

    if (show.has('volume')) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      vol.setData(bars.map((b) => ({ time: T(b.time), value: b.volume, color: b.close >= b.open ? '#2fd27a55' : '#ff547055' })));
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }

    const addLine = (values: Num[], color: string, pane = 0, width: 1 | 2 = 1, title = '') => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title }, pane);
      s.setData(lineData(bars, values));
      return s;
    };
    if (show.has('ema20')) addLine(analysis.ema20, C.ema, 0, 2);
    if (show.has('sma50')) addLine(analysis.sma50, C.sma50);
    if (show.has('sma200')) addLine(analysis.sma200, C.sma200);
    if (show.has('vwap')) addLine(analysis.vwap, C.vwap, 0, 1);

    let pane = 1;
    if (show.has('rsi')) {
      const r = addLine(analysis.rsi14, '#b9a3f5', pane, 1, 'RSI 14');
      r.createPriceLine({ price: 70, color: '#ff547088', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      r.createPriceLine({ price: 30, color: '#2fd27a88', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      pane++;
    }
    if (show.has('macd')) {
      const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      h.setData(bars.flatMap((b, i) => { const v = analysis.macd.hist[i]; return v === null ? [] : [{ time: T(b.time), value: v, color: v >= 0 ? '#2fd27a88' : '#ff547088' }]; }));
      addLine(analysis.macd.macd, '#5bc0eb', pane, 1, 'MACD');
      addLine(analysis.macd.signal, '#e5b970', pane, 1, 'Signal');
      pane++;
    }
    const panes = chart.panes();
    // Stretch factors are layout-independent (setHeight needs a measured container).
    panes[0]?.setStretchFactor(panes.length > 2 ? 0.62 : 0.76);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(panes.length > 2 ? 0.19 : 0.24);

    if (show.has('structure')) {
      const markers: SeriesMarker<Time>[] = analysis.structure.events.map((e) => ({
        time: T(bars[e.index].time),
        position: e.direction === 'bull' ? 'belowBar' : 'aboveBar',
        shape: 'circle',
        color: e.provisional ? '#9aa7ad88' : e.direction === 'bull' ? '#2fd27a99' : '#ff547099',
        text: `${e.kind === 'CHoCH' ? 'CH' : 'B'}${e.provisional ? '?' : ''}`,
        size: 0.5,
      }));
      // Kept deliberately small: order blocks are the primary structure visual.
      createSeriesMarkers(candle, markers.slice(-12));
    }

    if (show.has('levels')) {
      for (const l of analysis.levels) {
        candle.createPriceLine({ price: l.price, color: l.kind === 'resistance' ? '#ff547099' : '#2fd27a99', lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: `${l.kind === 'resistance' ? 'R' : 'S'}×${l.touches}` });
      }
    }

    // --- order blocks: primary structure visual ---
    // Active (unmitigated) blocks: solid zone extended to the right edge, accent bar, label with range.
    // Recently mitigated blocks: faint outline ending where price traded back into them.
    const drawOrderBlocks = (parts: string[], w: number, ph: number, x: (i: number) => number | null, y: (p: number) => number | null) => {
      // blocks outside the visible price range are not drawn (they used to spill over the toolbar);
      // one small edge note says how many sit above / below
      const off = { above: [] as number[], below: [] as number[] };
      const last = bars.length - 1;
      const active = analysis.orderBlocks.filter((o) => o.mitigatedIndex === null).slice(-6);
      const recent = analysis.orderBlocks.filter((o) => o.mitigatedIndex !== null && last - (o.mitigatedIndex as number) <= 40).slice(-4);
      const zone = (o: (typeof active)[number], endIdx: number | null, faded: boolean) => {
        const x0 = x(o.index);
        const x1 = endIdx === null ? w : x(endIdx);
        const yt = y(o.top);
        const yb = y(o.bottom);
        if (x0 === null || x1 === null || yt === null || yb === null || x1 < 0 || x0 > w) return;
        if (Math.max(yt, yb) < 0) { if (!faded) off.above.push(o.bottom, o.top); return; }
        if (Math.min(yt, yb) > ph) { if (!faded) off.below.push(o.bottom, o.top); return; }
        const left = Math.max(0, x0);
        const right = Math.min(w, x1);
        const top = Math.max(0, Math.min(yt, yb));
        const h = Math.max(2, Math.min(ph, Math.max(yt, yb)) - top);
        const bull = o.direction === 'bull';
        const col = o.provisional ? C.provisional : bull ? C.obBull : C.obBear;
        if (faded) {
          parts.push(`<rect x="${left}" y="${top}" width="${Math.max(1, right - left)}" height="${h}" fill="none" stroke="${col}66" stroke-dasharray="2 3"/>`);
          return;
        }
        parts.push(`<rect x="${left}" y="${top}" width="${Math.max(1, right - left)}" height="${h}" fill="${col}2e" stroke="${col}" stroke-width="1"/>`);
        if (x0 >= 0) parts.push(`<rect x="${x0}" y="${top}" width="3" height="${h}" fill="${col}"/>`);
        const label = `${bull ? '▲ 매수 OB' : '▼ 매도 OB'} ${fmtPrice(o.bottom)}–${fmtPrice(o.top)}${o.provisional ? ' (미확정)' : ''}`;
        // Origin off-screen: anchor the label at the right edge so it never sits under the OHLC legend.
        const onScreen = x0 >= 0;
        const lx = onScreen ? Math.min(w - 160, x0 + 6) : w - 12;
        const ly = h >= 14 ? top + 11 : bull ? top + h + 11 : top - 3;
        parts.push(`<text x="${lx}" y="${ly}" text-anchor="${onScreen ? 'start' : 'end'}" fill="${col}" font-size="10" font-weight="700" paint-order="stroke" stroke="${C.bg}" stroke-width="3">${label}</text>`);
        parts.push(`<rect x="${w - 6}" y="${top}" width="6" height="${h}" fill="${col}"/>`);
      };
      for (const o of recent) zone(o, o.mitigatedIndex, true);
      for (const o of active) zone(o, null, false);
      const note = (vals: number[], yPos: number, txt: string, col: string) => {
        if (!vals.length) return;
        parts.push(`<text x="${w - 10}" y="${yPos}" text-anchor="end" fill="${col}" font-size="10" font-weight="700" paint-order="stroke" stroke="${C.bg}" stroke-width="3">${txt} ${vals.length / 2}개 (${fmtPrice(Math.min(...vals))}–${fmtPrice(Math.max(...vals))})</text>`);
      };
      note(off.above, 14, '▲ 화면 위 오더블록', C.obBear);
      note(off.below, ph - 6, '▼ 화면 아래 오더블록', C.obBull);
    };

    // --- SVG overlay: FVG / order-block zones and volume profile ---
    const draw = () => {
      const s = svg.current;
      if (!s) return;
      const ts = chart.timeScale();
      const w = ts.width();
      const h = chart.panes()[0]?.getHeight() ?? 0;
      s.setAttribute('width', String(w));
      s.setAttribute('height', String(h));
      const x = (i: number) => ts.logicalToCoordinate(i as Logical);
      const y = (p: number) => candle.priceToCoordinate(p);
      const parts: string[] = [];
      const rect = (i0: number, i1: number | null, top: number, bottom: number, fill: string, stroke: string, label: string) => {
        const x0 = x(i0);
        const x1 = i1 === null ? w : x(i1);
        const y0 = y(top);
        const y1 = y(bottom);
        if (x0 === null || x1 === null || y0 === null || y1 === null || x1 < 0 || x0 > w) return;
        const left = Math.max(0, x0);
        parts.push(`<rect x="${left}" y="${Math.min(y0, y1)}" width="${Math.max(1, Math.min(w, x1) - left)}" height="${Math.max(1, Math.abs(y1 - y0))}" fill="${fill}" stroke="${stroke}" stroke-dasharray="3 3"/>`);
        if (x0 >= 0) parts.push(`<text x="${x0 + 3}" y="${Math.min(y0, y1) + 10}" fill="${stroke}" font-size="9">${label}</text>`);
      };
      if (show.has('fvg')) {
        const recent = analysis.fvg.filter((g) => g.filledIndex === null).slice(-8);
        for (const g of recent) rect(g.index, null, g.top, g.bottom, g.direction === 'bull' ? '#2fd27a1c' : '#ff54701c', g.provisional ? C.provisional : g.direction === 'bull' ? '#2fd27aaa' : '#ff5470aa', g.provisional ? 'FVG?' : 'FVG');
      }
      if (show.has('ob')) drawOrderBlocks(parts, w, h, x, y);
      if (show.has('profile') && analysis.profile.bins.length) {
        const max = Math.max(...analysis.profile.bins.map((b) => b.volume));
        for (const b of analysis.profile.bins) {
          const y0 = y(b.high);
          const y1 = y(b.low);
          if (y0 === null || y1 === null) continue;
          const bw = (b.volume / max) * w * 0.2;
          const inVa = analysis.profile.valueAreaLow !== null && analysis.profile.valueAreaHigh !== null && b.low >= analysis.profile.valueAreaLow - 1e-9 && b.high <= analysis.profile.valueAreaHigh + 1e-9;
          parts.push(`<rect x="${w - bw}" y="${y0 + 0.5}" width="${bw}" height="${Math.max(1, y1 - y0 - 1)}" fill="${inVa ? '#5bc0eb33' : '#8a8fbf22'}"/>`);
        }
        if (analysis.profile.poc !== null) {
          const py = y(analysis.profile.poc);
          if (py !== null) parts.push(`<line x1="${w * 0.78}" x2="${w}" y1="${py}" y2="${py}" stroke="#5bc0eb" stroke-width="1"/><text x="${w * 0.78}" y="${py - 3}" fill="#5bc0eb" font-size="9">POC</text>`);
        }
      }
      s.innerHTML = parts.join('');
    };
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    chart.timeScale().subscribeSizeChange(schedule);

    // --- OHLC legend ---
    const writeLegend = (i: number) => {
      const b = bars[i];
      if (!legend.current || !b) return;
      const chg = i > 0 ? b.close / bars[i - 1].close - 1 : 0;
      legend.current.innerHTML = `O <b>${fmtPrice(b.open)}</b> H <b>${fmtPrice(b.high)}</b> L <b>${fmtPrice(b.low)}</b> C <b class="${chg >= 0 ? 'up' : 'down'}">${fmtPrice(b.close)}</b> <span class="${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '+' : ''}${(chg * 100).toFixed(2)}%</span>`;
    };
    writeLegend(bars.length - 1);
    chart.subscribeCrosshairMove((p) => {
      schedule();
      const idx = p.logical !== undefined ? Math.round(p.logical) : bars.length - 1;
      writeLegend(Math.max(0, Math.min(bars.length - 1, idx)));
    });

    if (range.current) chart.timeScale().setVisibleLogicalRange(range.current);
    else chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - (intraday ? 160 : 180)), to: bars.length + 4 });
    schedule();

    return () => {
      range.current = chart.timeScale().getVisibleLogicalRange();
      cancelAnimationFrame(raf);
      chart.remove();
    };
  }, [bars, analysis, showKey, intraday, height]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="chart-cell" style={{ height }}>
      <div className="chart-mount" ref={wrap} />
      <svg className="chart-overlay" ref={svg} />
      <div className="chart-legend" ref={legend} />
      {watermark && <div className="chart-watermark">{watermark}</div>}
    </div>
  );
}
