# 素材管线：绿幕视频 → 透明桌宠动画

把 AI 生成的绿幕视频（即梦 / 豆包）变成可以直接放进宠物的 **VP9-alpha 透明 webm**（640×360）。

## 为什么要自己写一套

上游 dsh-pet 也有一套素材链（`watermark_step01` / `chroma_step02` / `normalize_step03`），但它假设的是**批量、同机位、有现成水印 mask 素材**的生产环境。单段 AI 视频的情况完全不同：

| 现实问题 | 上游做法为什么不适用 | 我们的做法 |
|---|---|---|
| 水印**会移动**（豆包的水印从右下飘到顶部中间再飘走） | 固定 delogo 框 / 固定 mask 都盖不住 | **按连通块只保留人物** + 暖色豁免 |
| 人脚下有一圈**半透明投影** | 非绿像素会被误判成人物留下灰影 | 明度阈值下调（投影算背景） |
| 每段视频里**人物画得大一点小一点** | 共用一个缩放会让人忽大忽小 | **每段各自量站立高度**，统一缩到 266px / 脚底 y=330 |
| 装饰动画（跳起来冒爱心）会被当碎块滤掉 | — | **暖色豁免**：小块只要够暖够饱和就保留 |
| 一段视频里含**两个动作** | 需要人工找切点 | `find_split.py` 用轮廓比对找"回到站姿"的帧 |
| 素材朝向不对 | — | `--hflip` 水平镜像（插件标准朝向 = 朝左） |

## 依赖

- **ffmpeg + ffprobe（必须带 `libvpx-vp9`）**
  - 检查：`ffmpeg -hide_banner -h encoder=libvpx-vp9`
  - 下载：Windows 用 <https://www.gyan.dev/ffmpeg/builds/> 的 essentials 构建，或国内镜像
    <https://registry.npmmirror.com/-/binary/ffmpeg-static/> 里的 `ffmpeg-win32-x64` / `ffprobe-win32-x64`
  - 放到 `pipeline/.tools/ffmpeg.exe` 与 `pipeline/.tools/ffprobe.exe`（脚本按这个相对路径找）
- **Python 3 + numpy**（抠像与统计都用它）

## 用法

```powershell
# 一段视频 → 一个动作
python scripts\make_pet_webm.py 输入.mp4 输出.webm --fps 24 --delogo none

# 朝右的素材：镜像成"朝左"再用
python scripts\make_pet_webm.py 右跑.mp4 右跑.webm --fps 24 --delogo none --hflip

# 一段视频里有两个动作：先找切点，再按时间裁
python scripts\find_split.py 双动作.mp4 24          # 打印每帧与起始站姿的差异，给出候选切点
python scripts\make_pet_webm.py 双动作.mp4 转身.webm --fps 24 --delogo none --start 0   --end 3.55
python scripts\make_pet_webm.py 双动作.mp4 打招呼.webm --fps 24 --delogo none --start 3.55

# 校验产物（alpha 是否真实 / 人物身高是否一致 / 拼对比图）
python scripts\verify3.py 校验图.png 待机.webm=idle 左跑.webm=run-L 右跑.webm=run-R
```

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--fps` | 30 | 输出帧率。源片 24fps 就用 24（不丢帧）；60fps 源用 24/30 都行 |
| `--delogo` | 即梦/豆包右下角 | `x,y,w,h`；多个用 `;` 分隔；**`none` 关闭**（推荐，因为现在靠连通块滤水印） |
| `--start` / `--end` | 全片 | 按时间裁剪（拆分多动作视频用），精确到 ±1 帧 |
| `--hflip` | 关 | 水平镜像 |
| `--no-isolate` | — | 关掉"只保留人物连通块"这一步（调试用） |
| `--scale` / `--offset` | 自测 | 固定几何。**一般不要用**——除非你确定多段源片人物大小完全一致 |

## 脚本清单

| 脚本 | 用途 |
|---|---|
| `make_pet_webm.py` | 主管线：抠像 + 滤水印 + 归一化 + VP9-alpha 编码 |
| `find_split.py` | 找"回到中立站姿"的帧（拆分多动作视频的切点） |
| `verify3.py` | 产物校验：alpha 统计 + 人物包围盒（身高/脚底/中心）+ 拼对比图 |
| `frames_grid.py` / `multi_grid.py` | 均匀抽帧拼网格（快速看清视频里有几个动作） |
| `find_watermark.py` | 定位水印/UI 残留（诊断用） |
| `debug_isolate.py` | 打印连通块排行 + 滤除区域（诊断"装饰被误杀 / 水印没滤掉"） |
| `compare_feet.py` | 放大对比两段动画的脚部（查"脚被画框裁掉"） |
| `cmp_hearts_zoom.py` | 放大对比原片与产物（查装饰有没有保住） |
| `cmp_run_mirror.py` | 判断两段跑是不是互为镜像 |

## 抠像原理（为什么要这样）

1. **HSV 色相判定**而不是 `chromakey`/`colorkey`：后两者以绿幕色为中心"画圈"，粉/白/蓝等颜色可能落进圈里被误抠；色相判定只认绿色方向（70°~170°），粉毛/白裙/红蝴蝶结永不误抠，边界还有 6° 羽化。
2. **连通块筛选**：水印文字、水印 logo、"85%" 这类都是**孤立小块**，人物是一大块——保留最大块 + 不小于它 20% 的块。门槛取 20% 而不是更小：豆包那枚水印 logo 实测有 8.6k px（小视频里能到最大块的 5%+）。
3. **暖色豁免**：面积 ≥25px 且暖色像素（色相 ≤65° 或 ≥310°，饱和度 ≥0.10，明度 ≥0.30）占比 ≥50% 的小块也保留——这是给"跳起来冒爱心/闪光"留的口子。水印是绿灰/白/蓝，色相就把它们挡在门外了；饱和度门槛压到 0.10 是为了接住**粉彩爱心**（实测 sat≈0.2）。
4. **归一化**：目标画布 640×360，站立高度 266px（= 900/1215×360，与上游素材同口径），水平按不透明像素的 **x 中位数**居中（防止举起的手把包围盒中心拉偏），脚底对齐 y=330。

## 注意

- **每段的首尾要有一小段站立姿势**：脚本用首尾各 5 帧量身高，这是"每段各自归一"的前提。
- 产物体积参考：10 秒 / 24fps 约 1.1~2.2MB（跑步这类高运动量的更大）。
- 本目录**不含 ffmpeg 二进制**（几十 MB），请按上面的说明自己放。
