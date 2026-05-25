"""
generate-branch-charts.py
=========================
Branch별 수치 자료 차트 생성 (PNG)
  out/simulation/branch-flat.png       — F1~F4
  out/simulation/branch-hierarchy.png  — H1~H4
  out/simulation/branch-active.png     — A1~A4

각 PNG는 막대 그래프(평균 수렴 라운드) + 수렴 곡선을 포함.
생성된 PNG는 PPT에 직접 삽입 가능.

Usage: python scripts/generate-branch-charts.py
"""

import csv
import json
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import matplotlib.patches as mpatches
import numpy as np

# ── 한글 폰트 설정 (Windows: 맑은 고딕) ─────────────────────────────────────────
_KR_FONTS = ["Malgun Gothic", "NanumGothic", "AppleGothic", "Gulim"]
for _f in _KR_FONTS:
    if any(_f.lower() in p.lower() for p in fm.findSystemFonts()):
        matplotlib.rcParams["font.family"] = _f
        break
matplotlib.rcParams["axes.unicode_minus"] = False

BASE = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
SIM_DIR = os.path.join(BASE, "out", "simulation")

# ── 색상 ──────────────────────────────────────────────────────────────────────
BRANCH_COLOR = {
    "flat":      "#6B9BD2",
    "hierarchy": "#5CB85C",
    "active":    "#E8533A",
}
HIGHLIGHT_COLOR = "#C03020"   # A4
DIM_COLOR       = "#AAAAAA"   # 미도달

BRANCH_ACCENT = {
    "flat":      "#3A70B0",
    "hierarchy": "#2E8B2E",
    "active":    "#C03020",
}

COSINE_TARGET = 0.85

BRANCH_TITLE = {
    "flat":      "방향 1 — 기본 방식 (F1~F4)\n22가지 항목을 한꺼번에 학습",
    "hierarchy": "방향 2 — 계층 방식 (H1~H4)\n큰 범주 먼저, 세부 항목 나중에 학습",
    "active":    "방향 3 — 질문 방식 개선 (A1~A3)  [최종 모델: A3]\n더 좋은 비교쌍 선택 방식 적용",
}

# ── 데이터 로드 ────────────────────────────────────────────────────────────────

def load_summary(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "variant":          row["variant"],
                "label":            row["label"],
                "branch":           row["branch"],
                "reachRate":        float(row["reachRate(%)"]),
                # avgReachedRound = 전체 run 평균 (항상 수치 존재)
                "avgReachedRound":  float(row["avgReachedRound"]),
                "avgTotalRounds":   float(row["avgTotalRounds"]),
                "avgMaxCosine":     float(row["avgMaxCosine"]),
                "stdReachedRound":  None if row["stdReachedRound"] == "N/A"
                                    else float(row["stdReachedRound"]),
            })
    return rows


def load_run_records(path):
    """variant_comparison.json -> {variantId: [{cosineMaxValue, cosineReachedRound, totalRounds}, ...]}"""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    result = {}
    for rec in data.get("records", []):
        vid = rec["variant"]
        if vid not in result:
            result[vid] = []
        result[vid].append({
            "cosineMaxValue":    rec.get("cosineMaxValue", 0),
            "cosineReachedRound": rec.get("cosineReachedRound"),  # None if not reached
            "totalRounds":       rec.get("totalRounds", 200),
        })
    return result


# ── 차트 함수 ──────────────────────────────────────────────────────────────────

def draw_branch_chart(branch: str, summaries: list, run_records: dict, out_path: str):
    EXCLUDE = {"A4"}   # A4 제외
    variants = [s for s in summaries if s["branch"] == branch
                and s["variant"] not in EXCLUDE]
    vids     = [v["variant"] for v in variants]

    fig, (ax_bar, ax_curve) = plt.subplots(
        2, 1, figsize=(10, 9),
        gridspec_kw={"height_ratios": [1, 1], "hspace": 0.45},
        facecolor="#FAFAFA",
    )
    fig.suptitle(BRANCH_TITLE[branch], fontsize=14, fontweight="bold",
                 color="#111111", y=0.98)

    accent = BRANCH_ACCENT[branch]
    base_c = BRANCH_COLOR[branch]

    # ── 막대 그래프 ────────────────────────────────────────────────────────────
    ax_bar.set_facecolor("white")
    ax_bar.set_axisbelow(True)
    ax_bar.yaxis.grid(True, linestyle="--", linewidth=0.6, color="#DDDDDD")

    bar_vals  = []
    bar_errs  = []
    bar_cols  = []
    bar_alphas = []

    for v in variants:
        # avgReachedRound = 전체 run 평균 (항상 수치 존재)
        val = v["avgReachedRound"]
        bar_vals.append(val)
        bar_errs.append(v["stdReachedRound"] if v["stdReachedRound"] else 0)

        is_final = (v["variant"] == "A3")
        bar_cols.append(HIGHLIGHT_COLOR if is_final else base_c)
        bar_alphas.append(1.0)  # 항상 불투명

    x = np.arange(len(vids))
    bars = ax_bar.bar(x, bar_vals, color=bar_cols, width=0.55, zorder=3,
                      edgecolor="white", linewidth=0.8)
    for bar, alpha in zip(bars, bar_alphas):
        bar.set_alpha(alpha)

    # 오차막대
    for xi, (val, err, alpha) in enumerate(zip(bar_vals, bar_errs, bar_alphas)):
        if err > 0:
            ax_bar.errorbar(xi, val, yerr=err, fmt="none",
                            ecolor="#444", elinewidth=1.2, capsize=4,
                            alpha=alpha, zorder=4)

    # 막대 위 수치 (성공률 + 달성 횟수)
    for xi, v in enumerate(variants):
        rate = v["reachRate"]
        yval = bar_vals[xi]
        # 성공률
        ax_bar.text(xi, yval + max(bar_vals) * 0.02,
                    f"{rate:.0f}%",
                    ha="center", va="bottom", fontsize=10, fontweight="bold",
                    color=bar_cols[xi])
        # 달성 횟수 (항상 표시)
        ax_bar.text(xi, yval / 2,
                    f"{yval:.1f}회",
                    ha="center", va="center", fontsize=9, color="white",
                    fontweight="bold")

    ax_bar.set_xticks(x)
    ax_bar.set_xticklabels(vids, fontsize=11)
    ax_bar.set_ylabel("평균 달성 횟수 (전체 run)", fontsize=11)
    ax_bar.set_title(f"평균 달성 횟수 — 정확도 {COSINE_TARGET} 도달 기준 (미달성 run은 최대 회차 포함)", fontsize=11)
    ax_bar.spines[["top", "right"]].set_visible(False)

    # 최대 코사인 보조 표시
    ax2 = ax_bar.twinx()
    cos_vals = [v["avgMaxCosine"] for v in variants]
    ax2.plot(x, cos_vals, "D--", color=accent,
             markersize=6, linewidth=1.2, label="평균 최대 코사인", alpha=0.7)
    ax2.set_ylim(0.5, 1.05)
    ax2.set_ylabel("평균 최대 코사인 유사도", fontsize=10, color=accent)
    ax2.tick_params(axis="y", colors=accent, labelsize=9)
    ax2.spines[["top"]].set_visible(False)

    for xi, cv in enumerate(cos_vals):
        ax2.text(xi + 0.18, cv + 0.005, f"{cv:.3f}",
                 fontsize=8, color=accent, alpha=0.9)

    # ── 하단: 개별 run 최대 코사인 dot plot ───────────────────────────────────
    ax_curve.set_facecolor("white")
    ax_curve.set_axisbelow(True)
    ax_curve.yaxis.grid(True, linestyle="--", linewidth=0.6, color="#DDDDDD")
    ax_curve.axhline(COSINE_TARGET, color="#E8533A", linewidth=1.5, linestyle="--",
                     label=f"목표 정확도 {COSINE_TARGET}", zorder=5)

    n = len(vids)
    for ki, vid in enumerate(vids):
        runs = run_records.get(vid, [])
        if not runs:
            continue

        is_final = (vid == "A3")
        shade_factor = 0.45 + 0.55 * (ki / max(n - 1, 1))
        r = int(int(base_c[1:3], 16) * shade_factor + 255 * (1 - shade_factor))
        g = int(int(base_c[3:5], 16) * shade_factor + 255 * (1 - shade_factor))
        b = int(int(base_c[5:7], 16) * shade_factor + 255 * (1 - shade_factor))
        col = HIGHLIGHT_COLOR if is_final else f"#{min(r,255):02X}{min(g,255):02X}{min(b,255):02X}"

        cos_vals_run  = [rec["cosineMaxValue"] for rec in runs]
        reached_flags = [rec["cosineReachedRound"] is not None for rec in runs]

        # jitter x
        jitter = np.random.uniform(-0.15, 0.15, len(cos_vals_run))
        for jx, (cv, reached) in zip(jitter, zip(cos_vals_run, reached_flags)):
            marker = "o" if reached else "x"
            alpha  = 0.9 if reached else 0.5
            ax_curve.scatter(ki + jx, cv, color=col, marker=marker,
                             s=40, alpha=alpha, zorder=4,
                             linewidths=1.5 if marker == "x" else 0.5)

        # 평균선
        mean_cos = np.mean(cos_vals_run)
        ax_curve.hlines(mean_cos, ki - 0.3, ki + 0.3,
                        colors=col, linewidths=2.0, zorder=5)
        ax_curve.text(ki + 0.35, mean_cos, f"{mean_cos:.3f}",
                      fontsize=8.5, color=col, va="center",
                      fontweight="bold" if is_final else "normal")

    ax_curve.set_xticks(range(n))
    ax_curve.set_xticklabels(vids, fontsize=11)
    ax_curve.set_xlim(-0.6, n - 0.3)
    ax_curve.set_ylim(0.55, 1.02)
    ax_curve.set_ylabel("최대 코사인 유사도 (run별)", fontsize=11)
    ax_curve.set_title(f"개별 run 최대 정확도 분포  (o=목표 달성, x=미달성, 가로선=평균)", fontsize=11)

    from matplotlib.lines import Line2D
    legend_handles = [
        Line2D([0], [0], marker="o", color="w", markerfacecolor="#888",
               markersize=8, label=f"목표 달성 (정확도 ≥ {COSINE_TARGET})"),
        Line2D([0], [0], marker="x", color="#888", markersize=8,
               markeredgewidth=1.5, label="미달성"),
        Line2D([0], [0], color="#E8533A", linewidth=1.5,
               linestyle="--", label=f"목표선 {COSINE_TARGET}"),
    ]
    ax_curve.legend(handles=legend_handles, loc="lower right",
                    fontsize=9, framealpha=0.8)
    ax_curve.spines[["top", "right"]].set_visible(False)

    plt.savefig(out_path, dpi=150, bbox_inches="tight",
                facecolor="#FAFAFA")
    plt.close(fig)
    print(f"  saved: {out_path}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    summary_path = os.path.join(SIM_DIR, "variant-summary.csv")
    records_path = os.path.join(SIM_DIR, "variant-comparison.json")

    summaries   = load_summary(summary_path)
    run_records = load_run_records(records_path)

    for branch in ["flat", "hierarchy", "active"]:
        out = os.path.join(SIM_DIR, f"branch-{branch}.png")
        draw_branch_chart(branch, summaries, run_records, out)

    print("Done. Files:")
    print("  out/simulation/branch-flat.png")
    print("  out/simulation/branch-hierarchy.png")
    print("  out/simulation/branch-active.png")


if __name__ == "__main__":
    main()
