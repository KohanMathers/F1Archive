'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { TrackOutline } from '@f1archive/shared';
import { tokens } from '@/lib/tokens';
import type { FlagState, SectorFlag } from './flags';

export interface Car {
  id: string;
  code: string;
  colour: string;
  x: number;
  y: number;
  selected: boolean;
  lapsDone?: number | null;
  racing?: boolean;
}

export interface TrackHandle {
  paint(cars: Car[], flags?: FlagState, t?: number): void;
}

interface Cam {
  cx: number;
  cy: number;
  zoom: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 24;
const FOLLOW_FROM = 1.5;
const EASE = 0.28;
const FOLLOW_MARGIN = 72;

const BLUE_GAP = 1000;
const BLUE_RELEASE = 1600;
const BLUE_MIN = 1.5e9;
const PANEL_PASS = 80;
const PANEL_LINGER = 0.4e9;
const OFF_TRACK = 250;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface Props {
  outline: TrackOutline;
  corners: boolean;
  marshalLights: boolean;
  inferBlue: boolean;
  onPick?: (id: string) => void;
}

export const TrackCanvas = forwardRef<TrackHandle, Props>(function TrackCanvas({ outline, corners, marshalLights, inferBlue, onPick }, ref) {
  const el = useRef<HTMLCanvasElement>(null);
  const last = useRef<Car[]>([]);
  const flags = useRef<FlagState | null>(null);

  const sectorRuns = useMemo(() => {
    const n = outline.x.length;
    if (n < 3 || !outline.marshal_sectors.length) return new Map<number, [number, number]>();
    const nearest = (x: number, y: number) => {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (outline.x[i]! - x) ** 2 + (outline.y[i]! - y) ** 2;
        if (d < bd) [bd, best] = [d, i];
      }
      return best;
    };
    const starts = outline.marshal_sectors.map((m) => ({ number: m.number, at: nearest(m.x, m.y) })).sort((a, b2) => a.at - b2.at);
    return new Map(starts.map((s, i) => [s.number, [s.at, starts[(i + 1) % starts.length]!.at] as [number, number]]));
  }, [outline]);

  const along = useMemo(() => {
    const n = outline.x.length;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.hypot(outline.x[i]! - outline.x[i - 1]!, outline.y[i]! - outline.y[i - 1]!);
    const length = n ? cum[n - 1]! : 0;
    const project = (x: number, y: number) => {
      let bs = 0;
      let bd = Infinity;
      for (let i = 0; i + 1 < n; i++) {
        const ax = outline.x[i]!;
        const ay = outline.y[i]!;
        const dx = outline.x[i + 1]! - ax;
        const dy = outline.y[i + 1]! - ay;
        const l2 = dx * dx + dy * dy;
        const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const d = (ax + u * dx - x) ** 2 + (ay + u * dy - y) ** 2;
        if (d < bd) [bd, bs] = [d, cum[i]! + u * Math.sqrt(l2)];
      }
      return { s: length ? bs % length : 0, off: Math.sqrt(bd) };
    };
    const lights = outline.marshal_lights.map((m) => ({ number: m.number, s: project(m.x, m.y).s }));
    return { length, project, lights };
  }, [outline]);

  const held = useRef(new Map<string, { fast: string; until: number }>());
  const heldAt = useRef(-Infinity);
  const panelOf = useRef(new Map<string, { number: number; s: number }>());
  const litAt = useRef(new Map<number, number>());
  const blue = useRef(new Set<number>());

  const updateBlue = useCallback(
    (cars: Car[], fl: FlagState | null, t: number | undefined) => {
      const out = new Set<number>();
      const { length, project, lights } = along;
      if (t == null || t < heldAt.current) {
        held.current.clear();
        panelOf.current.clear();
        litAt.current.clear();
      }
      heldAt.current = t ?? -Infinity;
      if (!fl || fl.track || !lights.length || length <= 0) {
        held.current.clear();
        panelOf.current.clear();
        litAt.current.clear();
        blue.current = out;
        return;
      }
      const placed = new Map(
        cars
          .filter((c) => c.racing !== false)
          .map((c) => [c.id, { c, ...project(c.x, c.y) }] as const)
          .filter(([, p]) => p.off < OFF_TRACK),
      );
      const behind = (slow: { s: number }, fast: { s: number }) => (slow.s - fast.s + length) % length;

      if (inferBlue && t != null) {
        for (const [id, h] of held.current) {
          const slow = placed.get(id);
          const fast = placed.get(h.fast);
          const gap = slow && fast ? behind(slow, fast) : null;
          const passed = gap != null && gap > length / 2;
          if (passed || (t >= h.until && (gap == null || gap > BLUE_RELEASE))) held.current.delete(id);
        }
        for (const slow of placed.values()) {
          if (slow.c.lapsDone == null) continue;
          for (const fast of placed.values()) {
            if (fast === slow || fast.c.lapsDone == null || fast.c.lapsDone <= slow.c.lapsDone) continue;
            const gap = behind(slow, fast);
            if (gap > 0 && gap < BLUE_GAP) held.current.set(slow.c.id, { fast: fast.c.id, until: t + BLUE_MIN });
          }
        }
      } else held.current.clear();

      const showing = new Set([...fl.blue, ...held.current.keys()]);
      for (const id of panelOf.current.keys()) if (!showing.has(id)) panelOf.current.delete(id);
      for (const id of showing) {
        const p = placed.get(id);
        if (!p) continue;
        const cur = panelOf.current.get(id);
        const past = cur ? (p.s - cur.s + length) % length : Infinity;
        if (!cur || (past > PANEL_PASS && past < length / 2)) {
          let next: { number: number; s: number } | null = null;
          let nd = Infinity;
          for (const l of lights) {
            const d = (l.s - p.s + PANEL_PASS + length) % length;
            if (d > PANEL_PASS && d < nd) [nd, next] = [d, l];
          }
          if (next) panelOf.current.set(id, next);
        }
        const panel = panelOf.current.get(id);
        if (panel) out.add(panel.number);
      }
      if (t != null) {
        for (const n of out) litAt.current.set(n, t);
        for (const [n, at] of litAt.current) {
          if (t - at < PANEL_LINGER) out.add(n);
          else litAt.current.delete(n);
        }
      }
      blue.current = out;
    },
    [along, inferBlue],
  );
  const b = outline.bounds;
  const home = useCallback((): Cam => (b ? { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, zoom: 1 } : { cx: 0, cy: 0, zoom: 1 }), [b]);

  const cam = useRef<Cam>(home());
  const goal = useRef<Cam>(home());
  const userZoom = useRef(1);
  const followRef = useRef(false);
  const stepAt = useRef<number | null>(null);
  const raf = useRef(0);
  const [ui, setUi] = useState({ zoom: 1, follow: false, selected: 0 });

  const baseScale = useCallback(() => {
    const c = el.current;
    if (!c || !b) return 1;
    const pad = 28;
    return Math.min((c.clientWidth - 2 * pad) / (b.maxX - b.minX || 1), (c.clientHeight - 2 * pad) / (b.maxY - b.minY || 1));
  }, [b]);

  const toScreen = useCallback(
    (x: number, y: number, v: Cam = cam.current): [number, number] => {
      const c = el.current!;
      const s = baseScale() * v.zoom;
      return [c.clientWidth / 2 + (x - v.cx) * s, c.clientHeight / 2 - (y - v.cy) * s];
    },
    [baseScale],
  );
  const toTrack = useCallback(
    (px: number, py: number, v: Cam = cam.current): [number, number] => {
      const c = el.current!;
      const s = baseScale() * v.zoom;
      return [v.cx + (px - c.clientWidth / 2) / s, v.cy - (py - c.clientHeight / 2) / s];
    },
    [baseScale],
  );

  const followGoal = useCallback((): Cam | null => {
    const sel = last.current.filter((c) => c.selected);
    const c = el.current;
    if (!sel.length || !c) return null;
    const xs = sel.map((s) => s.x);
    const ys = sel.map((s) => s.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s0 = baseScale();
    const fitW = (c.clientWidth - 2 * FOLLOW_MARGIN) / ((x1 - x0) * s0 || 1e-9);
    const fitH = (c.clientHeight - 2 * FOLLOW_MARGIN) / ((y1 - y0) * s0 || 1e-9);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoom: clampZoom(Math.min(userZoom.current, fitW, fitH)) };
  }, [baseScale]);

  const draw = useCallback(() => {
    const c = el.current;
    if (!c || !b) return;
    const cars = last.current;
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
    const tk = tokens();
    const z = cam.current.zoom;
    const P = (x: number, y: number) => toScreen(x, y);

    if (outline.x.length > 1) {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      outline.x.forEach((x, i) => {
        const [px, py] = P(x, outline.y[i]!);
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      const width = 9 * Math.sqrt(z);
      const fl = flags.current;
      const trackTone = fl?.track === 'red' ? tk.flagRed : fl?.track === 'sc' ? tk.flagSc : fl?.track === 'vsc' ? tk.flagYellow : tk.trackCasing;
      g.strokeStyle = trackTone;
      g.lineWidth = width;
      g.stroke();
      if (fl && !fl.track) {
        for (const [sector, flag] of fl.sectors) {
          const run = sectorRuns.get(sector);
          if (!run) continue;
          strokeRun(g, outline, run, P);
          g.lineCap = 'butt';
          g.strokeStyle = tk.flagYellow;
          g.lineWidth = width;
          g.stroke();
          if (flag === 'double') {
            g.strokeStyle = tk.trackCasing;
            g.lineWidth = width * 0.34;
            g.stroke();
          }
        }
        g.lineCap = 'round';
        g.beginPath();
        outline.x.forEach((x, i) => {
          const [px, py] = P(x, outline.y[i]!);
          if (i) g.lineTo(px, py);
          else g.moveTo(px, py);
        });
      }
      g.strokeStyle = tk.trackLine;
      g.lineWidth = 1.5;
      g.stroke();
      const [sx, sy] = P(outline.x[0]!, outline.y[0]!);
      g.fillStyle = tk.text;
      g.fillRect(sx - 1.5, sy - 6 * Math.sqrt(z), 3, 12 * Math.sqrt(z));
    }
    if (marshalLights && outline.marshal_lights.length) {
      const k = Math.min(2, Math.sqrt(z));
      const off = (4.5 * Math.sqrt(z)) + 7 * k;
      const fl = flags.current;
      for (const m of outline.marshal_lights) {
        const [px, py] = P(m.x, m.y);
        if (px < -30 || py < -30 || px > w + 30 || py > h + 30) continue;
        const a = ((m.angle ?? 0) * Math.PI) / 180;
        const lit: SectorFlag | 'red' | 'sc' | 'vsc' | 'blue' | undefined = fl?.track ?? fl?.sectors.get(m.number) ?? (blue.current.has(m.number) ? 'blue' : undefined);
        g.save();
        g.translate(px + Math.cos(a) * off, py - Math.sin(a) * off);
        g.rotate(-a);
        const bw = 6 * k;
        const bh = 10 * k;
        g.fillStyle = lit === 'red' ? tk.flagRed : lit === 'sc' ? tk.flagSc : lit === 'blue' ? tk.flagBlue : lit ? tk.flagYellow : tk.bg;
        g.fillRect(-bw / 2, -bh / 2, bw, bh);
        if (lit === 'double') {
          g.fillStyle = tk.text;
          g.fillRect(-bw / 2, -0.75, bw, 1.5);
        }
        g.lineWidth = 1;
        g.strokeStyle = tk.text;
        g.strokeRect(-bw / 2, -bh / 2, bw, bh);
        g.restore();
      }
    }
    if (corners) {
      g.font = `10px ${tk.mono}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = tk.muted;
      const off = 15 * Math.sqrt(z);
      for (const t of outline.corners) {
        const [px, py] = P(t.x, t.y);
        const a = ((t.angle ?? 0) * Math.PI) / 180;
        g.fillText(`${t.number}${t.letter ?? ''}`, px + Math.cos(a) * off, py - Math.sin(a) * off);
      }
    }
    const anySel = cars.some((x) => x.selected);
    const order = [...cars].sort((a, b2) => Number(a.selected) - Number(b2.selected));
    const labels: [number, number, number][] = [];
    g.font = `600 11px ${tk.mono}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const labelAll = z >= 3;
    for (const car of order) {
      const [px, py] = P(car.x, car.y);
      if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
      const rad = (car.selected ? 6 : 4.5) * Math.min(1.6, Math.sqrt(z));
      g.globalAlpha = car.selected || !anySel ? 1 : 0.5;
      g.beginPath();
      g.arc(px, py, rad, 0, Math.PI * 2);
      g.fillStyle = car.colour;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = tk.bg;
      g.stroke();
      g.globalAlpha = 1;
      if (car.selected || labelAll) {
        const tw = g.measureText(car.code).width + 6;
        let ly = py - 7;
        const lx = px + rad + 3;
        for (let n = 0; n < 6 && labels.some(([ax, ay, aw]) => lx < ax + aw && lx + tw > ax && Math.abs(ly - ay) < 14); n++) ly += 15;
        labels.push([lx, ly, tw]);
        g.globalAlpha = car.selected || !anySel ? 1 : 0.7;
        g.fillStyle = tk.text;
        g.fillRect(lx, ly, tw, 14);
        g.fillStyle = tk.bg;
        g.fillText(car.code, lx + 3, ly + 7);
        g.globalAlpha = 1;
      }
    }
  }, [b, outline, corners, marshalLights, sectorRuns, toScreen]);

  const step = useCallback(
    (now: number) => {
      const dt = stepAt.current == null ? 0.016 : Math.min(0.25, (now - stepAt.current) / 1000);
      stepAt.current = now;
      if (followRef.current) {
        const f = followGoal();
        if (f) goal.current = f;
      }
      const k = 1 - Math.exp(-dt / EASE);
      const c = cam.current;
      const t = goal.current;
      const lz = Math.log(c.zoom) + (Math.log(t.zoom) - Math.log(c.zoom)) * k;
      cam.current = { cx: c.cx + (t.cx - c.cx) * k, cy: c.cy + (t.cy - c.cy) * k, zoom: Math.exp(lz) };
      draw();
      const s0 = baseScale();
      const settled =
        Math.abs(Math.log(t.zoom / cam.current.zoom)) < 0.002 &&
        Math.hypot(t.cx - cam.current.cx, t.cy - cam.current.cy) * s0 * cam.current.zoom < 0.3;
      if (settled) cam.current = { ...t };
      return settled;
    },
    [draw, followGoal, baseScale],
  );

  const kick = useCallback(() => {
    if (raf.current) return;
    const loop = (now: number) => {
      if (step(now)) {
        raf.current = 0;
        stepAt.current = null;
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }, [step]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const paint = useCallback(
    (cars: Car[], fl?: FlagState, t?: number) => {
      last.current = cars;
      flags.current = fl ?? null;
      updateBlue(cars, flags.current, t);
      const nSel = cars.filter((c) => c.selected).length;
      if (nSel !== ui.selected) setUi((u) => ({ ...u, selected: nSel }));
      if (raf.current) return;
      if (step(performance.now())) stepAt.current = null;
      else kick();
    },
    [step, kick, ui.selected, updateBlue],
  );
  useImperativeHandle(ref, () => ({ paint }), [paint]);

  useEffect(() => {
    const c = el.current;
    if (!c) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  const setFollow = useCallback(
    (on: boolean) => {
      followRef.current = on;
      setUi((u) => ({ ...u, follow: on }));
      kick();
    },
    [kick],
  );

  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number) => {
      const c = el.current;
      if (!c) return;
      const z = clampZoom(goal.current.zoom * factor);
      userZoom.current = z;
      if (followRef.current) {
        goal.current = { ...goal.current, zoom: z };
      } else {
        const ax = px ?? c.clientWidth / 2;
        const ay = py ?? c.clientHeight / 2;
        const [tx, ty] = toTrack(ax, ay, goal.current);
        const s = baseScale() * z;
        goal.current = { cx: tx - (ax - c.clientWidth / 2) / s, cy: ty + (ay - c.clientHeight / 2) / s, zoom: z };
      }
      if (z < FOLLOW_FROM && followRef.current) setFollow(false);
      setUi((u) => ({ ...u, zoom: z }));
      kick();
    },
    [toTrack, baseScale, kick, setFollow],
  );

  const fit = useCallback(() => {
    userZoom.current = 1;
    goal.current = home();
    setFollow(false);
    setUi((u) => ({ ...u, zoom: 1 }));
  }, [home, setFollow]);

  useEffect(() => {
    const c = el.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  const pointers = useRef(new Map<number, [number, number]>());
  const gesture = useRef<{ moved: boolean; pinch: number | null }>({ moved: false, pinch: null });
  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={el}
        className="map-canvas"
        role="img"
        aria-label="Circuit map with car positions. Scroll or pinch to zoom, drag to pan."
        style={{ cursor: ui.zoom > 1 ? 'grab' : 'default', touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, local(e));
          gesture.current = { moved: false, pinch: null };
          if (pointers.current.size === 2) {
            const [a, b2] = [...pointers.current.values()];
            gesture.current.pinch = Math.hypot(a![0] - b2![0], a![1] - b2![1]);
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size === 2 && gesture.current.pinch) {
            const [a, b2] = [...pointers.current.values()];
            const d = Math.hypot(a![0] - b2![0], a![1] - b2![1]);
            zoomAt(d / gesture.current.pinch, (a![0] + b2![0]) / 2, (a![1] + b2![1]) / 2);
            gesture.current.pinch = d;
            gesture.current.moved = true;
            return;
          }
          const dx = p[0] - prev[0];
          const dy = p[1] - prev[1];
          if (!gesture.current.moved && Math.hypot(dx, dy) < 3) return;
          gesture.current.moved = true;
          if (followRef.current) setFollow(false);
          const s = baseScale() * cam.current.zoom;
          cam.current = { ...cam.current, cx: cam.current.cx - dx / s, cy: cam.current.cy + dy / s };
          goal.current = { ...cam.current, zoom: goal.current.zoom };
          draw();
        }}
        onPointerUp={(e) => {
          const p = local(e);
          pointers.current.delete(e.pointerId);
          if (gesture.current.moved || !onPick) return;
          let best: string | null = null;
          let bd = 196;
          for (const car of last.current) {
            const [px, py] = toScreen(car.x, car.y);
            const d = (px - p[0]) ** 2 + (py - p[1]) ** 2;
            if (d < bd) [bd, best] = [d, car.id];
          }
          if (best) onPick(best);
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onDoubleClick={(e) => {
          const [x, y] = local(e as unknown as React.PointerEvent);
          zoomAt(2, x, y);
        }}
      />
      <div className="map-ctrl">
        {ui.zoom >= FOLLOW_FROM && (
          <button
            className="tog"
            aria-pressed={ui.follow}
            disabled={!ui.selected}
            title={ui.selected ? 'Keep the selected cars in view' : 'Select a driver to follow'}
            onClick={() => setFollow(!ui.follow)}
          >
            {ui.follow ? 'Following' : 'Follow'} {ui.selected === 1 ? 'selected car' : 'selected cars'}
          </button>
        )}
        <div className="seg" role="group" aria-label="Map zoom">
          <button onClick={() => zoomAt(1.6)} aria-label="Zoom in" title="Zoom in (or scroll, pinch, double-click)">
            +
          </button>
          <button onClick={() => zoomAt(1 / 1.6)} aria-label="Zoom out" title="Zoom out" disabled={ui.zoom <= MIN_ZOOM + 0.001}>
            −
          </button>
          <button onClick={fit} title="Show the whole circuit" disabled={ui.zoom <= MIN_ZOOM + 0.001 && !ui.follow}>
            Fit circuit
          </button>
        </div>
      </div>
    </div>
  );
});

function strokeRun(g: CanvasRenderingContext2D, outline: TrackOutline, [from, to]: [number, number], P: (x: number, y: number) => [number, number]) {
  const n = outline.x.length - 1;
  g.beginPath();
  for (let i = from, first = true; ; i = (i + 1) % n, first = false) {
    const [px, py] = P(outline.x[i]!, outline.y[i]!);
    if (first) g.moveTo(px, py);
    else g.lineTo(px, py);
    if (i === to) break;
  }
}
