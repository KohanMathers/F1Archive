'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { TimelineEvent, TrackPeriod } from '@f1archive/shared';
import { tokens } from '@/lib/tokens';

const ROW: Record<string, number> = { race_control: 0, radio: 1, pit: 2 };

export interface TimelineHandle {
  at(t: number): void;
}

interface Props {
  from: number;
  to: number;
  periods: TrackPeriod[];
  events: TimelineEvent[];
  laps: { lap: number; t_ns: number }[];
  onSeek(t: number): void;
  label(t: number): string;
}

export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline({ from, to, periods, events, laps, onSeek, label }, ref) {
  const el = useRef<HTMLCanvasElement>(null);
  const cur = useRef(from);
  const drag = useRef(false);
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);

  const draw = useCallback(() => {
    const c = el.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const r = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) {
      c.width = Math.round(w * r);
      c.height = Math.round(h * r);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.clearRect(0, 0, w, h);
    const X = (t: number) => ((t - from) / (to - from || 1)) * w;
    const top = 16;
    const bh = 14;
    const k = tokens();
    const BAND: Record<string, string> = { yellow: k.flagYellow, sc: k.flagSc, vsc: k.flagYellow, red: k.flagRed };
    const MARK: Record<string, string> = { race_control: k.text, radio: k.accent, pit: k.muted };
    g.fillStyle = k.panel;
    g.fillRect(0, top, w, bh);
    for (const p of periods) {
      if (p.tone === 'green') continue;
      const a = X(Math.max(from, p.from_ns));
      const b = X(Math.min(to, p.to_ns ?? to));
      if (b < 0 || a > w) continue;
      g.fillStyle = BAND[p.tone] ?? BAND.yellow!;
      if (p.tone === 'vsc') {
        g.save();
        g.beginPath();
        g.rect(a, top, Math.max(2, b - a), bh);
        g.clip();
        g.strokeStyle = BAND.vsc!;
        g.lineWidth = 2;
        for (let x = a - bh; x < b; x += 5) {
          g.beginPath();
          g.moveTo(x, top + bh);
          g.lineTo(x + bh, top);
          g.stroke();
        }
        g.restore();
      } else g.fillRect(a, top, Math.max(2, b - a), bh);
    }
    g.fillStyle = k.muted;
    g.font = `10px ${k.mono}`;
    g.textAlign = 'center';
    const every = Math.max(1, Math.ceil(laps.length / Math.max(1, w / 30)));
    for (const l of laps) {
      const x = Math.round(X(l.t_ns)) + 0.5;
      g.fillRect(x, top - 3, 1, 3);
      if (l.lap === 1 || l.lap % every === 0) g.fillText(String(l.lap), x, top - 6);
    }
    for (const e of events) {
      const row = ROW[e.type];
      if (row === undefined) continue;
      g.fillStyle = MARK[e.type]!;
      g.fillRect(Math.round(X(e.t_ns)), top + bh + 4 + row * 8, 1.5, 6);
    }
    const px = Math.round(X(cur.current));
    g.fillStyle = k.accent;
    g.fillRect(px - 1, 4, 2, h - 4);
  }, [from, to, periods, events, laps]);

  useImperativeHandle(ref, () => ({ at: (t) => ((cur.current = t), draw()) }), [draw]);
  useEffect(() => {
    draw();
    const c = el.current;
    if (!c) return;
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  const tAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    return { x, t: from + (x / r.width) * (to - from), per: (to - from) / r.width };
  };

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={el}
        className="timeline"
        role="slider"
        tabIndex={0}
        aria-label="Session timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round((to - from) / 1e9)}
        aria-valuenow={Math.round((cur.current - from) / 1e9)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(cur.current + 5e9);
          if (e.key === 'ArrowLeft') onSeek(cur.current - 5e9);
        }}
        onPointerDown={(e) => {
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(tAt(e).t);
        }}
        onPointerMove={(e) => {
          const { x, t, per } = tAt(e);
          if (drag.current) onSeek(t);
          const near = events.find((ev) => ROW[ev.type] !== undefined && Math.abs(ev.t_ns - t) < per * 4);
          setTip({ x, text: `${label(t)}${near ? `, ${near.type === 'radio' ? 'team radio' : near.label}` : ''}` });
        }}
        onPointerUp={() => (drag.current = false)}
        onPointerLeave={() => setTip(null)}
      />
      {tip && (
        <div className="tl-tip" style={{ left: tip.x }}>
          {tip.text}
        </div>
      )}
    </div>
  );
});
