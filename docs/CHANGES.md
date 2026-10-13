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

---

## 4. `patch/runtime/electron-helper/main.js`

- **独立模式互斥**：`DSH_PET_STANDALONE=1` 时用独立的 `userData` 目录（`…-dsh-pet-electron-helper-boot`）；每 15s 探一次 DSH 进程，若 DSH 在跑就 `POST /shutdown` 后 `app.exit(0)`（避免独立桌宠和 DSH 的桌宠同时出现）
- **设置 IPC**：`pet:settings-get` / `pet:autostart-set` / `pet:dsh-launch`
- **开机自启**：登录项 `dsh-pet` → `wscript.exe` 跑一个 UTF-16LE 的 `autostart.vbs`（`cmd /c set DSH_PET_STANDALONE=1&& "<node>" "<lib/standalone.js>"`，隐藏窗口）
  - `findNode()`：环境变量 → PATH → Program Files → DSH 自带 node，且每个候选都实测 `process.versions.node` 主版本 ≥ 22
  - **`loginItemOn()` 用 `reg query` 而不是 Electron 的 `getLoginItemSettings`**：后者拿未加引号的 `path args` 去比注册表里带引号的值，永远返回 false
- `findDsh()`：探测 DeepSeek Harness 可执行文件路径

---

## 5. `patch/runtime/electron-helper/preload.js`

新增 `settingsGet()` / `autoStartSet(on)` / `launchDsh()`（`contextBridge` + `ipcRenderer.invoke`）。

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
