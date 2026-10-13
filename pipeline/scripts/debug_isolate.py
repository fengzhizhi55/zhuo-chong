"""调试：看 isolate_character 到底滤掉了什么。输出三联图：原帧 / alpha / 滤波后 alpha。"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_pet_webm import FFMPEG, alpha_from_rgb, isolate_character  # noqa: E402

W, H = 1280, 720


def main() -> int:
    src, ts, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    r = subprocess.run([FFMPEG, "-v", "error", "-ss", str(ts), "-i", src, "-frames:v", "1",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True)
    rgb = np.frombuffer(r.stdout[: W * H * 3], np.uint8).reshape(H, W, 3)
    a0 = alpha_from_rgb(rgb)
    a1 = isolate_character(a0)
    m0 = (a0 > 40)
    m1 = (a1 > 40)
    print(f"t={ts}  不透明像素: 抠像后={m0.sum()} → 滤波后={m1.sum()}  (去掉 {m0.sum()-m1.sum()})")
    # 连通块排行（看清楚保留/丢弃了哪些块）
    from make_pet_webm import _components
    comps = _components(m0)
    biggest = comps[0][0] if comps else 0
    print(f"  连通块数={len(comps)}  最大块={biggest}px  保留门槛={biggest*0.05:.0f}px")
    for i, (area, runs) in enumerate(comps[:8]):
        ys = [r[0] for r in runs]
        x0 = min(r[1] for r in runs)
        x1 = max(r[2] for r in runs)
        print(f"    #{i} 面积={area:>7} x={x0}..{x1} y={min(ys)}..{max(ys)}  "
              f"{'保留' if area >= biggest*0.05 else '丢弃'}")
    # 被去掉的像素集中在哪
    gone = m0 & ~m1
    if gone.sum():
        ys, xs = np.where(gone)
        print(f"  被滤掉的区域: x={xs.min()}..{xs.max()} y={ys.min()}..{ys.max()}")
        # 按 100x100 网格统计 Top 区域
        grid = {}
        for x, y in zip(xs[::37], ys[::37]):
            grid[(x // 100 * 100, y // 100 * 100)] = grid.get((x // 100 * 100, y // 100 * 100), 0) + 1
        top = sorted(grid.items(), key=lambda kv: -kv[1])[:8]
        print("  热点格 (x,y)→样本数:", top)
    # 三联图
    def rgba_of(alpha):
        return np.dstack([rgb, alpha])
    panels = [Image.fromarray(rgb, "RGB"),
              Image.fromarray(rgba_of(a0), "RGBA").convert("RGB"),
              Image.fromarray(rgba_of(a1), "RGBA").convert("RGB")]
    sheet = Image.new("RGB", (W, H * 3 + 16), (20, 20, 22))
    for i, p in enumerate(panels):
        sheet.paste(p, (0, i * (H + 8)))
    sheet.save(out)
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
