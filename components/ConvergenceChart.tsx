"use client";

import type { RoundMetrics } from "@/lib/convergence";

interface ConvergenceChartProps {
  data: RoundMetrics[];
}

const COLORS = {
  evr: "#6366f1",
  concentration: "#10b981",
  topKStability: "#f59e0b",
};

const LABELS = {
  evr: "EVR (정보가치)",
  concentration: "사후분포 집중도",
  topKStability: "Top-K 안정도",
};

const W = 320;
const H = 160;
const PAD = { top: 12, right: 12, bottom: 28, left: 36 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

function toPath(
  data: RoundMetrics[],
  key: keyof Pick<RoundMetrics, "evr" | "concentration" | "topKStability">,
  maxRound: number,
  yMax: number,
): string {
  return data
    .map((d, i) => {
      const x = PAD.left + (d.round / maxRound) * plotW;
      const val = Math.min(d[key], yMax);
      const y = PAD.top + plotH - (val / yMax) * plotH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join("");
}

export default function ConvergenceChart({ data }: ConvergenceChartProps) {
  if (data.length < 2) return null;

  const maxRound = data[data.length - 1].round;
  const maxEvr = Math.max(...data.map((d) => d.evr), 0.05);
  const yMax = Math.max(maxEvr, 1);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].filter((v) => v <= yMax);

  const roundTicks: number[] = [];
  const step = Math.max(1, Math.ceil(maxRound / 6));
  for (let r = 1; r <= maxRound; r += step) roundTicks.push(r);
  if (roundTicks[roundTicks.length - 1] !== maxRound) roundTicks.push(maxRound);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto w-full max-w-[400px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* grid */}
        {yTicks.map((v) => {
          const y = PAD.top + plotH - (v / yMax) * plotH;
          return (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={0.5}
              />
              <text
                x={PAD.left - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-gray-400"
                fontSize={8}
              >
                {v.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* x-axis labels */}
        {roundTicks.map((r) => {
          const x = PAD.left + (r / maxRound) * plotW;
          return (
            <text
              key={r}
              x={x}
              y={H - 4}
              textAnchor="middle"
              className="fill-gray-400"
              fontSize={8}
            >
              {r}
            </text>
          );
        })}
        <text
          x={PAD.left + plotW / 2}
          y={H}
          textAnchor="middle"
          className="fill-gray-500"
          fontSize={7}
        >
          비교 라운드
        </text>

        {/* lines */}
        <path
          d={toPath(data, "evr", maxRound, yMax)}
          fill="none"
          stroke={COLORS.evr}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={toPath(data, "concentration", maxRound, yMax)}
          fill="none"
          stroke={COLORS.concentration}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={toPath(data, "topKStability", maxRound, yMax)}
          fill="none"
          stroke={COLORS.topKStability}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4,2"
        />

        {/* dots for last point */}
        {(["evr", "concentration", "topKStability"] as const).map((key) => {
          const last = data[data.length - 1];
          const x = PAD.left + (last.round / maxRound) * plotW;
          const val = Math.min(last[key], yMax);
          const y = PAD.top + plotH - (val / yMax) * plotH;
          return (
            <circle
              key={key}
              cx={x}
              cy={y}
              r={3}
              fill={COLORS[key]}
            />
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {(["evr", "concentration", "topKStability"] as const).map((key) => (
          <span key={key} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ backgroundColor: COLORS[key] }}
            />
            {LABELS[key]}
            <span className="font-mono text-gray-400">
              {data[data.length - 1][key].toFixed(3)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
