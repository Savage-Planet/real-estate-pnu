"""Patch generate-ppt.py: replace svg_placeholder calls with add_image."""
import os

path = os.path.join(os.path.dirname(__file__), "generate-ppt.py")

with open(path, encoding="utf-8") as f:
    c = f.read()

patches = [
    (
        '    # SVG placeholder (right 40%)\n'
        '    svg_placeholder(sl, "variant-chart.svg",\n'
        '                    "F1~F4 막대 차트 (variant-chart.svg 상단 F열 부분)",\n'
        '                    Inches(0.45), Inches(4.35), Inches(12.4), Inches(1.9))',
        '    # Branch-flat chart\n'
        '    add_image(sl, os.path.join(SIM_DIR, "branch-flat.png"),\n'
        '              Inches(0.45), Inches(4.35), Inches(12.4), Inches(2.0))',
    ),
    (
        '    # SVG placeholder (bottom)\n'
        '    svg_placeholder(sl, "virtual-comparison-curve.svg",\n'
        '                    "가상 아이템 효과 비교 곡선 (H3 vs H4 수렴 속도)",\n'
        '                    Inches(0.45), Inches(4.6), Inches(12.4), Inches(1.8))',
        '    # Branch-hierarchy chart\n'
        '    add_image(sl, os.path.join(SIM_DIR, "branch-hierarchy.png"),\n'
        '              Inches(0.45), Inches(4.6), Inches(12.4), Inches(1.9))',
    ),
    (
        '    # SVG placeholder\n'
        '    svg_placeholder(sl, "variant-chart.svg",\n'
        '                    "A1~A4 막대 차트 (variant-chart.svg 하단 A열 부분)",\n'
        '                    Inches(0.45), Inches(3.75), Inches(12.4), Inches(2.6))',
        '    # Branch-active chart\n'
        '    add_image(sl, os.path.join(SIM_DIR, "branch-active.png"),\n'
        '              Inches(0.45), Inches(3.75), Inches(12.4), Inches(2.5))',
    ),
    (
        '    # Large SVG placeholder\n'
        '    svg_placeholder(sl, "variant-chart.svg",\n'
        '                    "전체 12개 모델 막대 + 수렴 곡선 차트",\n'
        '                    Inches(0.45), Inches(1.4), Inches(12.4), Inches(4.0))',
        '    # Full variant-chart SVG (insert manually)\n'
        '    svg_placeholder(sl, "variant-chart.svg", "full chart",\n'
        '                    Inches(0.45), Inches(1.4), Inches(12.4), Inches(4.0))',
    ),
]

for old, new in patches:
    if old in c:
        c = c.replace(old, new)
        print("patched:", repr(old[:50]))
    else:
        print("NOT FOUND:", repr(old[:50]))

with open(path, "w", encoding="utf-8") as f:
    f.write(c)
print("done")
