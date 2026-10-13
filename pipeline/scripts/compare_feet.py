import subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image
FFMPEG = str(Path(sys.argv[1]) / ".tools" / "ffmpeg.exe")
out = Path(sys.argv[2]); base = Path(sys.argv[1])
W, H = 640, 360
def grab(v, ts):
    r = subprocess.run([FFMPEG,"-y","-v","error","-c:v","libvpx-vp9","-ss",str(ts),"-i",str(v),
                        "-frames:v","1","-f","rawvideo","-pix_fmt","rgba","-"], capture_output=True)
    return np.frombuffer(r.stdout[:W*H*4], np.uint8).reshape(H,W,4)
rows = []
for name, ts in (("待机.webm", 5.0), ("待机2.webm", 5.0)):
    a = grab(base/"step03"/name, ts)
    bottom = a[250:360]          # 画布底部 110px（脚所在区域）
    im = Image.fromarray(bottom, "RGBA")
    bg = Image.new("RGB", (W, bottom.shape[0]*2), (25,27,30))
    light = Image.new("RGB", (W, bottom.shape[0]), (240,240,242))
    bg.paste(im, (0,0), im); light.paste(im, (0,0), im); bg.paste(light, (0, bottom.shape[0]))
    rows.append((name, bg))
    al = a[...,3]; ys, xs = np.where(al>40)
    print(f"{name}: 最低不透明像素 y={ys.max()} / 画布高 {H}；底部 8 行是否有不透明像素: {bool((al[H-8:]>40).any())}")
sheet = Image.new("RGB", (W, sum(r[1].height+24 for r in rows)), (18,18,20))
y = 0
from PIL import ImageDraw
d = ImageDraw.Draw(sheet)
for name, im in rows:
    d.text((6, y+4), name, fill=(255,210,0)); sheet.paste(im, (0, y+22)); y += im.height + 24
sheet.save(out); print("->", out)
