# 粉毛小女仆 · pinkmaid

一只用 AI 绿幕视频做出来的「文件宠物（pet pack）」，与主宠物（蓝毛）**完全隔离**：独立动画池、独立素材目录、独立配置。

![三段动作](../docs/preview/verify-new3.png)

## 安装

```powershell
$dst = "$env:USERPROFILE\.dsh\dsh-pet\pet"
New-Item -ItemType Directory -Force "$dst\pinkmaid-animation" | Out-Null
Copy-Item .\pinkmaid-config.json $dst -Force
Copy-Item .\pinkmaid-animation\*.webm "$dst\pinkmaid-animation\" -Force
```

然后：浏览器**刷新页面**、桌面端右键 →「重载配置」。

> 目录结构必须是这样（文件宠物**平铺**，没有 `webm/` 子目录）：
> ```
> $DSH_HOME/dsh-pet/pet/
> ├─ pinkmaid-config.json
> └─ pinkmaid-animation/
>    ├─ 待机.webm  ├─ 转身.webm  ├─ 拎起来.webm  └─ …
> ```

## 素材（9 段）

| 文件 | 接进的池子 | 内容 | 触发时机 |
|---|---|---|---|
| `待机.webm` | idle | 站立呼吸（全身带脚） | 平时循环 |
| `转身.webm` / `转身2.webm` | turn | 原地转身一周（正面→侧面→背面→正面） | 朝向翻转（两版随机） |
| `左右看.webm` | turn / edge | 左右张望 | 朝向翻转；也是边缘探头用的动作 |
| `拎起来.webm` | drag | 被拎起来悬空挣扎 | 鼠标拖拽 |
| `打招呼.webm` | clicks | 跳起来打招呼、眯眼笑冒爱心 | 点击她 |
| `眨眼卖萌.webm` | categories | 单眼眨眼卖萌 | 随机小动作（约 10%） |
| `左跑.webm` / `右跑.webm` | moves | 跑步（**右跑在转换时已水平镜像**成朝左） | 随机走动（位移 260~700px） |

权重：`idle 70 + turn 10 + move 10 + 小动作 10 = 100`（**必须凑满 100**，否则分类/走动永远抽不到）。

## 她会在哪儿

桌面**右下角**，`size: 420`。想改就在 DSH 设置页的 dsh-pet 分区里改（补丁已让设置页列出文件宠物），或者直接编辑 `pinkmaid-config.json`。

「边缘探头」也配好了：拖到屏幕左/右边缘松手，她会藏出去再探头张望（`edge.pool = ["左右看"]`），停驻期间在她自己的安静动作里随机（`parkedPool = ["待机","眨眼卖萌"]`）。

## 想加动作

```powershell
# 1) 转素材（见 pipeline/README.md）
python ..\pipeline\scripts\make_pet_webm.py 新视频.mp4 ..\pipeline\step03\新动作.webm --fps 24 --delogo none
# 2) 放进 pinkmaid-animation/，把名字写进 pinkmaid-config.json 的对应池子
# 3) 重载
```

## 三个必须知道的坑

1. **`animations.events.balance` 必须是非空数组**（上游校验写死的）。写成 `"events": {}` 会让**整个 `animations` 判非法**并**静默回落成主宠物的池子**——表现是"素材明明装对了，池子里却还是别人的动作"。
2. ⚠️⚠️ **但绝不能把日常动画名（尤其 idle 池里的「待机」）写进 `events` 里** —— 为了通过第 1 条而写 `"events": {"balance": ["待机"]}` 的话：`handleEnded()` 用 `isEventAnim()` 判断刚播完的是不是事件动画，**命中就直接回 idle、永不进随机链** → 她**永久定格在待机、没有任何随机动作**（我们就这样踩了 ✗）。正确做法是放一个永远不会被播放的占位名：`"events": { "balance": ["balance-unused-placeholder"] }`（她 `balanceEnabled: false`，这个池子根本不会被用到）。
3. **动作素材的标准朝向是"朝左"**。朝右的动作必须先镜像（`--hflip`），否则插件按朝向自动翻转时会反着跑。

## 随机动作是怎么决定的

```
动画播完 → handleEnded() → playIdle()
  roll = Math.random()
  roll < 0.40                → idle   （"待机"）
  roll < 0.50                → turn   （"转身/转身2/左右看" 三选一）
  roll < 0.60                → move   （"左跑/右跑"，会真的走动）
  否则（40%）                 → 小动作池四选一：打招呼 / 左右看 / 转身2 / 眨眼卖萌
```

- **40% 的随机小动作**里，「打招呼」（跳起来冒爱心）最明显 ✓，「左右看 / 转身2」是全身动作 ✓，「眨眼卖萌」只是眨一下眼、很细微 ✗。
- 权重和分类 weight **加起来必须是 100**（这里 40+10+10+40）。
- 停在屏幕边缘时走的是另一条池子（`edge.parkedPool = ["待机","眨眼卖萌"]`）——那时候只露头，跳起来打招呼反而看不见。

## 版权

动画素材由 AI 视频生成（即梦 / 豆包），版权归生成者；本目录只做格式转换与抠像（见仓库根 [LICENSE](../../LICENSE)）。
