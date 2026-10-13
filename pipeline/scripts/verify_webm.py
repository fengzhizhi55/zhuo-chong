"""校验产物：alpha 是否真实存在 + 合成到深色底上出一张预览图。"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

FFMPEG = str(Path(__file__).resolve().parent.parent / ".tools" / "ffmpeg.exe")
CANVAS_W, CANVAS_H = 640, 360


def grab(video: str, ts: float) -> Image.Image:
    r = subprocess.run(
        [FFMPEG, "-y", "-v", "error", "-c:v", "libvpx-vp9", "-ss", str(ts), "-i", video,
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
        capture_output=True,
    )
    if r.returncode != 0 or len(r.stdout) < CANVAS_W * CANVAS_H * 4:
        raise RuntimeError(r.stderr.decode("utf-8", "replace"))
    a = np.frombuffer(r.stdout[: CANVAS_W * CANVAS_H * 4], np.uint8).reshape(CANVAS_H, CANVAS_W, 4)
    return Image.fromarray(a, "RGBA")


def main() -> int:
    video = sys.argv[1]
    out = sys.argv[2]
    shots = []
    for ts in (0.2, 1.0, 2.0, 3.0, float(sys.argv[3]) if len(sys.argv) > 3 else 3.8):
        im = grab(video, ts)
        al = np.asarray(im)[..., 3]
        print(f"t={ts:>4}s  alpha min={al.min():3d} max={al.max():3d} mean={al.mean():5.1f}  "
              f"透明像素占比={(al < 16).mean() * 100:5.1f}%")
        shots.append(im)
    # 拼一张：深色底 + 浅色底，各排一半
    cols = len(shots)
    sheet = Image.new("RGB", (cols * CANVAS_W, CANVAS_H * 2), (28, 30, 34))
    light = Image.new("RGB", (cols * CANVAS_W, CANVAS_H), (238, 238, 240))
    for i, im in enumerate(shots):
        sheet.paste(im, (i * CANVAS_W, 0), im)
        light.paste(im, (i * CANVAS_W, 0), im)
    sheet.paste(light, (0, CANVAS_H))
    sheet.save(out)
    print(f"预览图 → {out} ({sheet.size[0]}x{sheet.size[1]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
