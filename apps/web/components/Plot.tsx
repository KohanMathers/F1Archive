export interface PlotSeries {
  name: string;
  colour: string;
  x: number[];
  y: (number | null)[];
  right?: boolean;
}

function ticks(a: number, b: number, n = 5): number[] {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [a];
  const raw = (b - a) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (b - a) / s <= n) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Number(v.toFixed(9)));
  return out;
}

function extent(v: number[], trim: boolean): [number, number] {
  if (!v.length) return [0, 1];
  const s = [...v].sort((p, q) => p - q);
  const lo = trim ? s[Math.floor(s.length * 0.02)]! : s[0]!;
  const hi = trim ? s[Math.max(0, Math.ceil(s.length * 0.98) - 1)]! : s.at(-1)!;
  const pad = (hi - lo) * 0.08 || 1;
  return [lo - pad, hi + pad];
}

const LEFT = 64;
const RIGHT_W = 44;
const BOTTOM = 18;

export function Plot({
  series,
  height = 180,
  xLabel,
  yFormat = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)),
  trim = false,
}: {
  series: PlotSeries[];
  height?: number;
  xLabel: string;
  yFormat?: (v: number) => string;
  trim?: boolean;
}) {
  const hasRight = series.some((s) => s.right);
  const right = hasRight ? RIGHT_W : 0;
  const plotH = height - BOTTOM;
  const xs = series.flatMap((s) => s.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yl = extent(series.filter((s) => !s.right).flatMap((s) => s.y.filter((v): v is number => v != null)), trim);
  const yr = extent(series.filter((s) => s.right).flatMap((s) => s.y.filter((v): v is number => v != null)), trim);
  const W = 1000;
  const fx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const fy = (y: number, r?: boolean) => {
    const [a, b] = r ? yr : yl;
    return (1 - (y - a) / (b - a || 1)) * plotH;
  };
  const xPct = (x: number) => `${((x - x0) / (x1 - x0 || 1)) * 100}%`;
  const label: React.CSSProperties = { position: 'absolute', font: '400 11px/12px var(--mono)', color: 'var(--muted)', whiteSpace: 'nowrap' };

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ position: 'relative', height, paddingLeft: LEFT, paddingRight: right }}>
        {ticks(yl[0], yl[1]).map((t) => (
          <span key={`l${t}`} style={{ ...label, left: 0, width: LEFT - 8, textAlign: 'right', top: fy(t) - 6 }}>
            {yFormat(t)}
          </span>
        ))}
        {hasRight &&
          ticks(yr[0], yr[1]).map((t) => (
            <span key={`r${t}`} style={{ ...label, right: 0, width: RIGHT_W - 8, top: fy(t, true) - 6 }}>
              {t}
            </span>
          ))}
        <div style={{ position: 'relative', height: plotH }}>
          <svg viewBox={`0 0 ${W} ${plotH}`} width="100%" height={plotH} preserveAspectRatio="none" style={{ display: 'block', overflow: 'hidden' }} role="img" aria-label={series.map((s) => s.name).join(', ')}>
            {ticks(yl[0], yl[1]).map((t) => (
              <line key={t} x1={0} x2={W} y1={fy(t)} y2={fy(t)} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s) => {
              let d = '';
              let pen = false;
              s.x.forEach((x, i) => {
                const v = s.y[i];
                if (v == null) return void (pen = false);
                d += `${pen ? 'L' : 'M'}${fx(x).toFixed(1)} ${fy(v, s.right).toFixed(1)}`;
                pen = true;
              });
              return <path key={s.name} d={d} fill="none" stroke={s.colour} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
          {ticks(x0, x1, 8).map((t) => (
            <span key={`x${t}`} style={{ ...label, top: plotH + 4, left: xPct(t), transform: 'translateX(-50%)' }}>
              {Math.round(t)}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="row t-small t-muted" style={{ gap: 16, marginTop: 6 }}>
        {series.map((s) => (
          <span key={s.name} className="row" style={{ gap: 6 }}>
            <span style={{ width: 12, height: 2, background: s.colour }} />
            {s.name}
            {s.right ? ' (right scale)' : ''}
          </span>
        ))}
        <span>Horizontal: {xLabel}</span>
        {trim && <span>Vertical scale ignores the slowest and fastest 2%.</span>}
      </figcaption>
    </figure>
  );
}
