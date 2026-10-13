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
    return np.frombuffer(r.stdout[:W*H*4], np.uint8).reshape(H,W,4)
src = r"C:\Users\红米\Desktop\绿幕人物动作设定4.mp4"
cur = Path(sys.argv[1])/"step03"/"打招呼.webm"
# 左半区放大 2 倍
def crop(a): return Image.fromarray(a[:, :300], "RGBA").resize((600, 720), Image.NEAREST)
tiles = [("原片 3.90s", frame(src,3.9,True)), ("产物 0.35s", frame(cur,0.35)),
         ("原片 4.27s", frame(src,4.27,True)), ("产物 0.72s", frame(cur,0.72))]
tw, th = 600, 720
sheet = Image.new("RGB", (tw*2+18, th*2+40), (18,18,20)); d = ImageDraw.Draw(sheet)
for i,(lab,a) in enumerate(tiles):
    r_, c_ = divmod(i,2)
    x, y = 6+c_*(tw+6), 20+r_*(th+20)
    im = crop(a); bg = Image.new("RGB",(tw,th),(24,26,30)); bg.paste(im,(0,0),im)
    sheet.paste(bg,(x,y)); d.text((x+4,y-16), lab, fill=(255,210,0))
sheet.save(out); print("->",out,sheet.size)
