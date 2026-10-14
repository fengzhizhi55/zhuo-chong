# 改动清单

目标版本：**dsh-pet 0.3.6**。改动都落在上游的构建产物上（`lib/*.js` 是 bundled ESM，可读、tab 缩进、带 `//#region` 分区）。

---

## 1. `patch/lib/index.js`（宿主半边）

### 1.1 桌面感知（新增 region `//#region src/host/perception.ts`）

**做什么**：常驻一个 PowerShell 子进程读前台窗口（进程名 + 窗口标题），场景稳定后交给 DSH 当前模型判断「你在干嘛」，写入「说一句 + 挑个动作」。

**纯逻辑部分（模块级）**
| 导出/函数 | 说明 |
|---|---|
| `PERCEPTION_ACTIONS` | 20 个可挑的动作名 + 各自的适用场景（进提示词） |
| `PERCEPTION_PS` | PowerShell 脚本：`Add-Type` 编译一次 `GetForegroundWindow/GetWindowText/GetWindowThreadProcessId`，之后每 1.5s 比一次前台窗口，**变了才输出一行** `进程名<TAB>标题` |
| `perceptionEncodedCommand()` | `-EncodedCommand` 需要 UTF-16LE 的 base64（省掉落一个 .ps1 文件） |
| `perceptionSpawnSpec()` | 非 Windows 返回 null（该功能自动不可用） |
| `PERCEPTION_IGNORE` / `perceptionIgnored()` | 忽略宠物自己与系统壳层。**注意不要把 powershell/终端写进来**——用户对着终端干活时她该看得见；感知脚本本身是隐藏窗口，不会成为前台 |
| `parsePerceptionLine()` | 解析 `进程名<TAB>标题`，标题截断 120 字 |
| `perceptionPrompt()` | 组装指令：别复述标题、20 字以内、从清单挑动作、**只输出 JSON** |
| `parsePerceptionReply()` | 优先取 JSON；解析失败就把整段当台词（宁可说一句也别什么都不显示）；台词截 60 字 |
| `perceptionFilePath/read/write` | 开关落盘 `$DSH_HOME/dsh-pet/perception.json`（不碰用户配置本身） |
| `generatePerception()` / `perceptionWith()` | 复用碎碎念那套**模型候选链 + 失败回落**，并尽量关掉思考（`ReasoningEffortId("off")`）以降低延迟 |

**常量**：单次生成超时 25s、场景去抖 6s、两次反应最小间隔 60s、每小时上限 20 次。

**apply() 内**
- `let perceptionControl = null` —— 路由通过它开关/查询
- `publishPerception(scene)` —— 取当前宠物配置 → 生成 → **动作名必须在她的动画池里才采用**（播放端"名字即文件名"，写不存在的只会静默失败）→ 先写 `anim` 再写 `say`
- 看门狗 `ctx.effect(...)`：按开关启停子进程、按行读 stdout、6s 去抖、限流、子进程意外退出 5s 后重启，销毁时清理
- 路由 `GET/POST /dsh-pet-7340/perception`：GET 返回 `{enabled, available, scene, lastReactAt, hourCount}`；POST `{enabled:bool}` 开关并落盘

> 设计取舍：**只做文本层**（进程 + 标题），不截屏。看懂画面需要视觉模型，且截屏会把桌面内容发出去；进程名 + 标题已经够她知道你在写代码/看网页/打游戏。

### 1.2 按种类保存路由（`PUT /dsh-pet-7340/config/kind/<前缀>`）

设置页要能改**文件宠物**（`pet/<前缀>-config.json`），但原本只有一条 `PUT /config` 会写 `main-config.jsonc`。

- 前缀白名单 `^[A-Za-z0-9_-]{1,64}$`（防路径穿越）；文件不存在 404
- **拒绝空数组**：`mergePets` 会把空数组当"缺失"并回落成默认列表，所以空数组必须显式报错
- `id` 与其它种类查重（与 `readAllConfig` 同一套"全局唯一"规则）
- **只替换 `pets`**：`animations` / `animationWeights` / `edge` / `categories` / `events` 等原样保留
- **保留原文件顶部的注释文档**（取第一个 `{` 之前的内容拼回去），只重写对象本体
- 写回后 `syncDesktop()` 并按原路由的惯例返回**新的全量聚合**

---

## 2. `patch/lib/client.js`（浏览器半边：设置页）

| 位置 | 改动 |
|---|---|
| `initPets` | 不再 `filter(p => !p.extra)` —— 文件宠物进入标签栏；新增 `kindOf(p)`（extra → `assetRoot`，否则 `main`） |
| `save()` | 按种类分流：`main` 走原 `PUT /config`（含全局字段）；每个文件宠物走新路由，payload 只带实例字段（`petPayload`）。**先存文件宠物、最后存 main**，用 main 的响应（最新全量聚合）刷新桌面端 |
| `doSync()` | 「同步内置默认」只重置主宠物，**保留文件宠物条目**（否则它们会从界面消失） |
| `addPet()` | 跟随当前选中的种类新建实例（文件宠物以当前那只为模板，补上 `extra`/`assetRoot`） |
| `removeSel()` | 「至少留一只」改为**按种类**判定（否则删粉毛会被当成"删了最后一只"而拒绝） |
| 标签栏 | 文件宠物加「· 文件」标记 |
| 卡片头 | 文件宠物额外显示「动作池由文件维护…配置文件 pet/xxx-config.json」 |
| 文案 | `extraPetsHint` 改写（中英）、新增 `extraTag` / `extraFileHint` |

---

## 3. `patch/runtime/electron-helper/sprite.js`（桌面半边）

### 3.1 边缘探头待机动画
拖到屏幕左/右边缘松手后：藏到边缘外 → 探头张望 → 停在那儿（除非再拖它）。

- 配置默认 `EDGE_IDLE_DEFAULT`：`chance 0.15 / cooldownSec 120 / side random / pool ["东张西望"] / peekRatio 0.42 / holdMs 20000 / dropTrigger true / triggerDistRatio 0.35 / parkAtEdge true / tiltDeg 45 / tiltDir in / tiltPivot feet / tiltScope peek / parkedPool [...]`
- 方法：`edgeCfg / tryEdgeIdle / startEdgePeek / edgePhase(hide|peek|hold|return) / edgeAfterHold / parkEdgePeek / unparkEdge / onEdgeAnimEnded / edgeSlide / finishEdgePeek / cancelEdgePeek / resumeEdgeChain / edgeIdleFromMenu / edgeSideNear / edgeIdleFromDrop / applyStageTransform / setEdgeTilt / edgeTiltTarget`
- 与既有逻辑的咬合：`playIdle()` 开头拦截；**停驻期间 `tryMove()` 返回 false**（否则她走两步就出来了）；`handleEnded()` 在 `edgeSeq` 期间路由到 `onEdgeAnimEnded`；拖拽开始 / `goHome()` / `relayout()` / 菜单「回到初始位置」都会解除停驻

> 两个坑（已修）：① 显示几何变化会触发 `relayout()` → `stopMove()` 取消序列，而 `hide` 阶段不播动画 → 永远收不到 `ended`、链子冻死；用 `resumeEdgeChain()` 补一个 one-shot 解决。② 触发距离要从**身体边缘**量（`sideAllow`），不能从透明画布边缘量。

### 3.2 右键「设置」菜单
| 菜单项 | 动作 |
|---|---|
| 桌面感知：开 / 关 | `togglePerception()` → `POST /perception`，状态缓存 + 气泡反馈 |
| 开机自启动：开 / 关 | `toggleAutoStart()` → preload IPC |
| 启动 DSH（未找到时标注） | `launchDsh()` → preload IPC |

配套 `refreshPerception()`（启动时读一次开关）、`flashNote()`（轻提示）。

### 3.3 「看鼠标」（`onCursorPoint` / `setFacing`）

主进程把真实光标位置转发进来，她据此做反应——**这是"灵动感"最直观的一招**：

| 光标位置 | 她的反应 | 冷却 |
|---|---|---|
| 靠近（默认 2.4 倍身宽内） | 朝它那侧转身（只翻镜像，不换动画） | 翻镜像 2 秒一次 |
| 在附近 | 从 **`turn` 池** 抽一段"张望" | 25 秒 |
| 贴到身上（默认 0.8 倍身宽内） | 从 **`clicks` 池** 抽一段"打招呼" | 60 秒 |

- **从池子里挑而不是写死动作名**：每只宠物素材不同（蓝猫是"东张西望/点击回应-*"，粉毛是"左右看/转身/打招呼"），
  从她自己的池子里挑才能两只都自然，将来加素材也不用改代码。
- **参考点夹回桌面**：停在屏幕边缘时她的包围盒中心常常在屏幕外，不夹的话真实光标永远够不着 →
  她一停边缘，"看鼠标"就永久失效（这个坑实测踩过）。
- **不打扰**：拖拽 / 漫游 / 抛掷 / 边缘探头序列期间一律直接返回；停驻在边缘时只转身张望、不打招呼
  （半个身子在屏幕外，跳起来打招呼很怪）。
- 冷却时间戳初值用 `-Infinity`：否则用 `performance.now()` 从 0 起算，页面刚加载的头一个冷却周期内完全不反应，
  看上去就像没生效。
- 配置：`animations.cursor = { enabled, lookRadius, greetRadius, lookCooldownSec, greetCooldownSec, look, greet }`，
  不写就用内置默认（默认开），可按宠物单独关。

### 3.4 宠物间互动（`socialTick` / `socialSay`）

两只宠物凑近时会互相看一眼，偶尔打个招呼、各说一句自己的台词。

- **不需要新通道**：位置数据本来就是现成的 —— 主进程每次位置上报都会把**所有宠物**的状态广播给所有宠物窗
  （跨窗碰撞 broker 用的那条），渲染端早已订阅（`this.others`，且已换算到同一坐标系）。判定节流到 2Hz。
- **只在"从分开变成凑近"的那一刻触发一次**（`socialNearId`），否则两只挨着坐会没完没了地互相招呼；
  另有概率（默认 35%）与冷却（默认 240 秒，同一对之间）。
- **台词本地随机抽**（尽量不重复上一句）→ 走宿主 `POST /broadcast?pet=<自己>` 写气泡，
  **完全不经过模型 → 零 token**。随机感来自"概率触发 + 台词随机 + 谁先说随机"。
- 动作从自己的 `clicks` 池抽 → 粉毛冒爱心、蓝毛点击回应-*，各自自然。
- 拖拽 / 漫游 / 抛掷 / 边缘探头 / 停在边缘时一律不掺和。
- 配置：`animations.social = { enabled, radiusRatio, greetChance, greetCooldownSec, lines }`，
  不写走代码里的 `SOCIAL_DEFAULT`（与 `EDGE_IDLE_DEFAULT` 同理：配置是整段替换的，缺省必须写在代码里）。
- 实测：两只真的互相打了招呼，**各说各的台词**（`pinkmaid.say="今天也要乖乖的哦"` / `main.say="你今天也在摸鱼？"`），
  两条气泡只差 2ms —— 说明双方各自独立判定、都触发了。若觉得"同时开口"有点吵，可以让 id 较小的一方先开口（待定）。

#### 3.4.1 谁先开口（后加的）

同时开口实测确实像抢话，所以改成**有来有回**：

- **id 小的一方先说**（实测里是蓝毛 `main`），另一方等 **1.2~3 秒**再回
  （`SOCIAL_DEFAULT.replyMinSec/replyMaxSec`，也可在各自的 `social` 里覆盖）。
- 回话方**先读宿主 `/state` 确认对方真的刚说过话**（气泡的 `counter` 就是写入毫秒时间戳，
  8 秒内算"刚开口"）—— 避免对着空气自言自语。
- **判定不能只挂在位置广播上** ✗：位置没变时主进程不上报，实测"回话"被拖成了 **5.5 秒**。
  所以给 sprite 加了一条 1 秒的心跳（`socialTimer`，`dispose()` 里清掉），配合 500ms 节流。
- 实测：`main` 16:14:42.535 说"别老盯着屏幕啦" → `pinkmaid` 16:14:48.076 说"要不要一起玩？"
  （顺序正确 ✓；间隔偏长 → 已由心跳改进，待你拖到一起验收）。

### 3.5 宠物间碰撞（配置项，无需改代码）

`physics.petCollision: true`（在 `main-config.jsonc`，用户级 → 两只共用）后，把一只**扔向**另一只
会真的撞上并按动量互相弹开（跨窗 broker 结算，`restitution 0.78`）。
⚠️ 只在"被扔出去飞行"时生效 —— 走路撞上去不触发（走路是脚本位移，不是物理）。

---

## 4. `patch/runtime/electron-helper/main.js`

- **独立模式互斥**：`DSH_PET_STANDALONE=1` 时用独立的 `userData` 目录（`…-dsh-pet-electron-helper-boot`）；每 15s 探一次 DSH 进程，若 DSH 在跑就 `POST /shutdown` 后 `app.exit(0)`（避免独立桌宠和 DSH 的桌宠同时出现）
- **设置 IPC**：`pet:settings-get` / `pet:autostart-set` / `pet:dsh-launch`
- **开机自启**：登录项 `dsh-pet` → `wscript.exe` 跑一个 UTF-16LE 的 `autostart.vbs`（`cmd /c set DSH_PET_STANDALONE=1&& "<node>" "<lib/standalone.js>"`，隐藏窗口）
  - `findNode()`：环境变量 → PATH → Program Files → DSH 自带 node，且每个候选都实测 `process.versions.node` 主版本 ≥ 22
  - **`loginItemOn()` 用 `reg query` 而不是 Electron 的 `getLoginItemSettings`**：后者拿未加引号的 `path args` 去比注册表里带引号的值，永远返回 false
  - ⏱️ **延迟启动 `AUTOSTART_DELAY_MS = 90000`（VBS 里 `WScript.Sleep 90000`）**：这是踩出来的 ✗ ——
    桌宠在登录瞬间拉起 `node + Electron（好几个进程）`，会和应用商店类的启动任务抢资源；
    **实测连续几次开机把 TranslucentTB 挤掉了**（TTB 的启动任务注册一直是 `State=2` 启用状态 ✓，
    说明不是被改坏了，而是"系统繁忙时应用商店启动任务会被延迟甚至跳过"）。
    延迟到登录高峰之后再起即可。想让她早点出现就把这个常量调小。
- `findDsh()`：探测 DeepSeek Harness 可执行文件路径
- **转发真实光标位置**（「看鼠标」的源头）：主进程本来就有 `pointerTimer` 按 `POINTER_POLL_MS`
  轮询 `screen.getCursorScreenPoint()` 做点击穿透判定 —— 这里**复用同一个点**（不额外轮询）转发给渲染端。
  实测转发通道稳定（渲染端累计收到上千条）。

---

## 5. `patch/runtime/electron-helper/preload.js`

新增 `settingsGet()` / `autoStartSet(on)` / `launchDsh()`（`contextBridge` + `ipcRenderer.invoke`），
以及 **`onCursor(cb)`**（订阅主进程转发的真实光标位置，「看鼠标」用）。

## 5b. `patch/runtime/electron-helper/renderer.js`

新增：订阅 `petBridge.onCursor` → 分发给本窗口的 sprite（`s.onCursorPoint(p)`）。

---

## 坐标约定（改「看鼠标」这类功能前必看）

- **主进程侧是物理像素**（窗口 bounds、逐屏几何、碰撞 broker、`screen.getCursorScreenPoint()`）；
- **渲染端是 CSS 像素**（DOM 度量、`VIEW`/`AREAS`、`this.pos`、`toScreen`/`toLocal` 收口换算）；
- 跨进程交换只允许在 `toScreen`（×scale 发出）/ `toLocal`（÷scale 收进）两处换算，组件代码里不得再乘除。
- ⚠️ 我第一版测试就是**把窗口中心当 DIP 用**，注入点飞到屏幕外（2610,1287）→ 每次都被"太远"挡掉，
  看起来像功能没生效。写这类测试时，坐标一律交给页面自己算（`local × CONFIG.scale`）。

---

## 6. `patch/assets/config.jsonc`

- 新增 `animations.edge`（边缘探头默认值 + 中文注释）
- `pets[0]` 显式写 `display: "desktop"` 与右上角位置

---

## 7. `patch/src/host/perception.ts`

桌面感知的**源码镜像**（设计说明 + 同款实现）。上游源码树在 `src/`，但它不参与运行；
其余改动是手写运行时 JS，上游没有对应文件，所以这里只放了这一份留档。

---

## 踩过的坑（配置层面，改文件时最容易中招）

1. **`animations.events.balance` 必须是非空数组**（上游校验代码写死的）。写成 `"events": {}` 会让**整个 `animations` 判非法**，然后**静默回落成主宠物的动画池**——表现是"素材装对了但池子里还是别人的动作"。
2. ⚠️⚠️ **但千万别把日常动画名（尤其是 idle 池里的）写进 `events` 里** —— 这是最阴的一个坑：
   `handleEnded()` 用 `isEventAnim(animations.events, this.anim)` 判断"刚播完的是不是事件动画"，
   **命中就直接回 idle、永远不进随机链**。
   如果你为了通过第 1 条校验，往 `events.balance` 里塞了 `["待机"]`，那她每次待机播完都会被当成事件动画 →
   **永久定格在待机、再也不换动作、也没有任何随机小动作**（我们就这样踩了 ✗）。
   正确做法：**放一个永远不会被播放的占位名**（例如 `"balance-unused-placeholder"`），
   因为 `balanceEnabled: false` 时这个池子根本不会被用到。
3. **权重必须凑满 100**：`animationWeights` 的 `idle+turn+move` 加上所有 `categories[].weight` 之和要是 100。`move: 0` 时，`moves.actions` 里写再多她也永远不会走动。
4. **素材的"标准朝向是朝左"**：插件默认朝向 `left`（不镜像），朝右时自动 `scaleX(-1)`。所以朝右的素材必须先水平镜像再放进去，否则她会倒着跑。
5. **文件宠物的素材是平铺的**：`pet/<前缀>-animation/*.webm`（**没有** `webm/` 子目录）；主宠物才是 `main-animation/webm/`。
6. **文件宠物改了要重载**：浏览器刷新页面、桌面端右键「重载配置」。

## 运行时代码层面的两个补丁（`runtime/electron-helper/sprite.js`）

| 补丁 | 原因 |
|---|---|
| `loadGuard` 里补上"**重新点着随机链**" | 素材加载失败/超时时，上游只做了 `pending = null` 就释放了这次切换 ✗ —— 但 `handleEnded` 只在动画**播完**时才触发，而这次压根没播 → **随机链从此永久停摆，宠物定格在最后一帧** ✗。补一个带次数上限（20 次）的 1.5s 重试。 |
| 切换成功时重置 `loadRetries` | 配合上面那条，正常播放后重新计数，避免累积到上限后不再自愈。 |
