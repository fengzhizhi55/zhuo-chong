"""把多段 webm 的抽样帧合成到深色底，拼成网格预览（验证抠像/水印/几何一致性）。"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

FFMPEG = str(Path(__file__).resolve().parent.parent / ".tools" / "ffmpeg.exe")
W, H = 640, 360


def grab(video: str, ts: float) -> Image.Image:
    r = subprocess.run(
        [FFMPEG, "-y", "-v", "error", "-c:v", "libvpx-vp9", "-ss", str(ts), "-i", video,
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
        capture_output=True,
    )
    if len(r.stdout) < W * H * 4:
        raise RuntimeError(f"取帧失败: {video} @{ts}")
    a = np.frombuffer(r.stdout[: W * H * 4], np.uint8).reshape(H, W, 4)
    return Image.fromarray(a, "RGBA")


def duration_of(video: str) -> float:
    # webm 的时长在 format 段（stream 段常常为空），两处都问一遍
    r = subprocess.run(
        [FFMPEG.replace("ffmpeg", "ffprobe"), "-v", "error",
         "-show_entries", "format=duration:stream=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video],
        capture_output=True, text=True,
    )
    for line in (r.stdout or "").split():
        try:
            v = float(line)
            if v > 0.05:
                return v
        except ValueError:
            continue
    return 10.0


def main() -> int:
    out = sys.argv[1]
    items = [a.split("=", 1) for a in sys.argv[2:]]  # path=label
    cols = 4
    rows = len(items)
    pad = 4
    sheet = Image.new("RGB", (cols * W + (cols + 1) * pad, rows * (H + 22) + (rows + 1) * pad), (26, 28, 32))
    d = ImageDraw.Draw(sheet)
    for r, (path, label) in enumerate(items):
        y0 = pad + r * (H + 22)
        dur = duration_of(path)
        d.text((pad + 4, y0 + 4), f"{label}  ({dur:.2f}s)", fill=(255, 210, 0))
        for c, frac in enumerate((0.02, 0.35, 0.65, 0.95)):
            im = grab(path, frac * dur)
            al = np.asarray(im)[..., 3]
            ys, xs = np.where(al > 40)
            box = ""
            if len(ys):
                box = (f"H={ys.max() - ys.min() + 1:>3} W={xs.max() - xs.min() + 1:>3} "
                       f"feet={ys.max():>3} cx={int(np.median(xs)):>3}")
            sheet.paste(im, (pad + c * (W + pad), y0 + 20), im)
            if r == 0:
                d.text((pad + c * (W + pad) + 4, y0 + 22), f"{frac:.2f}", fill=(120, 220, 255))
            print(f"{label} @{frac:.2f}  alpha min={al.min()} max={al.max()} 透明占比={(al < 16).mean() * 100:.1f}%  {box}")
    sheet.save(out)
    print(f"-> {out} {sheet.size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
