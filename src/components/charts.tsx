import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   Charts as plain inline SVG, rendered on the server.
   No chart library: these four shapes cover every visualisation the product
   needs, weigh about 2 KB of markup, add zero JavaScript, and theme
   themselves from the CSS custom properties like everything else.

   Tooltips are native SVG <title> elements — the browser shows them on hover
   with no event handlers and therefore no client component.
   --------------------------------------------------------------------------- */

export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

/** Deterministic id so server markup and any later hydration agree. */
function seedId(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export type Datum = { label: string; value: number };

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/* --- area / line ---------------------------------------------------------- */

export function AreaChart({
  data,
  height = 180,
  format = (n: number) => String(Math.round(n)),
  color = "var(--series-1)",
  className,
}: {
  data: Datum[];
  height?: number;
  format?: (n: number) => string;
  color?: string;
  className?: string;
}) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const W = 640;
  const H = height;
  const padL = 44;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${padT + innerH} L${padL},${padT + innerH} Z`;
  const gid = `area-${seedId(data.map((d) => d.label).join())}`;

  // Keep the x axis readable: never more than ~7 labels.
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const gy = padT + innerH * t;
        return (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={gy}
              y2={gy}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={gy + 3.5}
              textAnchor="end"
              fontSize="10"
              fill="var(--fg-subtle)"
            >
              {format(max * (1 - t))}
            </text>
          </g>
        );
      })}

      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {data.map((d, i) => (
        <g key={`${d.label}-${i}`}>
          <circle cx={x(i)} cy={y(d.value)} r="3" fill="var(--surface)" stroke={color} strokeWidth="2" />
          {/* Generous invisible hit area so the tooltip is easy to reach. */}
          <rect
            x={x(i) - stepX / 2}
            y={padT}
            width={Math.max(stepX, 8)}
            height={innerH}
            fill="transparent"
          >
            <title>{`${d.label}: ${format(d.value)}`}</title>
          </rect>
          {i % labelEvery === 0 && (
            <text
              x={x(i)}
              y={H - 7}
              textAnchor="middle"
              fontSize="10"
              fill="var(--fg-subtle)"
            >
              {d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/* --- vertical bars -------------------------------------------------------- */

export function BarChart({
  data,
  height = 180,
  format = (n: number) => String(Math.round(n)),
  color = "var(--series-1)",
  colors,
}: {
  data: Datum[];
  height?: number;
  format?: (n: number) => string;
  color?: string;
  colors?: string[];
}) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const W = 640;
  const H = height;
  const padL = 44;
  const padR = 8;
  const padT = 10;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const slot = innerW / data.length;
  const barW = Math.min(44, slot * 0.6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img">
      {[0, 0.5, 1].map((t) => {
        const gy = padT + innerH * t;
        return (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={gy} y2={gy} stroke="var(--border)" />
            <text
              x={padL - 8}
              y={gy + 3.5}
              textAnchor="end"
              fontSize="10"
              fill="var(--fg-subtle)"
            >
              {format(max * (1 - t))}
            </text>
          </g>
        );
      })}

      {data.map((d, i) => {
        const h = (d.value / max) * innerH;
        const bx = padL + slot * i + (slot - barW) / 2;
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={bx}
              y={padT + innerH - h}
              width={barW}
              height={Math.max(h, d.value > 0 ? 2 : 0)}
              rx="4"
              fill={colors?.[i % colors.length] ?? color}
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            <text
              x={bx + barW / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--fg-subtle)"
            >
              {d.label.length > 9 ? `${d.label.slice(0, 8)}…` : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* --- horizontal bars (good for long category names) ---------------------- */

export function RowBars({
  data,
  format = (n: number) => String(Math.round(n)),
  colors,
}: {
  data: Datum[];
  format?: (n: number) => string;
  colors?: string[];
}) {
  if (data.length === 0) {
    return <p className="text-sm text-fg-subtle py-6 text-center">No data yet.</p>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={`${d.label}-${i}`}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-[0.8125rem] truncate">{d.label}</span>
            <span className="text-[0.8125rem] font-semibold tnum shrink-0">
              {format(d.value)}
            </span>
          </div>
          <div className="progress">
            <span
              style={{
                width: `${(d.value / max) * 100}%`,
                background: colors?.[i % colors.length] ?? SERIES[i % SERIES.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* --- donut ---------------------------------------------------------------- */

export function DonutChart({
  data,
  size = 168,
  thickness = 18,
  centerLabel,
  centerValue,
}: {
  data: (Datum & { color?: string })[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--surface-hover)"
            strokeWidth={thickness}
          />
          {total > 0 &&
            data.map((d, i) => {
              const len = (d.value / total) * c;
              const dash = `${len} ${c - len}`;
              const node = (
                <circle
                  key={`${d.label}-${i}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={d.color ?? SERIES[i % SERIES.length]}
                  strokeWidth={thickness}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </circle>
              );
              offset += len;
              return node;
            })}
        </g>
        {(centerValue || centerLabel) && (
          <>
            <text
              x="50%"
              y="47%"
              textAnchor="middle"
              fontSize="20"
              fontWeight="650"
              fill="var(--fg)"
            >
              {centerValue}
            </text>
            <text x="50%" y="62%" textAnchor="middle" fontSize="10" fill="var(--fg-subtle)">
              {centerLabel}
            </text>
          </>
        )}
      </svg>

      <ul className="space-y-1.5 min-w-40">
        {data.map((d, i) => (
          <li key={`${d.label}-${i}`} className="flex items-center gap-2 text-[0.8125rem]">
            <span
              className="h-2.5 w-2.5 rounded-sm shrink-0"
              style={{ background: d.color ?? SERIES[i % SERIES.length] }}
            />
            <span className="text-fg-muted flex-1 capitalize">
              {d.label.replace(/_/g, " ")}
            </span>
            <span className="font-semibold tnum">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --- sparkline ------------------------------------------------------------ */

export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = "var(--series-1)",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${i * stepX},${height - ((v - min) / span) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div
      className="grid place-items-center text-sm text-fg-subtle"
      style={{ height }}
    >
      Not enough data to chart yet.
    </div>
  );
}
