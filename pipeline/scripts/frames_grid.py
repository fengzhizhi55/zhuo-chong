"""均匀抽 N 帧拼成网格（带时间戳），用于辨认一段视频里有几个动作、切点在哪。"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FFMPEG = str(Path(__file__).resolve().parent.parent / ".tools" / "ffmpeg.exe")


def main() -> int:
    src, out, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
    dur = float(sys.argv[4]) if len(sys.argv) > 4 else None
    if dur is None:
        r = subprocess.run([FFMPEG.replace("ffmpeg", "ffprobe"), "-v", "error", "-show_entries",
                            "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", src],
                           capture_output=True, text=True)
        dur = float(r.stdout.strip() or 10)
    cols = 5
    tw, th = 400, 225
    rows = (n + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * 4, rows * (th + 20) + 8), (24, 26, 30))
    d = ImageDraw.Draw(sheet)
    for i in range(n):
        ts = dur * i / n + dur / (2 * n)
        png = Path(out).parent / f"_f{i}.png"
        subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", f"{ts:.3f}", "-i", src, "-frames:v", "1", str(png)],
                       capture_output=True)
        im = Image.open(png).convert("RGB").resize((tw, th), Image.LANCZOS)
        r_, c_ = divmod(i, cols)
        x, y = 4 + c_ * (tw + 4), 4 + r_ * (th + 20)
        sheet.paste(im, (x, y + 16))
        d.text((x + 4, y + 2), f"{i}: t={ts:.2f}s", fill=(255, 210, 0))
        png.unlink(missing_ok=True)
    sheet.save(out)
    print(f"duration={dur:.2f}s -> {out} {sheet.size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
