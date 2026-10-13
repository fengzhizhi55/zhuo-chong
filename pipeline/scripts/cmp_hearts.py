import subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
FFMPEG = str(Path(sys.argv[1]) / ".tools" / "ffmpeg.exe")
out = Path(sys.argv[2]); W,H = 640,360
def frame(v, ts, src=False):
    cmd = [FFMPEG,"-y","-v","error"]
    if not src: cmd += ["-c:v","libvpx-vp9"]
    cmd += ["-ss",str(ts),"-i",str(v),"-frames:v","1"]
    if src: cmd += ["-vf","scale=640:360"]
    cmd += ["-f","rawvideo","-pix_fmt","rgba","-"]
    r = subprocess.run(cmd, capture_output=True)
    a = np.frombuffer(r.stdout[:W*H*4], np.uint8).reshape(H,W,4)
    im = Image.fromarray(a,"RGBA"); bg = Image.new("RGB",(W,H),(24,26,30)); bg.paste(im,(0,0),im); return bg
src = r"C:\Users\红米\Desktop\绿幕人物动作设定4.mp4"
cur = Path(sys.argv[1])/"step03"/"打招呼.webm"
# 原片爱心出现的时刻（B 段起点 3.55s 之后）
pairs = [(3.9,0.35),(4.27,0.72),(4.6,1.05),(5.0,1.45)]
sheet = Image.new("RGB",(W*len(pairs),H*2+26),(18,18,20)); d = ImageDraw.Draw(sheet)
for i,(ts,os_) in enumerate(pairs):
    sheet.paste(frame(src,ts,True),(i*W,20))
    sheet.paste(frame(cur,os_),(i*W,H+26))
    d.text((i*W+6,4), f"原片 t={ts}s", fill=(255,210,0))
    d.text((i*W+6,H+24+2), f"当前产物 t={os_:.2f}s", fill=(120,220,255))
sheet.save(out); print("->",out, sheet.size)
