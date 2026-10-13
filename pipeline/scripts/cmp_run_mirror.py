import subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
FFMPEG = str(Path(sys.argv[1]) / ".tools" / "ffmpeg.exe")
out = Path(sys.argv[2]); W,H = 640,360
def frame(v, ts):
    r = subprocess.run([FFMPEG,"-y","-v","error","-ss",str(ts),"-i",str(v),"-frames:v","1",
                        "-vf","scale=640:360","-f","rawvideo","-pix_fmt","rgb24","-"], capture_output=True)
    return np.frombuffer(r.stdout[:W*H*3], np.uint8).reshape(H,W,3)
L = r"C:\Users\红米\Desktop\绿幕人物动作设定（左跑）.mp4"
R = r"C:\Users\红米\Desktop\绿幕人物动作设定 (右跑).mp4"
ts = 4.0
fl = frame(L, ts); fr = frame(R, ts); fr_flip = fr[:, ::-1]
diff_direct = float(np.abs(fl.astype(np.int16) - fr.astype(np.int16)).mean())
diff_mirror = float(np.abs(fl.astype(np.int16) - fr_flip.astype(np.int16)).mean())
print(f"同一时刻 t={ts}s：")
print(f"  左跑 vs 右跑（直接比）   平均像素差 = {diff_direct:.2f}")
print(f"  左跑 vs 右跑（镜像后比） 平均像素差 = {diff_mirror:.2f}")
print(f"  → {'两段互为镜像（同一套动作的左右翻版）' if diff_mirror < diff_direct * 0.7 else '两段是不同表演（不是简单镜像）'}")
sheet = Image.new("RGB",(W*3+16,H+26),(20,20,22)); d = ImageDraw.Draw(sheet)
for i,(lab,arr) in enumerate([("左跑 t=4.0s",fl),("右跑 t=4.0s",fr),("右跑 水平镜像",fr_flip)]):
    sheet.paste(Image.fromarray(arr),(4+i*(W+4),22)); d.text((8+i*(W+4),6), lab, fill=(255,210,0))
sheet.save(out); print("->",out)
