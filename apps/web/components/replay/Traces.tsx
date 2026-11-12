'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { lowerIndex } from '@f1archive/shared';
import { tokens } from '@/lib/tokens';

export interface Lane {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  h: number;
  step?: boolean;
  zero?: boolean;
  fmt?: (v: number) => string;
}

export interface Line {
  id: string;
  label: string;
  colour: string;
  dash: number[];
  x: ArrayLike<number>;
  v: Record<string, ArrayLike<number | null>>;
}

export const PATTERNS: { dash: number[]; name: string }[] = [
  { dash: [], name: 'solid' },
  { dash: [6, 4], name: 'dashed' },
  { dash: [2, 3], name: 'dotted' },
  { dash: [9, 3, 2, 3], name: 'dash-dot' },
  { dash: [12, 4], name: 'long dash' },
  { dash: [1, 5], name: 'sparse dots' },
];

const L = 64;
const R = 12;
const GAP = 6;
const AXIS = 20;

export function Traces({
  lanes,
  lines,
  range,
  cursor,
  fmtX,
  xLabel,
  bounds,
  onRange,
  onSeek,
  empty,
}: {
  lanes: Lane[];
  lines: Line[];
  range: [number, number];
  cursor: number | null;
  fmtX: (x: number) => string;
  xLabel: string;
  bounds?: [number, number];
  onRange?: (r: [number, number]) => void;
  onSeek?: (x: number) => void;
  empty?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<{ px: number; x: number } | null>(null);
  const drag = useRef<{ px: number; r: [number, number]; moved: boolean } | null>(null);
  const H = lanes.reduce((a, l) => a + l.h + GAP, 0) + AXIS;

  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, b.clientWidth - 24)));
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  const toPx = useCallback((x: number) => L + ((x - range[0]) / (range[1] - range[0] || 1)) * (w - L - R), [range, w]);
  const toX = useCallback((px: number) => range[0] + ((px - L) / (w - L - R)) * (range[1] - range[0]), [range, w]);

  useEffect(() => {
    const c = el.current;
    if (!c) return;
    const r = window.devicePixelRatio || 1;
    c.width = Math.round(w * r);
    c.height = Math.round(H * r);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.clearRect(0, 0, w, H);
    const k = tokens();
    g.font = `11px ${k.mono}`;
    let top = 0;
    for (const lane of lanes) {
      const Y = (v: number) => top + lane.h - ((v - lane.min) / (lane.max - lane.min || 1)) * lane.h;
      g.strokeStyle = k.line;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(L, top + lane.h + 0.5);
      g.lineTo(w - R, top + lane.h + 0.5);
      g.stroke();
      if (lane.zero && lane.min < 0 && lane.max > 0) {
        g.beginPath();
        g.moveTo(L, Math.round(Y(0)) + 0.5);
        g.lineTo(w - R, Math.round(Y(0)) + 0.5);
        g.stroke();
      }
      const f = lane.fmt ?? ((v: number) => String(Math.round(v)));
      g.textAlign = 'right';
      g.fillStyle = k.text;
      g.fillText(lane.label, L - 8, top + 10);
      g.fillStyle = k.muted;
      if (lane.h >= 56) {
        if (lane.unit) g.fillText(lane.unit, L - 8, top + 23);
        g.fillText(f(lane.max), L - 8, top + 36);
        g.fillText(f(lane.min), L - 8, top + lane.h - 2);
      }
      g.save();
      g.beginPath();
      g.rect(L, top - 1, w - L - R, lane.h + 2);
      g.clip();
      for (const s of lines) {
        const v = s.v[lane.key];
        if (!v) continue;
        g.strokeStyle = s.colour;
        g.lineWidth = 1.5;
        g.setLineDash(s.dash);
        g.beginPath();
        let pen = false;
        let py0 = 0;
        for (let i = Math.max(0, lowerIndex(s.x, range[0])); i < s.x.length; i++) {
          const val = v[i];
          if (val == null) {
            pen = false;
            continue;
          }
          const px = toPx(s.x[i]!);
          const py = Y(Math.min(lane.max, Math.max(lane.min, val)));
          if (!pen) g.moveTo(px, py);
          else if (lane.step) (g.lineTo(px, py0), g.lineTo(px, py));
          else g.lineTo(px, py);
          pen = true;
          py0 = py;
          if (s.x[i]! > range[1]) break;
        }
        g.stroke();
      }
      g.setLineDash([]);
      g.restore();
      top += lane.h + GAP;
    }
    const span = range[1] - range[0];
    const raw = span / Math.max(2, Math.floor((w - L - R) / 110));
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    g.fillStyle = k.muted;
    g.textAlign = 'center';
    for (let x = Math.ceil(range[0] / step) * step; x <= range[1]; x += step) {
      const px = toPx(x);
      if (px < L + 28 || px > w - R - 28) continue;
      g.fillText(fmtX(x), px, top + 12);
    }
    g.textAlign = 'right';
    g.fillText(xLabel, L - 8, top + 12);
    if (cursor != null && cursor >= range[0] && cursor <= range[1]) {
      g.fillStyle = k.accent;
      g.fillRect(Math.round(toPx(cursor)) - 0.5, 0, 1.5, top - GAP);
    }
    if (hover) {
      g.fillStyle = k.muted;
      g.fillRect(Math.round(hover.px), 0, 1, top - GAP);
    }
  }, [lanes, lines, range, cursor, w, H, hover, fmtX, xLabel, toPx]);

  useEffect(() => {
    const c = el.current;
    if (!c || !onRange) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.shiftKey && !e.metaKey) return;
      e.preventDefault();
      const x = toX(e.clientX - c.getBoundingClientRect().left);
      const k = Math.exp(e.deltaY * 0.0015);
      let a = x - (x - range[0]) * k;
      let b = x + (range[1] - x) * k;
      if (bounds) [a, b] = [Math.max(bounds[0], a), Math.min(bounds[1], b)];
      if (b > a) onRange([a, b]);
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [onRange, toX, range, bounds]);

  const rows = hover
    ? [
      ...lines
        .reduce((m, s) => {
          const i = lowerIndex(s.x, hover.x);
          const vals = lanes.map((l) => (i >= 0 && s.v[l.key] ? (s.v[l.key]![i] ?? null) : null));
          const prev = m.get(s.label);
          m.set(s.label, prev ? { ...prev, vals: prev.vals.map((v, k) => v ?? vals[k] ?? null) } : { s, vals });
          return m;
        }, new Map<string, { s: Line; vals: (number | null)[] }>())
        .values(),
    ]
    : [];

  return (
    <div ref={box} className="trace">
      <canvas
        ref={el}
        style={{ height: H, cursor: onRange ? 'grab' : 'crosshair', touchAction: 'pan-y' }}
        role="img"
        aria-label="Telemetry traces"
        onPointerDown={(e) => {
          drag.current = { px: e.clientX, r: range, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const d = drag.current;
          if (d && onRange) {
            const dx = e.clientX - d.px;
            if (Math.abs(dx) > 3) d.moved = true;
            const sh = (dx / (w - L - R)) * (d.r[1] - d.r[0]);
            let [a, b] = [d.r[0] - sh, d.r[1] - sh];
            if (bounds) {
              if (a < bounds[0]) [a, b] = [bounds[0], bounds[0] + (b - a)];
              if (b > bounds[1]) [a, b] = [bounds[1] - (b - a), bounds[1]];
            }
            onRange([a, b]);
          }
          setHover(px >= L && px <= w - R ? { px, x: toX(px) } : null);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
          if (d && !d.moved && onSeek && px >= L) onSeek(toX(px));
        }}
        onPointerLeave={() => setHover(null)}
      />
      {empty && <div className="trace-empty">{empty}</div>}
      {hover && rows.length > 0 && (
        <div className="trace-tip" style={{ left: Math.min(hover.px + 24, w - 240) }}>
          <div className="mono-sm t-muted">{fmtX(hover.x)}</div>
          <table>
            <thead>
              <tr>
                <th />
                {lanes.map((l) => (
                  <th key={l.key}>{l.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, vals }) => (
                <tr key={s.label}>
                  <td style={{ textAlign: 'left' }}>
                    <span className="drv">
                      <i style={{ background: s.colour }} />
                      {s.label}
                    </span>
                  </td>
                  {vals.map((v, i) => (
                    <td key={i}>{v == null ? '' : (lanes[i]!.fmt ?? ((n: number) => String(Math.round(n))))(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
