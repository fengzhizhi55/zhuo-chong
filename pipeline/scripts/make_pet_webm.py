"""即梦绿幕视频 → 桌宠透明动画（640x360 VP9-alpha webm）。

等价于 dsh-pet 仓库的 chroma_step02 + normalize_step03，但**直接产出 640x360**，
并把几何常量对齐插件既有素材（站立高度 900/1215*360=266px、脚底 y=330=FEET_Y）。

流程：
  1. ffmpeg 解码成 RGB24 帧（可指定 fps，并用 delogo 去掉水印——水印压在绿幕上，插值即可）；
  2. 逐帧 HSV 色相抠像：只有"绿色色相 + 足够饱和/明度"的像素才判透明。
     为什么不用 chromakey/colorkey：它们是以绿幕色为中心画圈，粉/白/蓝等颜色可能落进圈里被误抠；
     HSV 色相只认绿色方向，粉毛/白裙/红蝴蝶结永不误抠；
  3. 用 alpha 量出人物包围盒：站立高度 → 266px，水平按不透明像素 x 中位数居中，脚底对齐 y=330；
  4. RGBA 管道喂给 libvpx-vp9（yuva420p，与插件播放端一致）。

用法：
  python make_pet_webm.py <输入.mp4> <输出.webm> [--fps 30] [--delogo x,y,w,h] [--no-delogo]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import numpy as np

FFMPEG = str(Path(__file__).resolve().parent.parent / ".tools" / "ffmpeg.exe")
FFPROBE = str(Path(__file__).resolve().parent.parent / ".tools" / "ffprobe.exe")

# 目标画布与几何（与插件一致：640x360、脚底 330、站立高 266 = 900/1215*360）
CANVAS_W, CANVAS_H = 640, 360
FEET_Y = 330
STANDING_HEIGHT = 900 / 1215 * CANVAS_H  # ≈266.67

# 抠像阈值（与 chroma_step02.py 同口径，明度下界调低以吃掉人物脚下的深绿投影）
GREEN_HUE_MIN, GREEN_HUE_MAX = 70.0, 170.0
SAT_MIN, VAL_MIN = 0.15, 0.06
HUE_FEATHER = 6.0

# 默认水印区域（即梦 AI 水印，右下角；压在绿幕上，delogo 插值即可）
DEFAULT_DELOGO = (1005, 630, 245, 85)
HEAD_TAIL = 5  # 首尾各取几帧当"站立姿态"


def probe(path: Path) -> dict:
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate,nb_frames,duration",
         "-of", "default=noprint_wrappers=1", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    d = dict(kv.split("=", 1) for kv in r.stdout.strip().splitlines() if "=" in kv)
    num, den = (d.get("r_frame_rate", "30/1").split("/") + ["1"])[:2]
    return {
        "w": int(d["width"]), "h": int(d["height"]),
        "fps": float(num) / max(float(den), 1e-9),
        "frames": int(d.get("nb_frames") or 0),
        "duration": float(d.get("duration") or 0),
    }


def _box_sum(m: np.ndarray, k: int) -> np.ndarray:
    """k×k 窗口求和（积分图实现，边界按 0 裁剪）。"""
    h, w = m.shape
    c = np.cumsum(np.cumsum(m.astype(np.int64), axis=0), axis=1)
    c = np.pad(c, ((1, 0), (1, 0)))
    r = k // 2
    ys = np.arange(h)
    xs = np.arange(w)
    y0 = np.clip(ys - r, 0, h)
    y1 = np.clip(ys - r + k, 0, h)
    x0 = np.clip(xs - r, 0, w)
    x1 = np.clip(xs - r + k, 0, w)
    return c[np.ix_(y1, x1)] - c[np.ix_(y0, x1)] - c[np.ix_(y1, x0)] + c[np.ix_(y0, x0)]


def _components(mask: np.ndarray):
    """行段 + 并查集的连通块标记（不依赖 scipy）。返回 [(面积, [(y,x0,x1), ...]), ...]，按面积降序。"""
    h, w = mask.shape
    parent: list[int] = []

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    rows: list[list[tuple[int, int, int]]] = []
    prev: list[tuple[int, int, int]] = []
    for y in range(h):
        row = mask[y].astype(np.int8)
        d = np.diff(np.concatenate(([0], row, [0])))
        starts = np.flatnonzero(d == 1)
        ends = np.flatnonzero(d == -1)
        cur = []
        for x0, x1 in zip(starts.tolist(), ends.tolist()):
            lbl = len(parent)
            parent.append(lbl)
            for p0, p1, pl in prev:
                if x0 < p1 and p0 < x1:
                    union(lbl, pl)
            cur.append((int(x0), int(x1), lbl))
        rows.append(cur)
        prev = cur

    comps: dict[int, list[tuple[int, int, int]]] = {}
    areas: dict[int, int] = {}
    for y in range(h):
        for x0, x1, lbl in rows[y]:
            r = find(lbl)
            comps.setdefault(r, []).append((y, x0, x1))
            areas[r] = areas.get(r, 0) + (x1 - x0)
    out = [(areas[r], comps[r]) for r in areas]
    out.sort(key=lambda t: -t[0])
    return out


def _warm_fraction(runs, rgb: np.ndarray) -> float:
    """一个连通块里"暖色像素"（粉/红/橙黄，够饱和够亮）的占比。

    用来把**爱心、闪光这类装饰**和**水印**分开：装饰是实心暖色（爱心粉红、闪光橙黄），
    水印是半透明白/灰/蓝（饱和度低），所以按"H 落在暖色区间 + S/V 够高"就能区分。
    """
    hs, ss, vs = [], [], []
    for y, x0, x1 in runs:
        px = rgb[y, x0:x1]
        f = px.astype(np.float32) / 255.0
        r, g, b = f[:, 0], f[:, 1], f[:, 2]
        mx = np.maximum(np.maximum(r, g), b)
        mn = np.minimum(np.minimum(r, g), b)
        delta = mx - mn
        hue = np.zeros_like(mx)
        nz = delta > 1e-6
        rm = nz & (mx == r)
        gm = nz & (mx == g) & ~rm
        bm = nz & (mx == b) & ~rm & ~gm
        with np.errstate(invalid="ignore", divide="ignore"):
            hue[rm] = (60.0 * (((g - b) / delta) % 6.0))[rm]
            hue[gm] = (60.0 * (((b - r) / delta) + 2.0))[gm]
            hue[bm] = (60.0 * (((r - g) / delta) + 4.0))[bm]
        sat = np.where(mx > 0, delta / np.maximum(mx, 1e-6), 0.0)
        hs.append(hue)
        ss.append(sat)
        vs.append(mx)
    if not hs:
        return 0.0
    h = np.concatenate(hs)
    s = np.concatenate(ss)
    v = np.concatenate(vs)
    # 色相是主力判据：水印是绿灰/白（色相落在绿-青区间），永远进不来；
    # 饱和度门槛放到 0.10 是为了接住**粉彩爱心**（实测粉红爱心 sat≈0.2）；
    # 明度 0.30 以上避免把脚下的暗色阴影算进装饰。
    warm = ((h <= 65.0) | (h >= 310.0)) & (s >= 0.10) & (v >= 0.30)
    return float(warm.mean())


def isolate_character(alpha: np.ndarray, rgb: np.ndarray | None = None) -> np.ndarray:
    """保留"人物"连通块 + 暖色小装饰（爱心/闪光），滤掉水印/UI 残留。

    为什么要这一步：豆包/即梦的水印**会移动**（实测从右下飘到顶部中间再飘走），固定 delogo 框盖不住。

    判定规则：
      1. 最大连通块（人物本体），以及任何不小于它 20% 的块 —— 门槛取 20% 而不是更小，
         因为豆包那枚水印 logo 实测有 8.6k px（小视频里能到最大块的 5%+），门槛太松它就会被留下；
      2. **暖色豁免**：面积 ≥25px 且暖色像素占比 ≥50% 的小块也保留 —— 这是给"跳起来冒爱心/闪光"
         这类装饰留的口子；水印是白/灰/蓝（低饱和或不暖），不会被这条放过。
    """
    mask = alpha > 40
    if not mask.any():
        return alpha
    comps = _components(mask)
    biggest = comps[0][0]
    keep = np.zeros_like(mask)
    for area, runs in comps:
        ok = area >= biggest * 0.20
        if not ok and rgb is not None and area >= 25:
            ok = _warm_fraction(runs, rgb) >= 0.50
        if ok:
            for y, x0, x1 in runs:
                keep[y, x0:x1] = True
    return np.where(keep, alpha, 0).astype(np.uint8)


def alpha_from_rgb(rgb: np.ndarray) -> np.ndarray:
    """rgb (H,W,3) uint8 → alpha (H,W) uint8：绿幕像素透明，边界 6° 羽化。"""
    f = rgb.astype(np.float32) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    delta = mx - mn
    hue = np.zeros_like(mx)
    nz = delta > 1e-6
    # 分段算色相（向量化）：max=r / max=g / max=b
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & (mx == b) & ~rm & ~gm
    with np.errstate(invalid="ignore", divide="ignore"):
        hue[rm] = (60.0 * (((g - b) / delta) % 6.0))[rm]
        hue[gm] = (60.0 * (((b - r) / delta) + 2.0))[gm]
        hue[bm] = (60.0 * (((r - g) / delta) + 4.0))[bm]
    sat = np.where(mx > 0, delta / np.maximum(mx, 1e-6), 0.0)
    inside = (hue >= GREEN_HUE_MIN) & (hue <= GREEN_HUE_MAX) & (sat >= SAT_MIN) & (mx >= VAL_MIN)
    # 羽化：距色相边界 <HUE_FEATHER 度的部分按比例渐变（避免硬边锯齿）
    lo = np.clip((hue - GREEN_HUE_MIN) / HUE_FEATHER, 0.0, 1.0)
    hi = np.clip((GREEN_HUE_MAX - hue) / HUE_FEATHER, 0.0, 1.0)
    greenness = np.where(inside, np.minimum(lo, hi), 0.0)
    return (255.0 * (1.0 - greenness)).astype(np.uint8)


def final_alpha(rgb: np.ndarray, isolate: bool = True) -> np.ndarray:
    """抠像 + （可选）滤掉孤立水印块（暖色小装饰如爱心/闪光会保留）。"""
    a = alpha_from_rgb(rgb)
    return isolate_character(a, rgb) if isolate else a


def decode_cmd(src: Path, info: dict, fps: float, delogo, pix_fmt: str,
               start: float = 0.0, end: float | None = None, hflip: bool = False):
    vf = [f"fps={fps}", "format=rgb24"]
    for box in delogo or []:
        x, y, w, h = box
        vf.insert(0, f"delogo=x={x}:y={y}:w={w}:h={h}")
    # 镜像放最后：delogo 用的是源片坐标，先镜像会让框错位
    if hflip:
        vf.append("hflip")
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", str(src)]
    # -ss/-t 放在 -i 之后 = 精确裁剪（放在前面是快速定位，只对齐关键帧）
    if start and start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    if end is not None:
        cmd += ["-t", f"{max(0.0, end - start):.3f}"]
    return cmd + ["-vf", ",".join(vf), "-f", "rawvideo", "-pix_fmt", pix_fmt, "-"]


def frames_rgb(src: Path, info: dict, fps: float, delogo, start: float = 0.0,
               end: float | None = None, hflip: bool = False):
    """逐帧产出 RGB24 ndarray。"""
    size = info["w"] * info["h"] * 3
    p = subprocess.Popen(decode_cmd(src, info, fps, delogo, "rgb24", start, end, hflip), stdout=subprocess.PIPE)
    assert p.stdout is not None
    while True:
        buf = b""
        while len(buf) < size:
            chunk = p.stdout.read(size - len(buf))
            if not chunk:
                break
            buf += chunk
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(info["h"], info["w"], 3)
    p.stdout.close()
    p.wait()


def measure(src: Path, info: dict, fps: float, delogo, total: int, isolate: bool = True,
            start: float = 0.0, end: float | None = None, hflip: bool = False):
    """一遍扫描：union 包围盒（全帧）+ 站立姿态（首尾各 HEAD_TAIL 帧）。"""
    union = None
    standing = []
    idx = 0
    for rgb in frames_rgb(src, info, fps, delogo, start, end, hflip):
        a = final_alpha(rgb, isolate)
        ys, xs = np.where(a > 10)
        idx += 1
        if len(xs):
            box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
            union = box if union is None else (
                min(union[0], box[0]), min(union[1], box[1]),
                max(union[2], box[2]), max(union[3], box[3]),
            )
            if idx <= HEAD_TAIL or idx > total - HEAD_TAIL:
                standing.append({
                    "h": int(ys.max() - ys.min() + 1),
                    "max_y": int(ys.max()),
                    "med_x": float(np.median(xs)),
                })
    if union is None or not standing:
        raise RuntimeError("没有找到任何不透明像素（抠像阈值可能不对）")
    return union, standing, idx


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--delogo", default=None,
                    help="x,y,w,h；多个用 ; 分隔；'none' 关闭；默认即梦/豆包右下角水印位")
    ap.add_argument("--scale", type=float, default=None, help="固定缩放（多段共用同一几何时用）")
    ap.add_argument("--offset", default=None, help="固定偏移 ox,oy（与 --scale 配套）")
    ap.add_argument("--no-isolate", action="store_true",
                    help="关闭「只保留人物连通块」的滤水印（默认开启）")
    ap.add_argument("--start", type=float, default=0.0, help="只取从第几秒开始（拆分多动作视频用）")
    ap.add_argument("--end", type=float, default=None, help="只取到第几秒为止")
    ap.add_argument("--hflip", action="store_true",
                    help="水平镜像。插件按朝向自动镜像素材（默认朝向=不镜像），"
                         "所以素材的「标准朝向」是朝左；朝右的素材要镜像后使用")
    args = ap.parse_args()

    src, dst = Path(args.src), Path(args.dst)
    info = probe(src)
    duration = info["duration"] or (info["frames"] / info["fps"] if info["fps"] else 4)
    start, end = max(0.0, args.start), (args.end if args.end is not None else duration)
    end = min(end, duration)
    clip = max(0.05, end - start)
    total = max(1, int(round(clip * args.fps)))
    if args.delogo == "none":
        delogo = []
    elif args.delogo:
        delogo = [tuple(int(v) for v in part.split(",")) for part in args.delogo.split(";")]
    else:
        delogo = [DEFAULT_DELOGO]
    fixed = None
    if args.scale is not None and args.offset is not None:
        ox, oy = (float(v) for v in args.offset.split(","))
        fixed = (args.scale, ox, oy)
    print(f"[1/3] 源 {info['w']}x{info['h']} {info['fps']:.0f}fps {duration:.2f}s"
          + (f"（裁剪 {start:.2f}~{end:.2f}s）" if (start > 0 or end < duration) else "")
          + (f"（水平镜像）" if args.hflip else "")
          + f" → {args.fps:.0f}fps {total} 帧；去水印={delogo or '关'}；固定几何={fixed or '否（自测）'}")

    if fixed:
        scale, ox, oy = fixed
        sc_w = int(info["w"] * scale) // 2 * 2
        sc_h = int(info["h"] * scale) // 2 * 2
        print(f"[2/3] 使用固定几何：缩放={scale:.6f} 偏移=({ox:.1f},{oy:.1f})")
    else:
        union, standing, seen = measure(src, info, args.fps, delogo, total, not args.no_isolate,
                                       start, end, args.hflip)
        stand_h = sum(s["h"] for s in standing) / len(standing)
        med_x = sum(s["med_x"] for s in standing) / len(standing)
        max_y = sum(s["max_y"] for s in standing) / len(standing)
        scale = STANDING_HEIGHT / stand_h
        sc_w = int(info["w"] * scale) // 2 * 2
        sc_h = int(info["h"] * scale) // 2 * 2
        ox = CANVAS_W / 2 - med_x * scale
        oy = FEET_Y - max_y * scale
        print(f"[2/3] 实测 {seen} 帧：站立高={stand_h:.0f}px 中心x={med_x:.0f} 脚底y={max_y:.0f} → 缩放={scale:.6f}")
        print(f"      复用几何参数：--scale {scale:.6f} --offset {ox:.1f},{oy:.1f}")
        cl = union[0] * scale + ox
        cr = union[2] * scale + ox
        ct = union[1] * scale + oy
        cb = union[3] * scale + oy
        if cl < -1 or cr > CANVAS_W + 1 or ct < -1 or cb > CANVAS_H + 1:
            print(f"      [警告] 内容会超出画布：左{cl:.0f} 右{cr:.0f} 上{ct:.0f} 下{cb:.0f}")

    fc = (
        f"color=c=black@0:s={CANVAS_W}x{CANVAS_H}:r={args.fps}[bg];"
        f"[0:v]scale={sc_w}:{sc_h}[sc];"
        f"[bg][sc]overlay={ox:.1f}:{oy:.1f}:shortest=1,format=yuva420p[v]"
    )
    enc = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{info['w']}x{info['h']}", "-r", str(args.fps), "-i", "-",
        "-filter_complex", fc, "-map", "[v]",
        "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-auto-alt-ref", "0",
        "-deadline", "good", "-cpu-used", "4", "-pix_fmt", "yuva420p", str(dst),
    ]
    dst.parent.mkdir(parents=True, exist_ok=True)
    p = subprocess.Popen(enc, stdin=subprocess.PIPE)
    assert p.stdin is not None
    n = 0
    for rgb in frames_rgb(src, info, args.fps, delogo, start, end, args.hflip):
        a = final_alpha(rgb, not args.no_isolate)
        rgba = np.dstack([rgb, a])
        p.stdin.write(rgba.tobytes())
        n += 1
    p.stdin.close()
    rc = p.wait()
    if rc != 0:
        print(f"[3/3] 编码失败 rc={rc}")
        return rc
    size = dst.stat().st_size
    print(f"[3/3] 完成：{dst}  {n} 帧  {size/1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
