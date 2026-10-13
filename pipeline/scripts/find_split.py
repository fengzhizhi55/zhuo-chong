"""找出"回到中立站姿"的帧：把每帧轮廓和起始帧比，差异越小越接近站姿。

用途：一段视频里含多个动作时，切点必须落在中立站姿上（
这样每段都能独立量身高归一化）。
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_pet_webm import FFMPEG, final_alpha  # noqa: E402

W, H = 1280, 720
GW, GH = 64, 36  # 轮廓签名分辨率


def signature(alpha: np.ndarray) -> np.ndarray:
    m = (alpha > 40).astype(np.float32)
    # 粗粒度降采样：reshape 成 GH x GW 的块后取均值
    m = m[: H // GH * GH, : W // GW * GW].reshape(GH, H // GH, GW, W // GW).mean(axis=(1, 3))
    return m


def main() -> int:
    src = sys.argv[1]
    fps = float(sys.argv[2]) if len(sys.argv) > 2 else 24.0
    r = subprocess.run([FFMPEG.replace("ffmpeg", "ffprobe"), "-v", "error", "-show_entries",
                        "stream=duration", "-select_streams", "v:0", "-of",
                        "default=noprint_wrappers=1:nokey=1", src], capture_output=True, text=True)
    dur = float(r.stdout.strip() or 10.0)
    cmd = [FFMPEG, "-v", "error", "-i", src, "-vf", f"fps={fps},format=rgb24", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = W * H * 3
    sigs, ts = [], []
    i = 0
    while True:
        buf = b""
        while len(buf) < size:
            chunk = p.stdout.read(size - len(buf))
            if not chunk:
                break
            buf += chunk
        if len(buf) < size:
            break
        rgb = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        sigs.append(signature(final_alpha(rgb, True)))
        ts.append(i / fps)
        i += 1
    p.stdout.close()
    p.wait()
    base = sigs[0]
    diffs = [float(np.abs(s - base).mean()) for s in sigs]
    print(f"共 {len(sigs)} 帧 / {ts[-1]:.2f}s（差异越小越接近起始站姿）")
    # 每 0.25s 打一个点
    step = max(1, int(round(fps * 0.25)))
    line = []
    for k in range(0, len(diffs), step):
        line.append(f"{ts[k]:.2f}:{diffs[k]:.3f}")
    for k in range(0, len(line), 8):
        print("  " + "  ".join(line[k : k + 8]))
    # 报告 2.5s 之后的所有局部极小值（候选切点）
    print("局部极小（候选切点）:")
    for k in range(1, len(diffs) - 1):
        if ts[k] < 2.0:
            continue
        if diffs[k] <= diffs[k - 1] and diffs[k] <= diffs[k + 1]:
            # 只在明显更接近基准时报
            if diffs[k] < 0.06:
                print(f"  t={ts[k]:.2f}s  差异={diffs[k]:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
