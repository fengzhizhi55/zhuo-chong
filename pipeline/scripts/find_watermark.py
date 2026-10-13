"""定位水印：抠像后仍在"人物中心区之外"的不透明像素 = 水印/UI 残留。

用法：python find_watermark.py <视频> [帧数]
输出：每个聚集区域的包围盒（1280x720 原始坐标），供 --delogo 使用。
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_pet_webm import FFMPEG, alpha_from_rgb  # noqa: E402

W, H = 1280, 720
# 人物中心区（这些范围内即使不透明也不当水印）
CENTER = (300, 1000, 0, 720)


def main() -> int:
    src = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    dur = 10.0
    acc = None
    for i in range(n):
        ts = dur * (i + 0.5) / n
        r = subprocess.run(
            [FFMPEG, "-v", "error", "-ss", str(ts), "-i", src, "-frames:v", "1",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True,
        )
        if len(r.stdout) < W * H * 3:
            continue
        rgb = np.frombuffer(r.stdout[: W * H * 3], np.uint8).reshape(H, W, 3)
        a = alpha_from_rgb(rgb) > 40
        acc = a if acc is None else (acc & a)  # 多帧取交集：静态水印才留下
    if acc is None:
        print("没有取到帧")
        return 1
    ys, xs = np.where(acc)
    outside = (xs < CENTER[0]) | (xs > CENTER[1])
    xs_o, ys_o = xs[outside], ys[outside]
    if len(xs_o) == 0:
        print("中心区之外没有残留 ✓（水印可能已在中心区内或不明显）")
        return 0
    # 简单聚类：按 x 分三档（左/右），y 分两档，报告每档的包围盒
    groups = {}
    for x, y in zip(xs_o, ys_o):
        key = ("L" if x < W // 2 else "R") + ("T" if y < H // 2 else "B")
        g = groups.setdefault(key, [x, y, x, y, 0])
        g[0], g[1] = min(g[0], x), min(g[1], y)
        g[2], g[3] = max(g[2], x), max(g[3], y)
        g[4] += 1
    print(f"{src}")
    for k in sorted(groups):
        x1, y1, x2, y2, c = groups[k]
        if c < 30:
            continue
        pad = 12
        bx1, by1 = max(0, x1 - pad), max(0, y1 - pad)
        bx2, by2 = min(W, x2 + pad), min(H, y2 + pad)
        print(f"  区域{k}: 像素={c}  包围盒=({bx1},{by1},{bx2-bx1},{by2-by1})  [x={bx1}..{bx2} y={by1}..{by2}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
