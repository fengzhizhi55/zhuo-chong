"""多段视频各抽 4 帧，拼成一张总览图（每行一段）。"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FFMPEG = str(Path(__file__).resolve().parent.parent / ".tools" / "ffmpeg.exe")
PROBE = str(Path(__file__).resolve().parent.parent / ".tools" / "ffprobe.exe")


def dur_of(f: str) -> float:
    r = subprocess.run([PROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", f], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 10.0


def main() -> int:
    out, items = sys.argv[1], sys.argv[2:]
    tw, th = 400, 225
    cols = 4
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * 5, len(items) * (th + 22) + 8), (22, 24, 28))
    d = ImageDraw.Draw(sheet)
    for r, f in enumerate(items):
        dur = dur_of(f)
        lab = Path(f).stem[:34]
        y = 4 + r * (th + 22)
        fr = [dur * k / cols + dur / (2 * cols) for k in range(cols)]
        pngs = []
        for k, ts in enumerate(fr):
            p = Path(out).parent / f"_g{r}_{k}.png"
            subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", f"{ts:.3f}", "-i", f, "-frames:v", "1", str(p)],
                           capture_output=True)
            im = Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS)
            sheet.paste(im, (5 + k * (tw + 5), y + 18))
            pngs.append(p)
        d.text((6, y + 3), f"{lab}  ({dur:.2f}s)", fill=(255, 210, 0))
        print(f"{r}: {lab} {dur:.2f}s frames at " + ", ".join(f"{t:.2f}" for t in fr))
        for p in pngs:
            p.unlink(missing_ok=True)
    sheet.save(out)
    print("->", out, sheet.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
