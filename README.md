# 桌宠 · zhuo-chong

给 [**dsh-pet**](https://github.com/PC2005-cloud/dsh-pet)（DeepSeek Harness 桌面宠物插件）做的一套**改造补丁 + 自造宠物包 + AI 素材管线**。

> 这不是 dsh-pet 的完整副本，而是**我们自己的东西**：对插件的改动（补丁）、一只自己用 AI 视频做出来的宠物（粉毛小女仆）、以及把绿幕视频变成透明桌宠动画的工具链。

---

## 它做了什么

### 1. 桌面感知：她能「看到」你在用什么软件 🧠

宿主侧常驻一个 **PowerShell 子进程**读前台窗口（**只读进程名 + 窗口标题，不截屏、不传画面**），场景稳定 6 秒后交给 DSH 当前配置的模型判断「你在干嘛」，然后**说一句话 + 挑一个动作播**。

- 成本闸门：两次反应至少隔 60 秒、每小时最多 20 次
- 输出契约：模型只回 `{"say":"…","anim":"动作名"}`；动作名必须在该宠物的动画池里才采用
- 开关：桌宠右键 →「设置 → 桌面感知：开/关」（默认关，状态落盘 `perception.json`）
- 路由：`GET/POST /dsh-pet-7340/perception`

![验心](docs/preview/hearts-zoom2.png)

### 2. 边缘探头 + 右键设置菜单 🐾

拖到屏幕左/右边缘松手，她会**藏到边缘外再探头张望、然后停在那儿**（除非再拖她）。倾斜角度、露出比例、停驻时长都可配。

右键「设置」里新增：

| 菜单项 | 作用 |
|---|---|
| 桌面感知：开 / 关 | 上面那个能力 |
| 开机自启动：开 / 关 | 写 Windows 登录项，目标 = 插件的**独立模式**（不依赖 DSH 也能跑桌宠） |
| 启动 DSH | 一键拉起 DeepSeek Harness（路径自动探测） |

### 3. 设置页支持「文件宠物」⚙️

上游的设置页只列 `main-config.jsonc` 里的主宠物，`pet/` 目录里的文件宠物**不显示**。我们补上了：

- 设置页标签栏现在会列出文件宠物（带「文件」标记 + 配置文件路径）
- 名字 / 大小 / 显示位置 / 角落与边距 / 四个开关都能在界面改
- 保存**按种类分流**：主宠物走原路由，文件宠物走新路由 `PUT /config/kind/<前缀>`
- 新路由**只替换 `pets` 一段**，动画池 / 权重 / `edge` / 分类 **原样保留**，并且保留配置文件的顶部注释

### 4. 绿幕视频 → 透明桌宠动画（素材管线）🎬

一条命令把 AI 生成的绿幕视频（即梦 / 豆包）变成能直接放进宠物的 **VP9-alpha 透明 webm**：

- **不截屏式去水印**：豆包/即梦的水印**会移动**，固定框盖不住；改用「按连通块只保留人物」+ **暖色豁免**（爱心、闪光这类小装饰保留，白/灰/蓝水印滤掉）
- **每段各自归一**：量每段自己的站立高度，统一缩到 266px / 脚底 y=330 —— 所以源片里人物画大画小都不影响，切换动作不会跳
- 支持**按时间拆分**（一段视频里含多个动作）、**水平镜像**（插件的标准朝向是"朝左"）

![三段动作](docs/preview/verify-final6.png)

---

## 快速开始

### 前置

```powershell
# 1) 装上游插件（本仓库不含它的 62MB 素材，只放补丁）
dsh plugin --profile desktop add dsh-pet
```

### 2) 应用补丁

```powershell
# 自动找到已安装的 dsh-pet，备份原文件后覆盖
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### 3) 装粉毛小女仆（可选）

```powershell
# 把宠物包拷进用户数据目录
$dst = "$env:USERPROFILE\.dsh\dsh-pet\pet"
New-Item -ItemType Directory -Force "$dst\pinkmaid-animation" | Out-Null
Copy-Item .\pet-pack\pinkmaid\pinkmaid-config.json $dst -Force
Copy-Item .\pet-pack\pinkmaid\pinkmaid-animation\*.webm "$dst\pinkmaid-animation\" -Force
```

### 4) 生效

| 改动 | 生效方式 |
|---|---|
| 宿主（`lib/index.js`：桌面感知、按种类保存路由） | **重载插件**：DSH「插件」页把 dsh-pet 禁用再启用 |
| 浏览器半边（`lib/client.js`：设置页） | **刷新 DSH 页面**（F5） |
| 桌面端（`runtime/electron-helper/*`） | 桌宠右键 →「重载配置」 |

---

## 目录结构

```
patch/                     对 dsh-pet 的改动（可直接覆盖到已安装的插件）
├─ lib/index.js              宿主半边：桌面感知 + 按种类保存路由
├─ lib/client.js             浏览器半边：设置页支持文件宠物
├─ runtime/electron-helper/  桌面半边：边缘探头 / 右键设置菜单 / 开机自启 / 独立模式互斥
│   ├─ sprite.js
│   ├─ main.js
│   └─ preload.js
├─ assets/config.jsonc       edge（边缘探头）默认配置
└─ src/host/perception.ts    桌面感知的源码留档

pet-pack/pinkmaid/         粉毛小女仆：配置 + 9 段透明动画（VP9-alpha webm）
pipeline/                  绿幕视频 → 透明动画工具链（Python + ffmpeg）
docs/
├─ CHANGES.md              逐文件改动清单（含设计原因）
└─ preview/                校验图 / 效果图
install.ps1                一键覆盖补丁（自动定位、先备份）
```

## 已知边界

- 补丁针对 **dsh-pet 0.3.6** 的构建产物（`lib/*.js` 是上游的构建产物，我们直接改的 JS）；**上游更新插件会覆盖掉补丁**，需要重新应用
- `patch/` 里的 `src/` 只放了 `perception.ts`（源码留档）；其余改动是手写的运行时 JS，上游源码树没有对应文件
- 桌面感知会把「进程名 + 窗口标题」文本发给模型服务商；**不截屏、不传画面**，且默认关闭、有频率上限
- 粉毛的素材由 AI 视频（即梦 / 豆包）生成，版权归生成者所有

## 许可与署名

- 本仓库的补丁基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（**MIT**）修改，**保留原版权声明**，详见 [LICENSE](LICENSE) 与 [CREDITS.md](CREDITS.md)
- 我们自己写的部分同样以 MIT 发布

---

<sub>English summary: a mod pack for the `dsh-pet` DSH plugin — desktop perception (foreground window → model → say + action), screen-edge peek idle with a settings submenu (auto-start / launch DSH), file-pet support in the plugin settings page, plus a green-screen→transparent-webm asset pipeline and a self-made pet pack. Patches the upstream build in place; upstream is MIT and credited.</sub>
