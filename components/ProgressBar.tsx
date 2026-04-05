"use client";

import { motion } from "framer-motion";

interface ProgressBarProps {
  convergence: number;
  round: number;
  minRounds: number;
  maxRounds: number;
}

export default function ProgressBar({
  convergence,
  round,
  minRounds,
  maxRounds,
}: ProgressBarProps) {
  const percent = Math.max(0, Math.min(Math.round(convergence * 100), 100));

  return (
    <div className="w-full rounded-xl bg-white/90 px-4 py-2.5 shadow-md backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-semibold text-gray-700">
          학습 진행: {percent}%
        </span>
        <span className="text-gray-400">
          {round}회 (최소 {minRounds} / 최대 {maxRounds})
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
