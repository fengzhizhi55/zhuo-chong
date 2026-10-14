/**
 * dsh-pet desktop helper —— 宠物本体（PetSprite 类）。
 *
 * 播放 / 拖拽抛掷 / 跨窗碰撞 / 点击穿透 / 右键菜单 / 聊天弹窗 / 气泡渲染。
 * 事件联动（余额 / 碎碎念 / 广播 / 工作状态）不在此文件——见 events.js。
 * 依赖 constants.js 的全局（CONFIG / VIEW / BASE / S / config / sprites 等），须后加载。
 */
'use strict';

/**
 * 边缘待机（趴在屏幕左/右边缘探头张望）的内置默认值 —— 配置 animations.edge 的缺省基座。
 *
 * 为什么代码里也留一份默认：配置是**整段替换**的（用户在 main-config.jsonc 里写了 animations，
 * 就整段用自己的，不会从包内 config.jsonc 补子键），所以任何"只写在包内配置里"的默认值都可能
 * 被一次设置页保存悄悄抹掉。默认写在这里 ⇒ 抹掉也照常工作，配置只用于**调参**。
 *   chance      ：每次待机链触发边缘待机的概率（0~1）
 *   cooldownSec ：两次**自动**触发之间的最小间隔（秒）
 *   pool        ：探头时播的动画名（"名字即文件名"，必须真实存在；默认左右张望）
 *   peekRatio   ：探头时整只宠物留在屏幕内的比例（0.55 = 露出 55%，其余缩在屏幕外）
 *   hideMs/peekMs/returnMs：滑出去 / 探头 / 退回 三段时长（毫秒）
 *   holdMs      ：探头后最长停留（毫秒）——正常由动画播完推进，这只是卡住时的保险
 *   dropTrigger ：true = 把宠物拖到屏幕左/右边缘附近松手就从那一侧探头（用户意图优先，不掷概率）
 *   triggerDistRatio：dropTrigger 的判定距离，按宠物宽度取比例（0.35 = 约 1/3 个身位）
 *   parkAtEdge  ：true（默认）= 探头看完就**留在屏幕边缘**（保持斜着、只露上半身），
 *                 除非用户再次拖动 / 点「回到初始位置」/ 点播移动动画才出来；false = 退回原位
 *   tiltDeg     ：探头时"斜着倒"的角度（度，0 = 站直不倾；默认 30）
 *   tiltDir     ：'in'（默认，头朝屏幕里倒）/'out'（头朝屏幕外倒）
 *   tiltPivot   ：旋转支点：'feet'（默认，以脚底为轴，像人歪着）/ 'center'（绕身体中心转）
 *   tiltScope   ：'peek'（默认，只在探头+张望时倒，退回时转正）/ 'all'（滑出去就开始倒）
 */
const EDGE_IDLE_DEFAULT = {
  chance: 0.15,
  cooldownSec: 120,
  side: 'random',
  pool: ['东张西望'],
  peekRatio: 0.42,
  keepY: true,
  hideMs: 420,
  peekMs: 520,
  returnMs: 900,
  holdMs: 20000,
  dropTrigger: true,
  triggerDistRatio: 0.35,
  parkAtEdge: true,
  tiltDeg: 45,
  tiltDir: 'in',
  tiltPivot: 'feet',
  tiltScope: 'peek',
  /**
   * 停在屏幕边缘期间**专用**的"看得清"动作池（实机逐帧核对过）。
   *
   * 为什么需要：停在边缘时只露出头 + 一点上半身（peekRatio 0.42、斜 45°），随机链原本会抽到
   * 玩魔方 / 骑木马 / 吃东西 / 走路这类"动作在屏幕外"的动画——用户看到的只是半个人在动，
   * 完全看不出在干嘛。这里的动作全部满足：脸在可见区里、动作靠头/表情/手上道具完成。
   *
   * 刻意**不含**：东张西望（它是 turn 类，播完会翻转朝向，停在边上被翻转会变成面朝屏幕外）；
   * 原地敲击桌面互动 / 碎碎念-擦桌（动作在屏幕下方）、写代码 / 轻快记录 / 玩魔方 / 吃白饭
   * （道具与动作都在可见区外）。清单为空 = 退回原随机链。
   */
  parkedPool: [
    '待机呼吸休闲',
    '哈欠连天',
    '打瞌睡被惊醒',
    '被吓一跳',
    '悠闲哼歌',
    '照镜子',
    '原地小憩沉眠',
    '点击回应-元气挥手',
    '点击回应-害羞惊讶',
    '点击回应-傲娇生气',
    '点击回应-挠痒咯咯笑',
    '点击回应-开心跃动',
    '碎碎念-发呆碎碎念',
    '碎碎念-对屏碎碎念',
    '工作状态-思考冒泡',
    '工作状态-忙碌点按',
    '偷吃零食被抓住',
    '摇扇纳凉',
    '晨间刷牙',
  ],
};

// ---------- 单只宠物（行为与浏览器 PetCard 一致；纯逻辑来自 src/shared） ----------

/**
 * 宠物间互动（animations.social）的缺省值 —— 与 EDGE_IDLE_DEFAULT 同理：配置是**整段替换**的，
 * 用户一旦在 main-config.jsonc 里写了 animations，就不会从包内配置补子键，所以缺省必须写在代码里。
 *   radiusRatio      ：多近算"凑在一起"（自己的身宽 × 该倍数）
 *   greetChance      ：每次凑近有多大比例会打招呼（不想每次都打就调小）
 *   greetCooldownSec ：同一对宠物两次打招呼之间的最小间隔
 *   lines            ：台词表（本地随机抽，零模型成本；填 8~10 句随机感最好）
 * 这些台词只是**兜底**：每只宠物都可以在自己的配置里写一份自己的。
 */
const SOCIAL_DEFAULT = {
  radiusRatio: 1.6,
  greetChance: 0.35,
  greetCooldownSec: 240,
  lines: ['今天也在一起呀', '你好呀', '又见面了～', '要不要一起玩？'],
};

class PetSprite {
  constructor(pet) {
    this.pet = pet; // 这只宠物的配置段（拍平后的成品实例，条目级字段已吹入：动画池/权重/周期）
    // 页面级缩放（main 对窗口 setZoomFactor(CONFIG.scale)，见 DESIGN.md §3.5）统一放大整窗：
    // pet.size 即 CSS 像素基准，**不再手工乘 CONFIG.scale**——固定 px UI（菜单/积分/聊天）
    // 随同一缩放自动恢复 DIP 观感；跨进程交换（bounds/几何/碰撞）由 constants.js 的
    // toScreen/toLocal 收口换算，这里与 shared 组件一样零乘除。
    this.size = pet.size;
    this.height = (this.size * 9) / 16;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = (this.size * (9 / 16) * (S.CANVAS_H - S.FEET_Y)) / S.CANVAS_H;
    // 窗口高 = 舞台高 + 脚底垫高（stage 被 translateY(bottomPad) 下移的余量，防底部被窗口裁剪）
    this.winH = this.height + this.bottomPad;
    // 窗口内【可交互区域】= 身体命中区（像素，窗口坐标）。浏览器 overlay 只有 .dsh-pet-hit 是
    // pointer-events:auto（root/stage/气泡全 none）——桌面严格对齐：命中区外含透明像素一律穿透到下层应用。
    // HIT_BOX 是 640×360 舞台坐标：x 按窗口宽缩放；y 除舞台高外还要加 bottomPad（舞台被下移）。
    this.hitRect = {
      x: (S.HIT_BOX.x0 / 640) * this.size,
      y: this.bottomPad + (S.HIT_BOX.y0 / 360) * this.height,
      w: ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * this.size,
      h: ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * this.height,
    };
    window.__dshPetDebug.hitRect = this.hitRect;
    // 左右透明边余量（视频盒内宠物身体居中）：让边界按"身体"贴边——宠物能走到屏幕边缘，
    // 但身体永不越界（漫游/拖拽都不会弄丢宠物）。与浏览器 overlay 的 sideAllow 同一套语义。
    this.sideAllow = (S.HIT_BOX.x0 / 640) * this.size;
    window.__dshPetDebug.sideAllow = this.sideAllow;
    // 窗口四周外扩（= WINDOW_MARGIN_RATIO×宠物尺寸）：sprite 钉在 (margin.l, margin.t)，
    // 窗口 = sprite + 四边余量——气泡/未来弹窗显示在余量里；余量透明且点击穿透
    const m = this.size * WINDOW_MARGIN_RATIO;
    this.margin = { t: m, r: m, b: m, l: m };
    window.__dshPetDebug.winMargin = this.margin;
    // 宠物包围盒左上角在【工作区】坐标系里的位置（本窗口的位置 = 宠物的位置）
    this.pos = { x: 0, y: 0 };

    // 播放状态（与浏览器同构）
    // 动画池与权重按宠物取：文件宠物（pet/ 目录定义，extra）自带**完整独立**动画池；
    // main 等常规宠物（无 anims 段）用全局 cfg.animations（与浏览器 pet.ts 同一语义）。
    this.animations = pet.animations || cfg.animations;
    this.weights = pet.animationWeights || cfg.animationWeights;
    // 拖拽抛掷物理参数（顶层全局；拍平已吹入实例，兜底回全局/默认）
    this.physics = pet.physics || config.physics || S.DEFAULT_PHYSICS;
    // 抛掷锁定在当前屏幕（根字段；拍平已吹入实例，兜底回主条目/默认）：
    // true = 甩出去只在松手时所在那块屏内弹（屏缝当墙），false = 照常跨屏飞行
    this.confineToScreen = pet.confineToScreen === true || config.confineToScreen === true;
    // 素材根按 assetRoot（文件宠物 = 配置文件前缀，多实例共享同一素材目录）或宠物 id 回落
    this.assetRoot = pet.assetRoot || pet.id;
    this.assetBase = BASE + '/thumb/' + encodeURIComponent(this.assetRoot) + '/';
    this.front = 0; // 0 = A, 1 = B
    this.pending = null;
    this.gen = 0;
    this.anim = this.animations.idle[0] ?? '';
    this.once = true;
    this.facing = 'left';
    // 「看鼠标」（可选，配置 animations.cursor；见 onCursorPoint）：
    // 主进程把真实光标位置转发进来，她据此转头/打招呼。默认开，可按宠物单独关。
    this.cursorCfg = this.animations.cursor || {};
    // 时间戳初值给 -Infinity：否则用 performance.now() 算冷却时，"从 0 起算"会让页面刚加载的
    // 头一个冷却周期（25 / 60 秒）内完全不反应——看上去就像没生效。
    this.lastLookAt = -Infinity; // 上次"朝光标张望"的时间戳（冷却用）
    this.lastGreetAt = -Infinity; // 上次"贴上来打招呼"的时间戳（冷却用）
    this.lastFaceFlipAt = -Infinity; // 上次因光标翻镜像的时间戳（防与转身链互相打架）
    // 宠物间互动（animations.social）：位置来自主进程广播的 this.others，不需要新通道
    this.socialCfg = this.animations.social || {};
    this.socialTickAt = 0; // 节流用（广播是逐帧来的，判定压到 2Hz）
    this.socialNearId = null; // 当前"凑在一起"的那只；走开置空，下次靠近才重新判定
    this.socialGreetAt = -Infinity; // 上次打招呼的时间戳（同两只之间的冷却）
    this.socialLastLine = ''; // 上次说的台词（避免连着重复同一句）
    // 交互/移动
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 };
    this.justDragged = false;
    this._interactive = null; // 已上报的可交互状态（setInteractive 去重用）
    this._inputBusy = null; // 已上报的"正在用输入"状态（syncInputBusy 去重用）
    // 拖拽抛掷物理（与浏览器 pet.ts 同构；纯计算在 shared-core S.*）：
    // 拖拽中弹簧跟随目标（包围盒左上角，工作区 px），松手按指针轨迹估速 → 抛掷（重力+边缘反弹）
    this.dragTrail = []; // 指针轨迹采样（screenX/Y + performance.now()，初速估算用）
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
    this.dragFollow = null; // 弹簧跟随 rAF handle
    this.dragFollowToken = 0;
    this.throwRef = null; // 抛掷 rAF handle
    this.throwToken = 0;
    this.space = null; // 抛掷空间（逐屏 AABB）缓存；显示器变化时由 relayout() 置空重建
    // Q 弹挤压（点击回应 / 抛掷落地）：rAF + 待压标记（等新动画成为前台再压，压新首帧）
    this.squashRef = null;
    this.squashToken = 0;
    this.pendingSquash = false;
    this._interactive = null; // 当前可交互状态（null=未定；只在变化时发 IPC，避免逐帧刷屏）
    this.moveRef = null;
    this.moveToken = 0;
    this.pendingMove = null;
    this.customPos = null; // 拖拽后的会话内位置（{rx, ry} 比例）；restart 回角落
    // 边缘待机（桌面专属，见下方 edgeCfg/startEdgePeek）：当前这一段的状态（null = 没在跑）
    // + 下一次允许**自动**触发的时刻（冷却，防连续触发；右键菜单手动触发不吃冷却）
    this.edgeSeq = null;
    this.edgeTimer = null; // hold 阶段的兜底定时器（动画卡住/素材 404 时也要能退回来）
    this.edgeNextAt = 0;
    // 边缘待机的"斜着倒"姿态：当前倾斜角度（度，0 = 站直）。作用在**舞台**上
    // （不是 .pet-sprite 根节点）——气泡是根节点的兄弟，跟着转会把气泡也拧歪。
    this.edgeTilt = 0;
    // 已"停在边缘"（探头后留在屏幕边只露上半身，不自己出来）：{ side, tilt } 或 null。
    // 置位期间禁掉自行漫游（tryMove），只有用户再次拖动/点菜单/回家才会解除。
    this.edgeParked = null;
    // 设置项（右键菜单「设置」）：登录项真实状态与 DSH 主程序位置都由主进程给，
    // 渲染端只缓存展示（菜单是同步构建的，拿不到异步结果）。
    this.autoStartOn = false;
    this.dshPath = '';
    this.standaloneMode = false;
    // 桌面感知（她"看得到你在用什么软件"）：开关状态在宿主侧，这里只缓存展示
    this.perceptionOn = false;
    if (window.petBridge && window.petBridge.settingsGet) {
      window.petBridge
        .settingsGet()
        .then((s) => {
          if (!s) return;
          this.autoStartOn = !!s.autoStart;
          this.dshPath = s.dshPath || '';
          this.standaloneMode = !!s.standalone;
        })
        .catch(() => {});
    }
    this.refreshPerception();
    // 右键菜单（统一自绘组件，两端共用同一份：树+渲染均来自 shared-core）
    this.menuOpen = false; // 菜单开启期间强制整窗可交互（悬停菜单不触发穿透翻转）
    this.menuClose = null; // 当前菜单的 close()（打开时挂载，关闭后置空）
    // 余额气泡
    this.bubbleOn = false;
    this.bubbleTimer = null;
    this.balanceView = null;
    this.balanceWrap = false; // true = 当前余额气泡是不可用的「文字说明」（多行，需换行变体）
    this.prevTick = 0;
    // 说话（碎碎念 / 命令气泡 / 对话回复三合一）：文本/配图由容器统一轮询 /state 后经
    // showWhisper 送进来，本精灵不再自己轮询（改造前的 whisperLoopTimer / broadcastLoopTimer 已删）
    this.whisperOn = false;
    this.whisperTimer = null;
    this.whisperView = null;
    this.whisperText = '';
    // 配图名称（配置 memes 的键；whisperImageEnabled 开启时由 host 随机抽定，随文本一起来）
    this.whisperImage = '';
    // 工作状态联动（DSH 会话状态）：容器 1s 轮询 /state 递增 workTick → 本宠物按档位播动画+气泡。
    // 气泡单槽优先级 终态任务 > whisper > balance > 非终态任务（见 renderBubble）；
    // workStatusEnabled 未启用时完全免疫（与浏览器一致）
    this.workOn = false;
    this.workTimer = null;
    this.workText = null;
    this.workState = null; // 最近一次工作状态（互动/事件动画播完恢复档位循环用）
    this.prevWorkState = null; // 上一档状态（气泡只在状态变化时点亮/收起，Bug 2）
    this.prevWorkTick = 0;
    // 对话弹窗（shared 组件）：当前挂载的 close() 句柄 + 开启标记
    // （chatOpen 是穿透守卫：弹窗是窗口内 DOM，期间整窗保持可交互，与 menuOpen 同语义——否则
    //   光标移到输入框（不在身体命中区）就会被 onMouseMove 翻回穿透，点击全被透传）
    this.chatClose = null;
    this.chatOpen = false;

    // DOM：sprite 钉在窗口内 (margin.l, margin.t)；宠物"位置"= sprite 位置，窗口随余量外扩
    this.el = document.createElement('div');
    this.el.className = 'pet-sprite';
    this.el.style.left = this.margin.l + 'px';
    this.el.style.top = this.margin.t + 'px';
    this.el.style.setProperty('--pet-size', this.size + 'px');
    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.stage = stage;
    this.videoA = document.createElement('video');
    this.videoA.className = 'pet-video is-front';
    this.videoB = document.createElement('video');
    this.videoB.className = 'pet-video';
    for (const v of [this.videoA, this.videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.title = this.pet.name;
    }
    this.hit = document.createElement('div');
    this.hit.className = 'pet-hit';
    this.hit.style.left = (S.HIT_BOX.x0 / 640) * 100 + '%';
    this.hit.style.top = (S.HIT_BOX.y0 / 360) * 100 + '%';
    this.hit.style.width = ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * 100 + '%';
    this.hit.style.height = ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * 100 + '%';
    this.hit.title = this.pet.name;
    this.bubble = document.createElement('div');
    this.bubble.className = 'pet-bubble';

    stage.appendChild(this.videoA);
    stage.appendChild(this.videoB);
    stage.appendChild(this.hit);
    this.el.appendChild(this.bubble);
    this.el.appendChild(stage);
    rootEl.appendChild(this.el);
    this.position();

    // 事件（与浏览器同一套：pointerdown/move、click、window pointerup/cancel）
    const ac = new AbortController();
    this.ac = ac;
    this.hit.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal: ac.signal });
    this.hit.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal: ac.signal });
    this.hit.addEventListener('click', () => this.onClick(), { signal: ac.signal });
    this.hit.addEventListener('contextmenu', (e) => this.onContextMenu(e), { signal: ac.signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal: ac.signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal: ac.signal });
    this.hit.addEventListener('lostpointercapture', (e) => this.onPointerUp(e), { signal: ac.signal });
    // 点击穿透：窗口默认整窗穿透（main 设 setIgnoreMouseEvents(true, {forward:true})），
    // 光标进/出身体命中区时翻转可交互；穿透期间 mousemove 由 main 转发进来（forward:true），
    // mouseleave 保证光标离开窗口立即恢复穿透（透明像素不挡下层应用，与浏览器一致）。
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    window.addEventListener(
      'mouseleave',
      () => {
        // 光标离开窗口：菜单若开着立刻收起（菜单是窗口内 DOM，离开即不可达），再恢复穿透；
        // 对话弹窗开着则不恢复——弹窗是窗口内 DOM，鼠标还要回来点输入框（与 menuOpen 同守卫）
        this.closeMenu();
        if (!this.chatOpen) this.setInteractive(false);
      },
      { signal: ac.signal },
    );

    // 宠物间碰撞（跨窗 broker）：订阅其它宠物状态广播（碰撞检测用）+ 「被撞」事件 → onDeskHit。
    // 注意：退订由窗口销毁自然回收（webContents 销毁后 ipc 事件不再派发），无需显式取消。
    this.others = {}; // petId -> {x,y,vx,vy,size,bottomPad}（其它宠物的最新状态，来自主进程广播）
    this.throwState = null; // 飞行中的实时状态（被撞查询 / 其它窗碰撞检测时上报用）
    this.pressScoreFired = false; // 按下瞬间已触发过积分（pointerdown 即触发；click 据此不重复弹，同浏览器）
    this.lastFlightReport = 0;
    if (window.petBridge && window.petBridge.onFlightStates) {
      window.petBridge.onFlightStates((states) => {
        if (!states || typeof states !== 'object') return;
        const next = {};
        for (const pid of Object.keys(states)) {
          if (pid === this.pet.id) continue; // 排除自己
          const s = states[pid];
          next[pid] = {
            // 碰撞 broker 协议单位是物理像素（与窗口 bounds 一致）：÷scale 进本窗口 CSS 系（§3.5）
            x: toLocal(Number(s && s.x) || 0),
            y: toLocal(Number(s && s.y) || 0),
            vx: toLocal(Number(s && s.vx) || 0),
            vy: toLocal(Number(s && s.vy) || 0),
            size: toLocal(Number(s && s.size) || 0),
            bottomPad: toLocal(Number(s && s.bottomPad) || 0),
          };
        }
        this.others = next;
        this.socialTick(); // 宠物间互动（凑近就互相看一眼，偶尔打个招呼）
      });
      window.petBridge.onPetHit((payload) => {
        const vx = Number(payload && payload.vx);
        const vy = Number(payload && payload.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy)) this.onDeskHit(toLocal(vx), toLocal(vy));
      });
    }
  }

  dispose() {
    this.ac.abort();
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
    }
    this.closeMenu();
    this.stopThrow();
    this.stopDragFollow();
    this.stopSquash();
    this.stopMove();
    this.el.remove();
  }

  // 目标包围盒左上角（视口相对坐标）→ 移动窗口：窗口 = sprite + 四周外扩余量
  // （sprite 钉在窗口 (margin.l, margin.t)，气泡/弹窗显示在余量里）。
  // setContentBounds 要**屏幕**坐标：pos 是视口（桌面外接矩形）相对坐标，先加 VIEW.x/y
  // 再统一 ×scale 回物理像素（§3.5 IPC 收口）——主进程收到的数字与线性化旧行为逐位一致，
  // 主进程侧（bounds/去重/碰撞 broker）完全不用改。
  sendBounds(px, py) {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    window.__dshPetDebug.dragPos = { x: this.pos.x, y: this.pos.y };
    if (window.petBridge) {
      // 完整状态一次捎带：size/bottomPad 让静止宠物从首帧起就登记进碰撞站场
      // （此前只有 report-flight 带尺寸，从没飞过的宠物 size=0 被碰撞检测直接跳过）；
      // vx/vy 带当前速度——飞行中实时值、静止/拖拽 = 0，避免落地后残留上次飞行速度干扰碰撞动量。
      const fly = this.throwState;
      window.petBridge.setBounds(
        toScreen(this.pos.x - this.margin.l + VIEW.x),
        toScreen(this.pos.y - this.margin.t + VIEW.y),
        toScreen(this.size + this.margin.l + this.margin.r),
        toScreen(this.winH + this.margin.t + this.margin.b),
        toScreen(this.pos.x), // 包围盒左上角（碰撞站场用：窗口坐标 ≠ 包围盒坐标）
        toScreen(this.pos.y),
        toScreen(this.size),
        toScreen(this.bottomPad),
        fly ? toScreen(fly.vx) : 0,
        fly ? toScreen(fly.vy) : 0,
      );
    }
  }

  // 角落/边距 → 窗口位置；拖拽后按会话内位置（比例）还原——**松手无任何边界夹取**，
  // 宠物停在哪就算哪（与浏览器一致：可以完全拖出工作区/屏幕；漫游仍有 planMove 边界检查兜底）
  position() {
    const W = VIEW.w;
    const H = VIEW.h;
    let x;
    let y;
    if (this.customPos) {
      x = this.customPos.rx * W - this.halfW;
      y = this.customPos.ry * H - this.halfH;
    } else {
      // 角落取**主屏**而不是外接矩形：不规则多屏布局下外接矩形的角落可能不属于任何显示器
      // （实测右倒 T 型双屏，top-left 落在主屏上方的空洞里），配了该角落的宠物开机即隐身。
      const anchor = S.anchorPixel({
        corner: this.pet.position.corner,
        // marginX/marginY 是配置里的绝对像素：页面级缩放（§3.5）已统一放大整窗，
        // 配置值不再手工乘 CONFIG.scale——150% 屏上与「线性化 + 旧 CONFIG.scale 补偿」观感一致
        marginX: this.pet.position.marginX,
        marginY: this.pet.position.marginY,
        size: this.size,
        W,
        H,
        area: PRIMARY_AREA || undefined,
      });
      x = anchor.x;
      y = anchor.y;
    }
    this.sendBounds(x, y);
  }

  /** 抛掷空间（逐屏 AABB）。AREAS/PANELS 变化时由 relayout() 置空重建——飞行中每帧重算太浪费 */
  throwSpaceOf() {
    if (!this.space || this.space.areas !== AREAS || this.space.panels !== PANELS) {
      this.space = S.throwSpace({ areas: AREAS, panels: PANELS, size: this.size, sideAllow: this.sideAllow });
    }
    return this.space;
  }

  /**
   * 显示器几何变化（改分辨率/缩放、插拔屏、旋转）后就地重挂：
   * 抛掷空间作废，并把宠物从可能变成空洞的位置拉回可见区。
   * 拖拽中不动它（用户正握着，位置由指针决定）；飞行中也不动（下一帧物理自会按新边界夹取）。
   */
  relayout() {
    this.space = null;
    if (this.dragState.active || this.throwRef !== null) return;
    this.stopMove();
    // 显示器几何变了：停在边缘的那半只身子会被下面的夹取拉回可见区（它的中心本来就在屏外），
    // 所以先解除停留并站直，避免"被拉回来了却还歪着"。
    this.unparkEdge();
    const cx = this.pos.x + this.halfW;
    const cy = this.pos.y + this.halfH;
    const p = S.clampPointToRegion(AREAS, cx, cy);
    if (p.x !== cx || p.y !== cy) {
      this.customPos = { rx: p.x / VIEW.w, ry: p.y / VIEW.h };
    }
    this.position();
  }

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * VIEW.w;
    return this.pos.x + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * VIEW.h;
    return this.pos.y + this.halfH;
  }

  // 双缓冲切换（与浏览器同一套：前台 opacity 切换 + 降级视频清 handler 并停播，防残留 ended 雪崩）
  switchTo(next, nextOnce) {
    if (!next) return;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) {
      // 防重命中（单动画点击时目标=当前动画，不重播）：仍消费 Q 弹标记，压当前前台视频，
      // 保证「点击唯一动画」时挤压反馈不丢（与浏览器同构）。
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(this.front === 0 ? this.videoA : this.videoB);
      }
      return;
    }
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const target = this.front === 0 ? this.videoB : this.videoA;
    const el = target;
    if (!el) return;
    el.src = this.assetBase + encodeURIComponent(next) + (S.ANIMATION_EXT || '.webm');
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    // 加载兜底（与浏览器 web 端 fetch+blob 的 10s 超时同义）：素材加载失败或卡住时必须释放
    // pending，否则它永久挂起——之后相同目标会被防重分支吞掉、不同目标靠 gen 覆盖，
    // 表现就是"点了没反应"（#62 报告的就是 web 端同一类问题，桌面端此前完全没有兜底）。
    const loadGuard = (why) => {
      if (!this.pending || this.pending.gen !== gen) return;
      this.pending = null;
      console.warn('[dsh-pet] 素材加载失败 pet=' + this.pet.id + ' anim=' + next + '：' + why + '（已释放本次切换）');
      // 【补】释放之后必须**把随机链重新点着**：这次动画根本没播起来 → 不会有 ended →
      // handleEnded 永远不会来 → 链子就此永久停摆（表现：宠物定格在最后一帧，再也不换动作，
      // 也不再有随机小动作）。加一个带次数上限的重试，避免素材真的缺失时无限重试。
      this.loadRetries = (this.loadRetries || 0) + 1;
      if (this.loadRetries > 20) {
        console.warn('[dsh-pet] 连续加载失败 ' + this.loadRetries + ' 次，停止自动重试（等下一次拖拽/点击触发）');
        return;
      }
      window.setTimeout(() => {
        if (this.pending || this.disposed || (this.dragState && this.dragState.active)) return;
        this.playIdle();
      }, 1500);
    };
    const loadTimer = window.setTimeout(() => loadGuard('10s 超时'), 10000);
    el.onerror = () => {
      window.clearTimeout(loadTimer);
      loadGuard('video error');
    };
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      window.clearTimeout(loadTimer);
      el.onerror = null;
      if (this.pending && this.pending.gen !== gen) return;
      const old = this.front === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        old.pause();
      }
      this.front = this.front === 0 ? 1 : 0;
      this.pending = null;
      this.loadRetries = 0; // 切换成功 → 重置加载失败计数（见 loadGuard）
      el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      el.play().catch(() => {});
      // 点击 Q 弹：等新动画就位后才压（压的是新点击动画的首帧，与浏览器一致）
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(el);
      }
      if (this.pendingMove) this.startMoveDrive(el);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }

  playOnce(name) {
    this.anim = name;
    this.once = true;
    this.switchTo(name, true);
  }

  // 动画链（与浏览器 pickNext 语义一致，纯逻辑在 shared）
  playIdle() {
    this.stopMove();
    // 桌面专属「边缘待机」：命中概率且过了冷却就整段接管（见 tryEdgeIdle）；返回 false = 本次
    // 不触发，照常走下面的随机链。放在链首而不是并进权重表：它不只是"换个动画"，而是
    // 整窗位置都要挪到屏幕边缘外，任何滚进来的普通权重都会让"这次不改位置"的假设失效。
    if (this.tryEdgeIdle()) return;
    // 停在屏幕边缘期间：只从"看得清"动作池里抽（配置 animations.edge.parkedPool）——
    // 此刻只露头+一点上身，随机链里的玩魔方/吃东西/走路之类在可见区里根本看不出在干嘛。
    if (this.edgeParked) {
      const parkedCfg = this.edgeCfg();
      const pool = parkedCfg ? parkedCfg.parkedPool : [];
      if (pool.length) {
        this.playOnce(S.pick(pool, this.anim));
        return;
      }
    }
    const { animations, animationWeights } = { animations: this.animations, animationWeights: this.weights };
    const roll = Math.random();
    // 宠物固定（pets[].fixedEnabled）：掷骰时把「转向 / 移动」两档权重按 0 算（与浏览器同一份
    // 决策）——随机链不再让宠物自己翻朝向或走开。右键菜单点播与 /anim 接口不走这里，不受影响。
    const k = S.rollKind(roll, animationWeights, { fixed: this.pet.fixedEnabled });
    let next;
    if (k === 'idle') {
      next = S.pick(animations.idle, this.anim);
    } else if (k === 'turn') {
      next = S.pick(animations.turn, this.anim);
    } else if (k === 'move') {
      const moved = this.tryMove();
      if (moved === false) {
        const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
        next = act.name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        // 已有一场移动进行中（占用）：与浏览器一致，重播当前动画，不另设（绝不重复加载不存在的动作）
        this.playOnce(this.anim);
        return;
      }
    } else {
      const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
      next = act.name;
    }
    this.playOnce(next);
  }

  /**
   * 「看鼠标」：主进程按 POINTER_POLL_MS 转发真实光标位置（屏幕物理像素），这里换算成她自己的坐标系做反应。
   *
   * 只做三件事，且都避开交互状态、都带冷却，绝不打断她正在做的事：
   *   1) 光标靠近（默认 2.4 倍身宽内）→ 只翻镜像朝它那侧（零成本；2 秒内不重复翻，免得和转身链打架）
   *   2) 贴到身上（默认 0.8 倍身宽内）→ 从 **clicks 池** 挑一段打招呼（默认 60 秒一次）
   *   3) 只是在附近 → 从 **turn 池** 挑一段张望（默认 25 秒一次）
   *
   * 为什么从池子里挑而不是写死动作名：每只宠物素材不同（蓝毛是"东张西望 / 点击回应-*"，
   * 粉毛是"左右看 / 转身 / 打招呼"），从她自己的池子里挑才能两只都自然，将来加素材也不用改代码。
   * 拖拽 / 漫游 / 抛掷 / 边缘序列 / 边缘停驻期间一律不打扰（那些状态下位置或姿态由别的调度负责）。
   * 配置：animations.cursor = { enabled, lookRadius, greetRadius, lookCooldownSec, greetCooldownSec, look, greet }
   */
  onCursorPoint(p) {
    const cfg = this.cursorCfg;
    if (!cfg || cfg.enabled === false || !p) return;
    // 拖拽 / 漫游 / 抛掷 / 边缘探头序列进行中不打扰（那些状态下位置与姿态由别的调度负责）。
    // 注意**不含 edgeParked**：她停在屏幕边缘时只露出一点，但那点也该能"看你"；
    // 而且那种状态下她的包围盒中心常常在屏幕外，所以下面要把参考点夹回桌面范围。
    if (this.dragState.active || this.moveRef !== null || this.throwRef !== null || this.edgeSeq) return;
    const x = toLocal(Number(p.x));
    const y = toLocal(Number(p.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const half = this.halfW;
    // 参考点 = 她的包围盒中心，夹回桌面范围：停驻 / 半出屏时用"露出来的那部分"算距离。
    // 不夹的话中心在屏幕外，真实光标永远够不着 → 她一停边缘，"看鼠标"就永久失效。
    let cx = this.pos.x + half;
    let cy = this.pos.y + half;
    if (VIEW && Number.isFinite(VIEW.w)) {
      cx = Math.min(Math.max(cx, VIEW.x), VIEW.x + VIEW.w);
      cy = Math.min(Math.max(cy, VIEW.y), VIEW.y + VIEW.h);
    }
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist > (cfg.lookRadius ?? 2.4) * half) return;
    const now = performance.now();
    // 1) 朝光标那侧（只翻镜像，不换动画）
    const want = dx < 0 ? 'left' : 'right';
    if (this.facing !== want && now - this.lastFaceFlipAt > 2000) {
      this.lastFaceFlipAt = now;
      this.setFacing(want);
    }
    // 2) 贴到身上 → 打招呼（clicks 池）。停驻在屏幕边缘时不打：半个身子在屏幕外，跳起来打招呼很怪。
    if (
      cfg.greet !== false &&
      !this.edgeParked &&
      dist < (cfg.greetRadius ?? 0.8) * half &&
      this.animations.clicks.length &&
      now - this.lastGreetAt > (cfg.greetCooldownSec ?? 60) * 1000
    ) {
      this.lastGreetAt = now;
      this.lastLookAt = now; // 打过招呼也算"看过你"，顺带压掉紧随其后的张望
      this.playOnce(S.pick(this.animations.clicks, this.anim));
      return;
    }
    // 3) 在附近 → 朝它张望（turn 池）
    if (
      cfg.look !== false &&
      this.animations.turn.length &&
      now - this.lastLookAt > (cfg.lookCooldownSec ?? 25) * 1000
    ) {
      this.lastLookAt = now;
      this.playOnce(S.pick(this.animations.turn, this.anim));
    }
  }

  /** 只翻镜像、不换动画：光标在她哪一侧，她就朝哪边。 */
  setFacing(next) {
    if (next !== 'left' && next !== 'right') return;
    if (this.facing === next) return;
    this.facing = next;
    const el = this.front === 0 ? this.videoA : this.videoB;
    if (el) el.style.transform = next === 'right' ? 'scaleX(-1)' : '';
  }

  /**
   * 宠物间互动：跟别的宠物凑得太近就互相看一眼，偶尔打个招呼。
   *
   * 位置数据是现成的 —— 主进程每次位置上报都会把**所有宠物**的状态广播过来（跨窗碰撞 broker），
   * 渲染端早就订阅了（this.others，且已经换算到同一坐标系），所以这里不需要任何新通道。
   * 判定节流到 2Hz（广播是逐帧来的，没必要每帧算）。
   *
   * 打招呼：只在**从"分开"变成"凑近"的那一刻**触发一次，且带概率与冷却 —— 否则两只挨着坐着
   * 会没完没了地互相打招呼。台词从自己的台词表里随机抽，走宿主 /broadcast 写气泡（**零模型成本**），
   * 动作从自己的 clicks 池里抽（所以粉毛冒爱心、蓝毛是点击回应-*，各自自然）。
   *
   * 配置：animations.social = { enabled, radiusRatio, greetChance, greetCooldownSec, lines }
   */
  socialTick() {
    const cfg = this.socialCfg;
    if (!cfg || cfg.enabled === false) return;
    const now = performance.now();
    if (now - this.socialTickAt < 500) return;
    this.socialTickAt = now;
    // 拖拽 / 漫游 / 抛掷 / 边缘探头序列 / 停在边缘：一律不掺和（位置或姿态由别的调度负责）
    if (this.dragState.active || this.moveRef !== null || this.throwRef !== null || this.edgeSeq || this.edgeParked) return;
    const half = this.halfW;
    const myCx = this.pos.x + half;
    const myCy = this.pos.y + half;
    let near = null;
    let nearDist = Infinity;
    for (const pid of Object.keys(this.others)) {
      const o = this.others[pid];
      if (!o || !o.size) continue;
      const dx = o.x + o.size / 2 - myCx;
      const dy = o.y + o.size / 2 - myCy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearDist) {
        nearDist = d;
        near = { pid, dx };
      }
    }
    if (!near || nearDist > (cfg.radiusRatio ?? SOCIAL_DEFAULT.radiusRatio) * this.size) {
      this.socialNearId = null; // 分开了：下次再凑近才重新判定
      return;
    }
    // 面对面：朝对方那侧（只翻镜像，不换动画）
    const want = near.dx < 0 ? 'left' : 'right';
    if (this.facing !== want && now - this.lastFaceFlipAt > 2000) {
      this.lastFaceFlipAt = now;
      this.setFacing(want);
    }
    if (this.socialNearId === near.pid) return; // 已经凑在一起了，不重复触发
    this.socialNearId = near.pid;
    // 刚凑近：按概率打招呼（同两只之间有冷却）
    if (now - this.socialGreetAt < (cfg.greetCooldownSec ?? SOCIAL_DEFAULT.greetCooldownSec) * 1000) return;
    if (Math.random() > (cfg.greetChance ?? SOCIAL_DEFAULT.greetChance)) return;
    this.socialGreetAt = now;
    const lines = Array.isArray(cfg.lines) && cfg.lines.length ? cfg.lines : SOCIAL_DEFAULT.lines;
    this.socialSay(lines);
    if (this.animations.clicks.length) this.playOnce(S.pick(this.animations.clicks, this.anim));
  }

  /** 随机挑一句台词发到自己窗口的气泡：走宿主 /broadcast?pet=<自己>（纯文本，不经模型） */
  socialSay(lines) {
    let text = lines[Math.floor(Math.random() * lines.length)];
    if (lines.length > 1 && text === this.socialLastLine) {
      text = lines[(lines.indexOf(text) + 1) % lines.length]; // 尽量别连着说同一句
    }
    this.socialLastLine = text;
    try {
      fetch(BASE + '/broadcast?pet=' + encodeURIComponent(this.pet.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(() => {});
    } catch {
      /* 气泡是锦上添花，失败无所谓 */
    }
  }

  handleEnded() {
    if (this.dragState.active) return;
    // 边缘待机进行中：这一段由本序列自己推进（探头张望播完 → 退回原位），绝不落进随机链——
    // 否则会出现"一边往回缩一边又抽到别的动作"的两套调度互相打架（位置与动画各走各的）。
    if (this.edgeSeq) {
      this.onEdgeAnimEnded();
      return;
    }
    const { animations } = { animations: this.animations };
    // 事件动画播完：回 idle（与 drag/clicks 同分支，不进随机链）；气泡由定时器自动消失，与动画解耦
    const isEvent = S.isEventAnim(animations.events, this.anim);
    if (isEvent) {
      // 工作状态多候选档位：播完一段自动轮换到下一候选（排除当前段，避免连抽），继续循环——
      // 长时间状态不单段重复（与浏览器 ended 护栏共用同一决策 nextWorkStatusAnim）。
      // 仅非终态档位轮换；终态（success/error）播完一次即结束，绝不轮换续播。单候选档位由
      // loop 无限循环（不触发 ended，不会走到这里）。
      const nonTerminal = this.workState && this.workState !== 'success' && this.workState !== 'error';
      const nextWork = nonTerminal ? S.nextWorkStatusAnim(animations.events?.workStatus ?? [], this.anim) : null;
      if (nextWork !== null) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' workStatus 档内轮换: ' +
            this.anim +
            ' -> ' +
            nextWork,
        );
        this.playOnce(nextWork); // 继续播一遍（once=true）→ ended 再轮换
        return;
      }
      // 非 workStatus 事件动画（余额/碎碎念）播完：workStatus 仍非终态 → 立即恢复档位循环动画，
      // 不进随机链（长事件期间状态不变，随机链会一直播到状态切换才被拉回）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    if (animations.turn.includes(this.anim)) {
      const next = this.facing === 'left' ? 'right' : 'left';
      this.facing = next; // 立即同步：翻转后的 pickNext 用新朝向过滤 noMirror
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      // 互动动画播完：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器同一语义）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    this.playIdle();
  }

  // 互动/事件动画播完后恢复 workStatus 档位循环：非终态 → 按当前状态档位重选动画（多候选档内
  // 随机并避开当前段）；终态/空闲 → false 不接管，调用方走原逻辑（回 idle / 随机池，与浏览器一致）。
  resumeWorkStatusAnim() {
    const state = this.workState;
    if (!state || state === 'success' || state === 'error') return false;
    const pool = this.animations.events?.workStatus;
    if (!pool || pool.length === 0) return false;
    const idx = S.WORK_STATUS_INDEX[state];
    const slot = pool[idx];
    if (slot === undefined) return false;
    const name = S.pickSlot(slot, this.anim); // 避开当前正播动画（避免连续重复）
    console.log(
      '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id + ' 恢复工作状态动画: ' + name,
    );
    const rotating = Array.isArray(slot) && slot.length > 1;
    if (rotating)
      this.playOnce(name); // 多候选：播完由 handleEnded 轮换
    else this.switchTo(name, false); // 单候选：无限循环
    return true;
  }

  // ---- 漫游（rAF 驱动，动画首尾各 leadSec/tailSec 秒原地不动；几何在 shared/planMove） ----
  // preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机选
  tryMove(preferredName) {
    // 停在边缘期间不自行漫游：随机链若抽到"移动"，就当抽不中退回原地小动作
    // （否则它自己走两步就出来了，与"除非再拖它"的语义相反）
    if (this.edgeParked) return false;
    if (this.moveRef !== null || this.pendingMove || this.throwRef !== null) return true;
    const moves = this.animations.moves;
    const actions = moves.actions;
    if (!actions.length) return false;
    const chosen = preferredName
      ? actions.find((a) => a.name === preferredName) || null
      : actions[Math.floor(Math.random() * actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    const dir = (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;
    const W = VIEW.w;
    const H = VIEW.h;
    const distScale = this.size / S.PET_REF_WIDTH;
    const plan = S.planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),
      W,
      H,
      dir,
      minDist: mp.minDist * distScale,
      maxDist: mp.maxDist * distScale,
      margin: mp.margin, // 同 position() 的 marginX/marginY：页面级缩放统一放大，配置值不再乘 scale（§3.5）
      halfW: this.halfW,
      sideAllow: this.sideAllow,
      // 落点按显示器并集判定：能骑缝跨屏走，但走不进外接矩形里的空洞
      areas: AREAS,
    });
    if (!plan) return false;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.anim = chosen.name;
    this.once = true;
    this.switchTo(chosen.name, true);
    return chosen.name;
  }

  startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRef !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const W = VIEW.w;
    const H = VIEW.h;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX;
      if (t <= leadSec) ratioX = startRatio;
      else if (t >= duration - tailSec) ratioX = targetRatio;
      else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
      // 移动的是窗口（宠物包围盒跟随），sprite 在本窗口内不动
      this.sendBounds(ratioX * W - this.halfW, startYRatio * H - this.halfH);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = null;
        this.customPos = { rx: targetRatio, ry: startYRatio };
      }
    };
    this.moveRef = requestAnimationFrame(step);
  }

  stopMove() {
    // 边缘待机走到任何"停漫游"路径（拖拽/抛掷/菜单/回家/重载）都必须整段取消，且默认把宠物
    // 送回原位——绝不让它留在屏幕外那个看不见的地方（见 cancelEdgePeek）。
    if (this.edgeSeq) this.cancelEdgePeek(true);
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
  }

  // ---- 边缘待机（桌面模式专属）：藏到屏幕左/右边缘外 → 探头张望 → 退回原位 ----
  // 为什么只在桌面端：浏览器 overlay 里"屏幕边缘"就是页面视口边缘，被裁掉一部分仍然贴在网页内容上，
  // 做不出"躲到屏幕外再探头"的观感；桌面端每只宠物是一个独立透明窗，把窗口挪出屏幕就是真·藏起来。
  // 位置驱动与漫游完全同一套（sendBounds 挪窗口 + moveRef/moveToken 取消），所以拖动/抛掷/菜单/
  // 重载/显示器变化这些既有路径一行都不用改，它们自带的 stopMove() 就是本序列的取消入口。
  //
  // 参数全部来自配置 animations.edge（见 assets/config.jsonc）；缺省或字段写错一律走 EDGE_IDLE_DEFAULT
  // ——也就是说**一行配置都不写也照常工作**（用户配置层整段替换掉 animations 时不会静默失去这个功能）。
  edgeCfg() {
    const raw = this.animations ? this.animations.edge : null;
    const e = raw && typeof raw === 'object' ? raw : {};
    if (e.enabled === false) return null; // 关掉：自动链不触发（右键菜单手动仍可点）
    const pool = (Array.isArray(e.pool) ? e.pool : EDGE_IDLE_DEFAULT.pool).filter((n) => typeof n === 'string' && n);
    if (!pool.length) return null; // 一个可播的名字都没有：整段停用（名字即文件名，不能瞎猜）
    const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    return {
      chance: clamp(num(e.chance, EDGE_IDLE_DEFAULT.chance), 0, 1),
      cooldownMs: Math.max(0, num(e.cooldownSec, EDGE_IDLE_DEFAULT.cooldownSec) * 1000),
      side: e.side === 'left' || e.side === 'right' ? e.side : 'random',
      pool,
      peekRatio: clamp(num(e.peekRatio, EDGE_IDLE_DEFAULT.peekRatio), 0.1, 0.95),
      keepY: e.keepY !== false, // 默认保持当前高度（false = 在所在屏内竖直居中）
      hideMs: Math.max(0, num(e.hideMs, EDGE_IDLE_DEFAULT.hideMs)),
      peekMs: Math.max(0, num(e.peekMs, EDGE_IDLE_DEFAULT.peekMs)),
      returnMs: Math.max(0, num(e.returnMs, EDGE_IDLE_DEFAULT.returnMs)),
      holdMs: Math.max(0, num(e.holdMs, EDGE_IDLE_DEFAULT.holdMs)),
      // 拖拽触发：把宠物拖到屏幕左/右边缘附近松手，就从那一侧探头（见 edgeIdleFromDrop）。
      // 阈值默认按宠物宽度取比例（大宠物"看着近"的距离本来就更大），也可用 triggerDist 写死 px。
      dropTrigger: e.dropTrigger !== false,
      triggerDist: Math.max(
        0,
        num(e.triggerDist, this.size * num(e.triggerDistRatio, EDGE_IDLE_DEFAULT.triggerDistRatio)),
      ),
      // 斜着倒的姿态：tiltDeg = 倾角（度，0 = 不倾，站直）；tiltDir = 头朝屏幕里('in')/外('out')；
      // tiltPivot = 旋转支点（脚底 / 身体中心）；tiltScope = 只在探头张望时倾('peek')/整段都倾('all')
      tiltDeg: clamp(num(e.tiltDeg, EDGE_IDLE_DEFAULT.tiltDeg), -90, 90),
      tiltDir: e.tiltDir === 'out' ? 'out' : 'in',
      tiltPivot: e.tiltPivot === 'center' ? 'center' : 'feet',
      tiltScope: e.tiltScope === 'all' ? 'all' : 'peek',
      // 留在边缘：探头看完不转正、也不回原位，就缩在屏幕边只露上半身，
      // 直到用户再把它拖出来（拖动天然取消一切、位置交给拖拽）。false = 旧行为（退回原位）
      parkAtEdge: e.parkAtEdge !== false,
      // 停在边缘期间专用的"看得清"动作池（实机逐帧筛过；空数组 = 退回原随机链）
      parkedPool: (Array.isArray(e.parkedPool) ? e.parkedPool : EDGE_IDLE_DEFAULT.parkedPool).filter(
        (n) => typeof n === 'string' && n,
      ),
    };
  }

  /** 舞台变换 = 底垫下移 + 边缘待机的倾斜姿态。拖拽期间舞台被拍平（transform:none），这里不插手 */
  applyStageTransform() {
    if (!this.stage) return;
    if (this.dragState && this.dragState.active) return;
    const tilt = this.edgeTilt ? ' rotate(' + this.edgeTilt.toFixed(2) + 'deg)' : '';
    this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)' + tilt;
  }

  /** 设置当前倾斜角（度）并就地应用 */
  setEdgeTilt(deg) {
    this.edgeTilt = deg;
    this.applyStageTransform();
  }

  /**
   * 这一侧的倾斜目标角（度，带符号）。CSS 的 rotate 正角 = 顺时针（y 轴向下）——
   * 左边缘：头朝屏幕里 = 顺时针(+)，朝外 = 逆时针(-)；右边缘整个镜像。
   * 数值 = tiltDeg × 方向，所以 tiltDeg=0 时整段退化为"不倾斜"（与加这个功能之前完全一致）。
   */
  edgeTiltTarget(e, side) {
    if (!e.tiltDeg) return 0;
    return e.tiltDeg * (side === 'left' ? 1 : -1) * (e.tiltDir === 'out' ? -1 : 1);
  }

  /** 随机待机链的入口：命中概率且过了冷却就交棒（true = 本次已接管，调用方别再抽别的动作） */
  tryEdgeIdle() {    const e = this.edgeCfg();
    if (!e || e.chance <= 0) return false;
    // 宠物固定（pets[].fixedEnabled）：不自己挪窝——边缘待机整段都是挪窗，与 turn/move 同一条约束
    if (this.pet.fixedEnabled) return false;
    if (performance.now() < this.edgeNextAt) return false; // 冷却中
    if (Math.random() >= e.chance) return false;
    return this.startEdgePeek(e);
  }

  /**
   * 起一段边缘待机。坐标全是**视口（桌面外接矩形）相对**的包围盒左上角，与 position()/sendBounds
   * 同一套；边界取宠物**当前所在那块屏**的工作区（多屏下左屏的左缘、右屏的右缘各算各的）。
   * 三段位移：outX = 该屏外侧一个身位（整只都在屏外 = 藏好了）；peekX = 只把 peekRatio 那部分留在
   * 屏内（探头）；homeX/homeY = 触发时它自己站的地方（退回原位）。
   */
  startEdgePeek(e, forcedSide) {
    if (this.edgeSeq) return false;
    if (this.dragState.active || this.throwRef !== null || this.moveRef !== null || this.pendingMove) return false;
    const area = S.resolveRect(AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH) || PRIMARY_AREA;
    if (!area || !(area.width > 0) || !(area.height > 0)) return false;
    // forcedSide：拖拽触发时由**松手的那一侧**决定（用户意图），否则按配置/随机
    const side =
      forcedSide || (e.side === 'random' ? (Math.random() < 0.5 ? 'left' : 'right') : e.side);
    const outX = side === 'left' ? area.x - this.size : area.x + area.width;
    const peekX =
      side === 'left' ? area.x - this.size * (1 - e.peekRatio) : area.x + area.width - this.size * e.peekRatio;
    const homeX = this.pos.x;
    let homeY = e.keepY ? this.pos.y : area.y + (area.height - this.height) / 2;
    // 纵向夹进该屏：探头时人不能跑到屏幕上下沿外（横向故意越界——那才是"探头"）
    homeY = Math.min(Math.max(homeY, area.y), area.y + Math.max(0, area.height - this.height));
    // 斜着倒的支点：默认脚底（FEET_Y/CANVAS_H，人物站姿的落点）——以脚为轴歪才像"人倒了"，
    // 绕盒子中心转看起来像整块贴图在打转。支点与角度都随本段序列定，结束/取消时复位。
    this.stage.style.transformOrigin =
      e.tiltPivot === 'center' ? '50% 50%' : '50% ' + ((S.FEET_Y / S.CANVAS_H) * 100).toFixed(3) + '%';
    this.setEdgeTilt(0);
    this.edgeSeq = {
      cfg: e,
      side,
      outX,
      peekX,
      homeX,
      homeY,
      face: side === 'left' ? 'right' : 'left', // 探头时朝屏幕内（朝里张望，不朝屏幕外）
      tilt: this.edgeTiltTarget(e, side), // 本段的目标倾角（0 = 不倾）
      name: S.pick(e.pool),
      phase: '',
      peekEnded: false,
    };
    // 冷却从"开始"计：整段可能持续十几秒，从结束计会让下次触发挤在紧接着的下一轮
    this.edgeNextAt = performance.now() + e.cooldownMs;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' 边缘待机开始：' +
        (side === 'left' ? '左' : '右') +
        '侧，探头动画 ' +
        this.edgeSeq.name,
    );
    this.edgePhase('hide');
    return true;
  }

  /** 相位推进：hide（滑出去藏好）→ peek（探头 + 起张望动画）→ hold（等它看完）→ return（退回原位） */
  edgePhase(phase) {
    const seq = this.edgeSeq;
    if (!seq) return;
    seq.phase = phase;
    const e = seq.cfg;
    const fx = this.pos.x; // 本段起点 = 宠物此刻真实所在（中途有别的移动插进来也不会跳帧）
    const fy = this.pos.y;
    if (phase === 'hide') {
      // 还保持原朝向、继续播当前动画：这一段是"退到屏幕后面去"，不是表演。
      // tiltScope='all' 时连这一段一起倒（看得见它歪着缩出去）；默认 'peek' 只在探头段才倒。
      this.edgeSlide(
        fx,
        fy,
        seq.outX,
        seq.homeY,
        e.hideMs,
        (u) => u * u * u,
        () => this.edgePhase('peek'),
        e.tiltScope === 'all' ? { from: 0, to: seq.tilt } : null,
      );
      return;
    }
    if (phase === 'peek') {
      // 朝向必须在 switchTo **之前**定：镜像是在视频 loadeddata 时按当时的 facing 一次性写上的
      this.facing = seq.face;
      // 复位"播完了"标记：hide 段里上一条一次性动画结束（handleEnded 会走到 onEdgeAnimEnded）
      // 会把它置 true，若不带进 peek 段就会一进 hold 立刻往回走，等于没探头。
      seq.peekEnded = false;
      this.playOnce(seq.name); // 探头张望（播完由 handleEnded → onEdgeAnimEnded 推进）
      // 一边探出头一边倒下去：倾斜与位移同一段时间、同一条缓动曲线（画面才对得上）
      this.edgeSlide(
        fx,
        fy,
        seq.peekX,
        seq.homeY,
        e.peekMs,
        (u) => 1 - Math.pow(1 - u, 3),
        () => this.edgePhase('hold'),
        { from: e.tiltScope === 'all' ? seq.tilt : 0, to: seq.tilt },
      );
      return;
    }
    if (phase === 'hold') {
      // 正常由动画播完推进；这里的定时器只是保险：素材 404 / 加载卡住时也能自己退回来
      if (seq.peekEnded) {
        this.edgeAfterHold();
        return;
      }
      this.edgeTimer = window.setTimeout(() => {
        this.edgeTimer = null;
        this.edgeAfterHold();
      }, e.holdMs);
      return;
    }
    if (phase === 'return') {
      if (this.edgeTimer !== null) {
        window.clearTimeout(this.edgeTimer);
        this.edgeTimer = null;
      }
      // 回程换成待机动画：张望动画是"播完即停"的，冻在末帧平移回去会很僵。
      // 用 once=true（而不是 switchTo(name, false) 循环）是必须的——回程较长，若这段被动漫/抛掷
      // 之类的路径打断，循环动画永远不触发 ended，随机链就再也回不来了（宠物会一直原地待机）。
      const idle = this.animations.idle;
      if (idle && idle.length) this.playOnce(S.pick(idle, this.anim));
      this.edgeSlide(
        fx,
        fy,
        seq.homeX,
        seq.homeY,
        e.returnMs,
        (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
        () => this.finishEdgePeek(),
        { from: seq.tilt, to: 0 }, // 退回去的同时站直
      );
    }
  }

  /** hold 结束（张望动画播完，或保险超时）：要留边缘就停住，否则走回程转正退回原位 */
  edgeAfterHold() {
    const seq = this.edgeSeq;
    if (!seq || seq.phase !== 'hold') return;
    if (seq.cfg.parkAtEdge) this.parkEdgePeek();
    else this.edgePhase('return');
  }

  /**
   * 探头看完后**留在屏幕边缘**：不转正、也不回原位，就保持"斜着缩在边上只露上半身"的样子，
   * 直到用户再把它拖出来（拖动会取消一切、把位置交给拖拽——见 onPointerDown 的 unparkEdge）。
   *
   * 与 finishEdgePeek 的分工：那个是"看完了，回原位站直"的旧收尾，只在 parkAtEdge=false 时走。
   */
  parkEdgePeek() {
    const seq = this.edgeSeq;
    if (!seq) return;
    this.edgeSeq = null;
    if (this.edgeTimer !== null) {
      window.clearTimeout(this.edgeTimer);
      this.edgeTimer = null;
    }
    // 姿态保留（斜着），位置固定在探头点；customPos 记成这里，resize 重排也回得来
    this.edgeParked = { side: seq.side, tilt: seq.tilt };
    this.sendBounds(seq.peekX, seq.homeY);
    this.customPos = { rx: (seq.peekX + this.halfW) / VIEW.w, ry: (seq.homeY + this.halfH) / VIEW.h };
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' 边缘待机：已停在' +
        (seq.side === 'left' ? '左' : '右') +
        '侧边缘（等用户再拖它出来）',
    );
    this.playIdle(); // 位置/姿态都保持，只把动画链接回随机待机
  }

  /**
   * 解除"停在边缘"：站直、允许自行漫游。用户拖动 / 点「回到初始位置」/ 点播移动动画 /
   * 显示器变化触发 relayout 时都会走到这里——这些语义都是"它该出来了"。
   */
  unparkEdge() {
    if (!this.edgeParked) return;
    this.edgeParked = null;
    this.setEdgeTilt(0);
  }

  /** 探头动画播完：在 hold 相位就推进（留边缘或回程）；在滑入阶段就播完则只做标记，别干等 */
  onEdgeAnimEnded() {
    const seq = this.edgeSeq;
    if (!seq) return;
    if (seq.phase === 'hold') {
      this.edgeAfterHold();
      return;
    }
    seq.peekEnded = true;
  }

  /** 相位滑行：rAF 把包围盒从 (fx,fy) 缓动到 (tx,ty)，tilt 给了就同时插值倾斜角。
   *  复用 moveRef/moveToken，于是所有既有的"停止移动"路径（stopMove → cancelEdgePeek）
   *  都能把它一起取消。 */
  edgeSlide(fx, fy, tx, ty, ms, ease, done, tilt) {
    const token = ++this.moveToken;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
    if (ms <= 0) {
      this.sendBounds(tx, ty);
      if (tilt) this.setEdgeTilt(tilt.to);
      if (done) done();
      return;
    }
    const t0 = performance.now();
    const step = () => {
      if (this.moveToken !== token || !this.edgeSeq) return;
      const u = Math.min((performance.now() - t0) / ms, 1);
      const k = ease(u);
      if (tilt) this.setEdgeTilt(tilt.from + (tilt.to - tilt.from) * k);
      this.sendBounds(fx + (tx - fx) * k, fy + (ty - fy) * k);
      if (u < 1) {
        this.moveRef = requestAnimationFrame(step);
        return;
      }
      this.moveRef = null;
      if (done) done();
    };
    this.moveRef = requestAnimationFrame(step);
  }

  /** 收尾：回到原位、站直、记住这个位置（customPos），交还随机待机链 */
  finishEdgePeek() {
    const seq = this.edgeSeq;
    if (!seq) return;
    this.edgeSeq = null;
    if (this.edgeTimer !== null) {
      window.clearTimeout(this.edgeTimer);
      this.edgeTimer = null;
    }
    this.setEdgeTilt(0); // 站直（return 段已经转回 0，这里兜底，保证任何路径都不会留下歪着的姿态）
    this.customPos = { rx: (seq.homeX + this.halfW) / VIEW.w, ry: (seq.homeY + this.halfH) / VIEW.h };
    this.sendBounds(seq.homeX, seq.homeY);
    this.playIdle(); // 注意：此刻 edgeSeq 已清空，不会再被 stopMove 当成"取消"处理
  }

  /**
   * 取消边缘待机（任何"停漫游"路径都会走到这里）。默认**把宠物送回原位**：取消有可能发生在它
   * 整个藏在屏幕外的时候（重载配置 / 显示器变化），不送回去就等于当场隐身。
   * 用户主动抓它时传 false —— 那时宠物正被指针拿着，位置交给拖拽，绝不在这里跳一下。
   */
  cancelEdgePeek(restore) {
    const seq = this.edgeSeq;
    if (!seq) return;
    // hide 相位还没接管前台动画：此刻取消的话，链上就没有任何"播完"信号了（见 resumeEdgeChain）
    const noAnimYet = seq.phase === 'hide';
    this.edgeSeq = null;
    if (this.edgeTimer !== null) {
      window.clearTimeout(this.edgeTimer);
      this.edgeTimer = null;
    }
    // 作废在途的 rAF 帧：本方法也可能由 stopMove() 之外的路径调用（onPointerDown 提前取消）
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
    // 站直：取消可能发生在"已经歪着"的时候（拖拽抓走 / 显示器变化 / 重载），
    // 不复位的话宠物会一直保持 60° 斜着 —— 姿态是序列的一部分，序列没了姿态也要还回去。
    this.setEdgeTilt(0);
    if (noAnimYet) this.resumeEdgeChain();
    if (!restore) return;
    // 元件已摘（dispose 的收尾）时不再发 IPC，免得给正在销毁的窗口排一次无意义的移动
    if (!this.el || !this.el.isConnected) return;
    if (Math.abs(this.pos.x - seq.homeX) > 1 || Math.abs(this.pos.y - seq.homeY) > 1) {
      this.customPos = { rx: (seq.homeX + this.halfW) / VIEW.w, ry: (seq.homeY + this.halfH) / VIEW.h };
      this.sendBounds(seq.homeX, seq.homeY);
    }
  }

  /**
   * 补一段一遍制待机动画，把随机链续上。
   *
   * 为什么需要：随机链靠视频的 ended 事件推进（handleEnded → playIdle）。边缘待机在 hide 相位
   * **故意不换动画**（那一段只是"退到屏幕后面去"），所以这时被打断的话前台可能压根没有在播的视频，
   * ended 永远不会来 —— 宠物就永久停在那一帧（实测：开机时主进程推送显示器几何 → relayout →
   * stopMove 抢在 hide 相位，正好命中）。补一遍制待机即可让链重新有推进信号。
   */
  resumeEdgeChain() {
    const idle = this.animations.idle;
    if (idle && idle.length) this.playOnce(S.pick(idle, this.anim));
  }

  /** 右键菜单「边缘待机」：手动立刻来一段（不受概率与冷却限制；进行中则忽略） */
  edgeIdleFromMenu() {
    const e = this.edgeCfg();
    if (!e || this.edgeSeq) return;
    this.edgeNextAt = 0;
    this.startEdgePeek(e);
  }

  /**
   * 包围盒左上角 (x,y) 离「它所在那块屏」的左/右边缘够不够近：返回 'left' / 'right' / null。
   *
   * 距离按**身体**算（视频盒两侧各有一条透明边，拿盒子算会让触发距离凭空多出半只身位）；
   * 屏取宠物中心所在的那块（多屏各自算各自的左右缘，拖到哪块屏的边就从哪块屏探头）。
   * 纵向不参与判定：贴着左边缘的任意高度都算"拖到左边了"。
   */
  edgeSideNear(x, y, triggerDist) {
    const area = S.resolveRect(AREAS, x + this.halfW, y + this.halfH) || PRIMARY_AREA;
    if (!area || !(area.width > 0)) return null;
    const left = x + this.sideAllow - area.x; // 身体左缘离屏左缘
    const right = area.x + area.width - (x + this.size - this.sideAllow); // 身体右缘离屏右缘
    if (left > triggerDist && right > triggerDist) return null;
    return left <= right ? 'left' : 'right'; // 两侧都够近（窄屏）时取更近的那边
  }

  /**
   * 拖拽松手点落在屏幕左/右边缘附近 → 立刻从那一侧钻出去探头。
   *
   * 与随机链/菜单的区别：这是**用户明确把它拖过去**的，所以
   *   ① 用松手的那一侧，不按 side 配置、不掷概率、不吃冷却；
   *   ② 直接吃掉这次抛掷（stopThrow）——丢在边缘的意图就是"钻到屏幕后面去"，
   *      按轨迹飞走反而不合理；rest 时也不必再排队等待。
   * 返回 true = 已接管本次松手（调用方不要再走"回待机/抛掷"分支）。
   */
  edgeIdleFromDrop(px, py) {
    const e = this.edgeCfg();
    if (!e || !e.dropTrigger || this.edgeSeq) return false;
    const side = this.edgeSideNear(px, py, e.triggerDist);
    if (!side) return false;
    this.stopThrow();
    this.stopDragFollow();
    const started = this.startEdgePeek(e, side);
    if (started) {
      console.log(
        '[dsh-pet] ' +
          new Date().toTimeString().slice(0, 8) +
          ' pet=' +
          this.pet.id +
          ' 边缘待机（拖拽触发）：' +
          (side === 'left' ? '左' : '右') +
          '侧',
      );
    }
    return started;
  }

  // ---- 拖拽抛掷物理（弹簧跟手 + 甩抛 + 重力反弹；与浏览器 pet.ts 同构）----
  stopDragFollow() {
    this.dragFollowToken++;
    if (this.dragFollow !== null) {
      cancelAnimationFrame(this.dragFollow);
      this.dragFollow = null;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  }

  /** rAF 弹簧跟随：窗口朝拖拽目标过阻尼追赶（不再硬贴指针），抹平高频抖动 */
  startDragFollow() {
    if (this.dragFollow !== null) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target) {
        this.dragFollow = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, target.x, dt, this.physics.throwPower);
      vel.vy = S.springStep(vel.vy, y, target.y, dt, this.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y); // 移动的是窗口（this.pos 实时更新）；sprite 在本窗口内不动
      this.dragFollow = requestAnimationFrame(step);
    };
    this.dragFollow = requestAnimationFrame(step);
  }

  /** 停止抛掷（空中被抓/点菜单/回家时立即定格在当前落点）。
   *  同时清速度状态 throwState——否则「抓住后温柔放下」会残留最后一次飞行速度，
   *  静止的宠物点一下就误判为飞行中。点击积分用的飞行动态由 onPointerDown 提前记录。 */
  stopThrow() {
    this.throwToken++;
    if (this.throwRef !== null) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = null;
    }
    this.throwState = null;
  }

  /** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后写入 customPos */
  startThrow(px, py, vx, vy) {
    this.stopDragFollow();
    this.stopMove();
    // 边界 = 显示器工作区**并集**：空洞是墙（宠物再也飞不进不可见区域），屏缝不是墙（跨屏弹跳照旧）
    // confineToScreen 开启时改为锁定**松手这一刻所在的那块屏**：屏缝同样当墙，只在目标屏内弹。
    // 锁定屏在抛掷开始时定下、飞行途中不重取；relayout 改了屏数时由 throwStepRegion 退回不锁定。
    const lockScreen = this.confineToScreen ? S.screenOfBox(this.throwSpaceOf(), px, py) : -1;
    const token = ++this.throwToken;
    let state = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // 落地 Q 弹：只在空中→地面转换帧触发一次
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy; // 本帧积分前的竖直速度（正=下落）：即落地冲击速度
      // 每帧重取：显示器变化时 relayout() 会让缓存失效，res.screen 必须与这一份对应
      const sp = this.throwSpaceOf();
      const res = S.throwStepRegion(state, dt, sp, this.physics, lockScreen);
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.throwState = state;
      // 上报飞行状态（节流 ~30ms）：主进程 broker 汇聚后广播，其它窗口用它做跨窗碰撞检测；
      // broker 协议单位 = 物理像素，这里 ×scale（§3.5 收口）
      if (window.petBridge && window.petBridge.reportFlight && now - this.lastFlightReport > 30) {
        window.petBridge.reportFlight({
          x: toScreen(state.x),
          y: toScreen(state.y),
          vx: toScreen(state.vx),
          vy: toScreen(state.vy),
          size: toScreen(this.size),
          bottomPad: toScreen(this.bottomPad),
        });
        this.lastFlightReport = now;
      }
      // 宠物间碰撞（仅 petCollision 开启）：飞行中的自己撞到其它宠物 → 动量弹开
      if (this.physics && this.physics.petCollision) {
        const myBody = S.bodyPixelBox({ x: state.x, y: state.y, size: this.size, bottomPad: this.bottomPad });
        for (const pid of Object.keys(this.others)) {
          const o = this.others[pid];
          if (!o || !o.size) continue;
          const otherBody = S.bodyPixelBox({ x: o.x, y: o.y, size: o.size, bottomPad: o.bottomPad });
          if (!S.rectsOverlap(myBody, otherBody)) continue;
          const hit = S.collidePet(
            { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: this.size },
            { x: o.x, y: o.y, vx: o.vx, vy: o.vy, size: o.size },
          );
          if (hit) {
            // 飞行方：按动量结果继续弹开；被撞方：主进程转发给目标窗口 → 目标窗 startThrow
            state.vx = hit.fvx;
            state.vy = hit.fvy;
            this.throwState = state;
            if (window.petBridge && window.petBridge.reportCollide) {
              // 被撞方初速同为 broker 物理像素协议：×scale（§3.5 收口）
              window.petBridge.reportCollide(pid, toScreen(hit.hvx), toScreen(hit.hvy));
            }
            break; // 一帧只处理一次碰撞（避免连锁触发抖动）
          }
        }
      }
      this.sendBounds(res.x, res.y);
      // 落地 Q 弹：只在空中→地面转换帧触发一次，力度随冲击速度（轻落 0.8 ~ 重砸 0.55）。
      // 「地面」是**当前所在屏**的底边——多屏各有各的地面高度
      const curBounds = sp.bounds[res.screen] || sp.bounds[0];
      const grounded = curBounds ? res.y >= curBounds.maxY - 1 : false;
      if (res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, S.landingSquash(fallingVy));
      }
      prevGrounded = grounded;
      if (res.atRest) {
        this.throwRef = null;
        this.throwState = null;
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  }

  /** 被撞回调（跨窗碰撞 broker 转发）：停当前动作，从落点以新初速抛出去（全复用现有物理） */
  onDeskHit(vx, vy) {
    this.stopMove();
    this.stopDragFollow();
    this.stopThrow();
    this.startThrow(this.pos.x, this.pos.y, vx, vy);
  }

  /** Q 弹挤压：前台视频垂直压扁（贴地锚定，transform-origin:bottom）再回弹；
   *  与浏览器同构，曲线在 shared（S.squashScale）。depth = 下压幅度（点击固定 0.55；
   *  落地按冲击速度 S.landingSquash 动态取）。reduce-motion 时跳过。 */
  startSquash(el, depth = S.SQ_SQUASH) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const token = ++this.squashToken;
    if (this.squashRef !== null) cancelAnimationFrame(this.squashRef);
    const origin = el.style.transformOrigin;
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / S.SQ_DURATION_MS, 1);
      const scale = S.squashScale(u, depth);
      el.style.transform = (this.facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = null;
        el.style.transformOrigin = origin;
        // 恢复纯镜像（若期间 switchTo 重置过 transform，也以镜像为准）
        el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      }
    };
    this.squashRef = requestAnimationFrame(step);
  }

  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }

  // ---- 点击 vs 拖拽（与浏览器一致：阈值/抓取偏移/释放回循环待机；移动的是窗口） ----
  onPointerDown(e) {
    // 只认左键：右键进入拖拽判定会与右键菜单打架（右键不拖拽，两端一致）
    if (e.button !== 0) return;
    // 抓取速度日志：stopThrow 之前读，否则飞行速度就没了；静止时记录 0（与浏览器同构）
    const grabState = this.throwState;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' grab vx=' +
        (grabState ? Math.round(grabState.vx) : 0) +
        ' vy=' +
        (grabState ? Math.round(grabState.vy) : 0) +
        ' |v|=' +
        (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0),
    );
    // 点击积分：**按下瞬间即触发**（不等松开）。读取 stopThrow 之前的飞行速度，
    // 在飞行中且达标 → 立即粒子爆发 + 积分弹窗；pressScoreFired 标记本次按下已触发，
    // 松开的 click 据此不再重复弹、也不再播普通点击动画（与浏览器同构）。
    this.pressScoreFired = false;
    if (grabState) {
      const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
      if (grabSpeed >= S.SCORE_MIN_SPEED) {
        this.pressScoreFired = true;
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' click-score speed=' +
            Math.round(grabSpeed) +
            ' size=' +
            this.size +
            ' -> +' +
            S.clickScore(grabSpeed, this.size),
        );
        S.spawnScoreBurst(e.clientX, e.clientY);
        S.mountScorePopup({
          x: e.clientX,
          y: e.clientY,
          score: S.clickScore(grabSpeed, this.size),
          speed: grabSpeed,
          size: this.pet.size,
        });
      }
    }
    this.stopThrow(); // 空中抓取：从当前落点开始新拖拽（this.pos 实时）
    this.stopDragFollow();
    // 边缘待机中抓它：先取消整段（不要回原位——宠物就在指针下，回原位会让它从手里跳走），
    // 之后 stopMove() 不会再重复处理（edgeSeq 已清空）。
    if (this.edgeSeq) this.cancelEdgePeek(false);
    this.stopMove();
    this.dragTrail = [];
    this.hit.classList.add('dragging');
    this.stopMove();
    try {
      this.hit.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略捕获失败 */
    }
    // 记录【按下时的指针屏幕坐标】与【按下时的宠物窗口位置】——之后全部用 e.screenX/Y
    // 做增量：指针屏幕坐标与窗口位置无关，不受窗口被逐帧移动影响（window.screenX 会滞后/缓存）。
    // 屏幕坐标是物理像素，除以 CONFIG.scale 进 CSS 系（§3.5）——增量公式两边同一单位。
    this.dragState = {
      active: true,
      dragging: false,
      sx: toLocal(e.screenX),
      sy: toLocal(e.screenY),
      petX: this.pos.x,
      petY: this.pos.y,
    };
    // 拖拽信号（桌面端专有）：主进程的兜底穿透通道按**光标与窗口矩形**判定，而窗口比宠物身体大一圈；
    // 拖拽中宠物滞后于光标，光标可能跑到窗口外→窗口翻回穿透→本窗口收不到 pointermove/pointerup
    // （宠物"飞"出去，见 pointer-target.js）。这里上报"我正在用输入"，主进程据此绝不翻回穿透。
    this.syncInputBusy();
    // 注意：舞台「拍平」（去掉 translateY(bottomPad)）不能在这里做——
    // 纯点击（按下即松开）会让人物瞬移上移再落下。与浏览器一致：只有拖拽超过阈值才拍平。
  }

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    // 阈值判定用屏幕坐标增量（clientX 会随窗口移动而变化，屏幕坐标稳定）；屏幕坐标 ÷scale 进 CSS 系
    const dx = toLocal(e.screenX) - d.sx;
    const dy = toLocal(e.screenY) - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;
      d.dragging = true;
      // 真拖起来了：解除"停在边缘"（站直、允许自行漫游）——用户拖它就是要它出来
      this.unparkEdge();
      // 真正开始拖拽才把舞台拍平（人物随光标拿起；与浏览器 dragging 语义一致）
      this.stage.style.transform = 'none';
      if (this.animations.drag.length) {
        this.playOnce(S.pick(this.animations.drag));
      }
      this.syncInputBusy(); // 拖拽成立：主进程兜底通道闭嘴（见 inputBusy）
    }
    // 记录指针轨迹（screenX/Y 采样：与视口坐标只差常数偏移，速度一致；初速估算用；÷scale 进 CSS 系）
    const now = performance.now();
    this.dragTrail.push({ t: now, x: toLocal(e.screenX), y: toLocal(e.screenY) });
    this.dragTrail = S.trimTrail(this.dragTrail, now);
    // 弹簧目标 = 按下时的宠物位置 + 指针屏幕增量（窗口怎么动都不影响坐标）——不再硬贴指针，
    // 由 rAF 弹簧跟随逐帧追赶（抹平高频抖动，与浏览器同构）
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    this.startDragFollow();
  }

  onPointerUp(e) {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.hit.classList.remove('dragging');
    this.stopDragFollow(); // 弹簧跟随立即停（位置定格在实时 this.pos）
    this.applyStageTransform(); // 放回底垫下移（+ 边缘待机的倾斜；正常这里已经是 0）
    this.syncInputBusy(); // 拖拽结束：交还给常规判定（幂等，非拖拽时多调一次不发 IPC）
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (e && Number.isFinite(e.screenX)) {
        // 原始输入留痕（实机排查用：验证指针屏幕坐标与窗口位移是否一致，如 DPI 缩放问题）
        window.__dshPetDebug.lastDragRaw = {
          petX: d.petX,
          petY: d.petY,
          sxDown: d.sx,
          syDown: d.sy,
          xUp: e.screenX,
          yUp: e.screenY,
        };
      }
      // 释放位置 = 弹簧跟随后的实际包围盒左上角（this.pos 实时；不是指针目标——
      // 跟手滞后时落点跟随宠物实际位置，与浏览器 boxPx 同语义）
      const px = this.pos.x;
      const py = this.pos.y;
      // 拖到屏幕左/右边缘附近松手 → 从那一侧探头（用户意图优先：丢在边缘就别按轨迹飞走）。
      // 放在"回待机/抛掷"之前：它一旦接管，这次松手就不该再有别的动作链插手。
      if (this.edgeIdleFromDrop(px, py)) return;
      // 拖拽松手：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器 handlePointerUp 一致）
      // 修复：旧实现 switchTo(idle,false)（loop=true，ended 永不触发）→ 随机链永远回不来，
      // 永远卡在同一段待机动画；改为 playOnce（once=true）播一遍 → ended → handleEnded → playIdle 随机链
      if (!this.resumeWorkStatusAnim()) {
        if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
      }
      // 初速估算：够快就抛掷（重力+边缘反弹+落地摩擦），否则原地放下
      const vel = S.estimateReleaseVelocity(this.dragTrail, performance.now(), this.physics);
      this.dragTrail = [];
      if (vel) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' release vx=' +
            Math.round(vel.vx) +
            ' vy=' +
            Math.round(vel.vy) +
            ' |v|=' +
            Math.round(Math.hypot(vel.vx, vel.vy)),
        );
        this.startThrow(px, py, vel.vx, vel.vy);
      } else {
        // customPos 语义 = 宠物**中心**比例（position() 用 rx*W - halfW 还原左上角；
        // startThrow 落定也按同一公式存），松手无边界夹取
        this.customPos = { rx: (px + this.halfW) / VIEW.w, ry: (py + this.halfH) / VIEW.h };
        this.position();
        // 释放后的最终窗口位置（position() 换算后，松手无夹取），冒烟断言"释放不位移"用
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
      }
    }
  }

  // ---- 点击穿透（严格对齐浏览器：只有身体命中区可交互，透明像素穿透到下层应用） ----
  /**
   * 本窗口是否**必须保持可交互**（= "我正在用这个窗口的鼠标输入"）。
   *
   * 三个来源：拖拽中 / 右键菜单开着 / 对话弹窗开着——它们都是"窗口内的 DOM 或事件链正在被使用"，
   * 而它们的输入全部来自**窗口级鼠标事件**（pointermove/pointerup/click）：窗口一旦变回穿透，
   * 输入链就断了（拖拽会定格在最后一次采样上，松手也没人报 pointerup → 宠物按旧速度飞出去）。
   *
   * 这个信号是**渲染端专有的知识**：只有它知道"我正在用输入"，主进程无从推断（光看光标位置和窗口
   * 位移分不清"拖拽跟手"和"漫游/抛掷"）。所以由渲染端上报，主进程的兜底通道据此闭嘴。
   */
  inputBusy() {
    return this.dragState.active || this.menuOpen || this.chatOpen;
  }

  /**
   * 上报一次"要不要保持可交互"。**所有**状态变化点都走这里（幂等：值没变不发 IPC）。
   * 与 setInteractive 的分工：setInteractive 表达"光标在不在身体上"（常规判定），
   * 本方法表达"我有没有在用输入"（优先级更高，覆写常规判定）。
   */
  syncInputBusy() {
    const busy = this.inputBusy();
    if (busy === this._inputBusy) return;
    this._inputBusy = busy;
    window.__dshPetDebug.inputBusy = busy;
    if (window.petBridge) window.petBridge.setInputBusy(busy);
  }

  setInteractive(flag) {
    const next = !!flag;
    if (next === this._interactive) return; // 只在状态变化时发 IPC，避免逐帧刷屏
    this._interactive = next;
    window.__dshPetDebug.interactive = next;
    if (window.petBridge) window.petBridge.setInteractive(next);
  }

  onMouseMove(e) {
    // 拖拽中窗口逐帧跟随光标、指针相对窗口坐标会有帧级抖动——强制保持可交互，绝不翻转（翻转会断拖拽）
    if (this.dragState.active) {
      this.setInteractive(true);
      return;
    }
    // 右键菜单/对话弹窗开启：整窗保持可交互（悬停菜单项/点输入框都不触发穿透翻转）；关闭后恢复命中区判定
    if (this.menuOpen || this.chatOpen) {
      this.setInteractive(true);
      return;
    }
    const r = this.hitRect;
    // forwarded 事件坐标以窗口为原点（与页坐标一致）；转换到 sprite 坐标需扣减窗口余量；
    // 异常时退回屏幕坐标 − 窗口屏幕位置推导（hitRect/pos 均为 CSS 系）：屏幕坐标 ÷scale 后
    // 减去窗口屏幕原点（CSS 系）即窗口内坐标
    const wx = Number.isFinite(e.clientX) ? e.clientX : toLocal(e.screenX) - (this.pos.x + VIEW.x - this.margin.l);
    const wy = Number.isFinite(e.clientY) ? e.clientY : toLocal(e.screenY) - (this.pos.y + VIEW.y - this.margin.t);
    const px = wx - this.margin.l;
    const py = wy - this.margin.t;
    this.setInteractive(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  }

  onClick() {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    // 积分判定已在 onPointerDown（按下即触发）完成：
    // 本次按下已触发过积分 → 只收手停住、**不**再播普通点击动画（粒子+弹窗即反馈，与浏览器同构）
    if (this.pressScoreFired) {
      this.pressScoreFired = false;
      this.stopThrow();
      this.stopMove();
      return;
    }
    this.stopThrow(); // 点击飞行中的宠物 = 收手停住（再播点击回应）
    this.stopMove();
    if (!this.animations.clicks.length) return;
    this.pendingSquash = true; // 等新点击动画切到前台后 Q 弹（压新首帧，与浏览器一致）
    this.playOnce(S.pick(this.animations.clicks));
  }

  // ---- 右键菜单（统一自绘组件：树+渲染都来自 shared-core 的同一份 menu 模块） ----
  // 菜单/弹窗可视矩形（窗口局部坐标）= 窗口 ∩ 工作区（#41）：宠物贴屏幕底/右时窗口外扩余量
  // 伸出屏幕，窗口内固定定位的菜单/弹窗会走进被屏幕裁掉的部分。把菜单/弹窗约束到这个矩形内
  // 即可完整显示——**窗口和宠物零移动**，不存在跨进程位移竞态，也就不会瞬移闪帧。
  // 退化（可视区过小/窗口整体出屏，光标也点不到宠物）返回 null → 调用方按窗口视口兜底。
  visibleClampRect() {
    // pos 是视口相对坐标，窗口屏幕位置 = pos + VIEW 原点 − 外扩余量（见 sendBounds）；
    // 比较双方都用屏幕坐标（坐标系不混），返回的夹取矩形仍是窗口局部坐标。
    // 夹取用**宠物所在的那块屏**而不是外接矩形：外接矩形含空洞，按它夹菜单会伸进
    // 不属于任何显示器的区域（看不见）；菜单本来也不该跨屏显示。
    const area = S.resolveRect(AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH);
    if (!area) return null;
    const winX = this.pos.x + VIEW.x - this.margin.l;
    const winY = this.pos.y + VIEW.y - this.margin.t;
    const winW = this.size + this.margin.l + this.margin.r;
    const winH = this.winH + this.margin.t + this.margin.b;
    const ax = area.x + VIEW.x;
    const ay = area.y + VIEW.y;
    const vx0 = Math.max(ax, winX);
    const vy0 = Math.max(ay, winY);
    const vx1 = Math.min(ax + area.width, winX + winW);
    const vy1 = Math.min(ay + area.height, winY + winH);
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    if (w < 40 || h < 40) return null;
    return { x: vx0 - winX, y: vy0 - winY, w, h };
  }

  onContextMenu(e) {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    e.preventDefault();
    this.stopThrow(); // 菜单弹出前停住飞行中的宠物
    this.stopMove(); // 菜单悬停期间宠物不漫游
    // 桌面专属工具根项（打开网站 / 查看余额 / 碎碎念 / 对话 / 回到初始位置 / 重载配置）+ 共享菜单树（动作→分类→具体动画）
    // 碎碎念/对话项无条件显示：手动触发不受 whisperEnabled 限制（该字段只影响自动周期轮询）
    const tools = [{ label: '打开网站', action: 'open-site' }];
    if (this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });
    tools.push(
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat' },
      // 手动来一段「藏到屏幕边缘外再探头张望」（自动随机链也会偶发触发，见 tryEdgeIdle）：
      // 概率/冷却只管自动触发，手动点播永远可用（与「碎碎念」同语义）
      { label: '边缘待机', action: 'edge' },
      { label: '回到初始位置', action: 'home' },
      // 「设置」子菜单：桌宠运行方式相关的开关都收在这里（和"宠物互动"类工具分开）。
      // 标签里的状态来自主进程（登录项的真实值），渲染端只做展示。
      {
        label: '设置',
        children: [
          // 桌面感知：开启后宿主每 1.5s 读一次前台窗口，变化稳定 6s 才让模型说一句 + 挑个动作。
          // 只读"进程名 + 窗口标题"（不截屏），但仍会把这些文本发给模型服务商，默认关闭。
          { label: '桌面感知：' + (this.perceptionOn ? '开' : '关'), action: 'perception' },
          { label: '开机自启动：' + (this.autoStartOn ? '开' : '关'), action: 'autostart' },
          { label: '启动 DSH' + (this.dshPath ? '' : '（未找到）'), action: 'launch-dsh' },
        ],
      },
      // 改配置文件后免去回设置页点保存：请宿主重启桌面 Helper（全部桌面宠物窗口按最新配置重建）。
      // 放在最后：它是"重新加载"这类维护动作，与上面几个宠物互动项语义不同。
      { label: '重载配置', action: 'reload' },
    );
    const tree = tools.concat(S.buildMenuTree(this.animations));
    if (!tree.length) return;
    this.menuOpen = true;
    this.setInteractive(true); // 菜单是窗口内 DOM：悬停期间整窗保持可交互，关闭后恢复命中区穿透
    this.syncInputBusy();
    window.__dshPetDebug.menuOpen = true;
    const m = S.mountContextMenu({
      tree,
      x: e.clientX,
      y: e.clientY,
      // 只允许在「窗口 ∩ 工作区」内显示：宠物贴边时外扩余量伸出屏幕，菜单走进那里会被 OS 裁掉（#41）
      clamp: this.visibleClampRect(),
      onAction: (leaf) => this.onMenuAction(leaf),
      // 菜单被点外/Esc 关闭（非菜单项路径）：同样复位可交互标记，恢复命中区判定
      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
        this.syncInputBusy();
      },
    });
    this.menuClose = m.close;
  }

  onMenuAction(leaf) {
    this.closeMenu();
    if (!leaf || typeof leaf !== 'object') return;
    if (leaf.action === 'open-site') {
      if (window.petBridge) window.petBridge.openDshSite(ORIGIN); // 系统默认浏览器打开（等效 Ctrl+点击链接）
      return;
    }
    if (leaf.action === 'show-balance') {
      this.showBalanceFromMenu(); // 立即拉余额并展示（无需等 1s 触发轮询，展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'whisper') {
      this.showWhisperFromMenu(); // 立即让 host 强制新生成一句并展示（绕过节流；展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'chat') {
      this.showChatFromMenu(); // 打开对话弹窗（记忆经 host /chat 读写，浏览器/桌面同一实例共享）
      return;
    }
    if (leaf.action === 'edge') {
      this.edgeIdleFromMenu(); // 手动立即来一段（不受概率/冷却限制，见 edgeIdleFromMenu）
      return;
    }
    if (leaf.action === 'perception') {
      this.togglePerception();
      return;
    }
    if (leaf.action === 'autostart') {
      this.toggleAutoStart();
      return;
    }
    if (leaf.action === 'launch-dsh') {
      this.launchDsh();
      return;
    }
    if (leaf.action === 'home') {
      this.goHome(); // 停漫游/移动，清会话位置，回配置角落
      return;
    }
    if (leaf.action === 'reload') {
      this.reloadDesktop(); // 请宿主重启桌面 Helper：全部桌面宠物窗口按最新配置重建
      return;
    }
    if (!leaf.anim) return;
    // 文字类（noMirror）朝右站姿是镜像的：点播前强制朝左，避免文字镜像（与浏览器随机链"朝右不选文字"同语义）
    if (S.isNoMirrorAnimation(this.animations.categories, leaf.anim) && this.facing === 'right') {
      this.facing = 'left';
    }
    // 点播移动动画：走真实移动（与随机游走同一套：边界检查 / 随机距离 / leadSec·tailSec / dir），
    // 仅"选哪个动画"由菜单决定；挪不动（false）退化纯播放
    if (this.animations.moves.actions.some((a) => a.name === leaf.anim)) {
      this.unparkEdge(); // 明确点播移动 = 要它走出来
      if (this.tryMove(leaf.anim) === false) this.playOnce(leaf.anim);
      return;
    }
    this.playOnce(leaf.anim);
  }

  closeMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
    }
    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
    this.syncInputBusy(); // 菜单关：若没有别的占用（拖拽/弹窗）则交还常规判定
  }

  // 「查看余额」菜单：POST 动作让 host 刷新余额（写进 S），随即**立刻跑一拍 /state** 拿结果展示
  // （0 延迟，不用等下一个 1s；展示走 showBalanceNow/showBalanceNotice 同一路径）。
  // 注意这里不再直接拉余额：数据只有一个出口（S），菜单只负责"让它刷新"。
  showBalanceFromMenu() {
    if (!this.pet.balanceEnabled) return;
    S.postAction(BALANCE_URL)
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] 菜单查看余额：刷新动作未成功');
        pollStateNow(); // 立即拉一拍：结果 0 延迟可见（失败也会由 /state 里的 ok:false 弹文字说明）
      })
      .catch((e) => {
        console.error('[dsh-pet] 菜单查看余额异常', e);
      });
  }

  // 「碎碎念」菜单：POST 动作让 host 立即新生成一句（写进 S），随即立刻跑一拍 /state 拿文本展示
  // （0 延迟，不用等下一个 1s）。动作不回文本——文本只有一个出口（S）。
  // 手动触发不受 whisperEnabled 限制——该字段只关自动周期，手动永远可用。
  showWhisperFromMenu() {
    S.postAction(WHISPER_URL + '?pet=' + encodeURIComponent(this.pet.id))
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] 菜单碎碎念：生成动作未成功 pet=' + this.pet.id);
        pollStateNow(); // 立即拉一拍：文本随这一拍到达并展示
      })
      .catch((e) => {
        console.warn('[dsh-pet] 菜单碎碎念异常', e);
      });
  }

  // 「对话」菜单：最简输入框（shared 组件，与浏览器同一份）——回车发送后弹窗消失，
  // 回复用**碎碎念同款显示**（说话动画 + 白色气泡 10s），只多一步用户输入。
  // 记忆经 host /chat 读写（memory.json，同一实例的浏览器/桌面共享同一份）。
  // 弹窗跟随宠物：基准是**身体命中区** this.hit（与气泡同一定位源——桌宠在视频中间，
  // 视频框右上角 ≠ 宠物右上角），取身体右上角，超出视口自动夹回（窗口右侧外扩区容纳）；
  // 弹窗是窗口内 DOM，期间整窗保持可交互（可点输入框），关闭后恢复命中区穿透。
  showChatFromMenu() {
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
      return; // 已开着：先关旧的
    }
    const m = S.mountChatDialog({
      petId: this.pet.id,
      baseUrl: BASE + '/chat',
      x: Math.max(4, this.hit.getBoundingClientRect().right + 6),
      y: Math.max(4, this.hit.getBoundingClientRect().top + 6),
      // 弹窗同菜单：只允许在「窗口 ∩ 工作区」内显示，贴边时不被屏幕裁掉（#41）
      clamp: this.visibleClampRect(),
      onSent: () => {
        // 发送成功：回复已写进 S，立刻跑一拍 /state 让气泡 0 延迟出现（不必等下一个 1s）
        console.info('[dsh-pet] 对话已发送 pet=' + this.pet.id);
        pollStateNow();
      },
      onClose: () => {
        this.chatClose = null;
        this.chatOpen = false;
        window.__dshPetDebug.chatOpen = false;
        this.syncInputBusy(); // 弹窗关：交还常规判定（菜单还开着的话仍保持忙，见 inputBusy）
        if (!this.menuOpen) this.setInteractive(false); // 弹窗关了且无菜单：恢复命中区穿透
      },
    });
    this.chatClose = m.close;
    this.chatOpen = true; // 穿透守卫：弹窗期间整窗保持可交互，光标移到输入框不被翻回穿透
    window.__dshPetDebug.chatOpen = true;
    this.syncInputBusy();
    this.setInteractive(true);
  }

  /**
   * 菜单「设置 → 桌面感知」：开/关**她能看你在用什么软件**。
   *
   * 开关落在宿主（lib/index.js 的 /perception 路由）：开启后宿主每 1.5s 读一次前台窗口
   * （进程名 + 窗口标题，**不截屏**），画面稳定 6s 才让模型判断一次"你在干嘛"，
   * 回一句 20 字以内的话 + 从动作清单挑一个播；两次之间至少隔 60s、每小时最多 20 次。
   * 关掉即停子进程，不留后台轮询。
   */
  togglePerception() {
    const next = !this.perceptionOn;
    fetch(BASE + '/perception', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!s || s.ok !== true) {
          this.flashNote('桌面感知设置失败：' + ((s && s.error) || '宿主无响应'));
          return;
        }
        this.perceptionOn = s.enabled === true;
        this.flashNote(this.perceptionOn ? '桌面感知：已开启，我看看你在干嘛～' : '桌面感知：已关闭');
        console.log('[dsh-pet] 桌面感知=' + this.perceptionOn);
      })
      .catch((e) => this.flashNote('桌面感知设置失败：' + (e && e.message ? e.message : e)));
  }

  /** 读一次桌面感知状态（宿主侧落盘，渲染端只缓存展示） */
  refreshPerception() {
    if (typeof fetch !== 'function') return;
    fetch(BASE + '/perception', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s) this.perceptionOn = s.enabled === true;
      })
      .catch(() => {});
  }

  /**
   * 菜单「设置 → 开机自启动」：开/关 Windows 登录项（目标 = 插件自带的**独立模式**：
   * 不用打开 DSH 也能跑桌宠）。写盘与查状态都在主进程，这里只把**真实结果**读回来显示——
   * 不做"点了就假定成功"的乐观显示，失败要看得见（气泡里给原因）。
   */
  toggleAutoStart() {
    const bridge = window.petBridge;
    if (!bridge || !bridge.autoStartSet) {
      this.flashNote('当前环境不支持开机自启动');
      return;
    }
    bridge
      .autoStartSet(!this.autoStartOn)
      .then((res) => {
        this.autoStartOn = !!(res && res.on);
        if (res && res.error) this.flashNote('开机自启动失败：' + res.error);
        else this.flashNote('开机自启动：' + (this.autoStartOn ? '已开启' : '已关闭'));
        console.log(
          '[dsh-pet] 开机自启动=' + this.autoStartOn + (res && res.error ? ' err=' + res.error : ''),
        );
      })
      .catch((e) => this.flashNote('设置失败：' + (e && e.message ? e.message : e)));
  }

  /** 菜单「设置 → 启动 DSH」：把 DSH 主程序拉起来（它已在运行时由自身单实例激活） */
  launchDsh() {
    const bridge = window.petBridge;
    if (!bridge || !bridge.launchDsh) return;
    bridge
      .launchDsh()
      .then((res) => {
        if (res && res.ok) this.flashNote('正在启动 DSH…');
        else this.flashNote('启动失败：' + ((res && res.error) || '未知原因'));
      })
      .catch((e) => this.flashNote('启动失败：' + (e && e.message ? e.message : e)));
  }

  /** 给用户看的一句即时反馈（复用说话气泡那一套，几秒后自动收起） */
  flashNote(text) {
    this.whisperOn = true;
    this.whisperView = S.whisperBubbleView({ ok: true, text, ts: 0 });
    this.whisperImage = '';
    this.renderBubble();
    if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
    this.whisperTimer = window.setTimeout(() => {
      this.whisperOn = false;
      this.renderBubble();
    }, 4000);
  }

  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
  goHome() {    this.stopThrow();
    this.stopMove();
    this.unparkEdge(); // 「回到初始位置」= 明确要它出来：解除停在边缘并站直
    this.customPos = null;
    this.position();
  }

  // 「重载配置」菜单：请宿主重启桌面 Helper —— 与设置页「保存」**同一条**重启路径
  // （宿主 POST /reload → syncDesktop：串行队列 + 等旧进程真正退出再起新的）。
  // 为什么不在渲染端就地重拉配置：① 每只宠物一个窗口是宿主按 DSH_PET_PETS 建的，
  // 就地重拉改不了宠物数量/display/size；② 本页的余额/工作状态等全局轮询是一次性启动的
  // （events.js 的 loopsStarted 门控），就地重建 sprite 会漏启新循环或留下旧定时器。
  // 本请求由**即将被重启的这个进程**发出：响应可能永远不回（宿主杀进程时回调地址已失效），
  // 故不 await、不重试，失败只记日志——重载本身就是把本进程换掉。
  reloadDesktop() {
    fetch(BASE + '/reload', { method: 'POST' }).catch((e) => {
      console.warn('[dsh-pet] 重载配置请求失败（宿主不可达？）', e);
    });
  }

  renderBubble() {
    // 气泡单槽：同一时刻只显示一个（优先级：终态任务 > 碎碎念/对话 > 余额 > 非终态任务）。
    // 为什么终态任务不让位：完成/失败气泡只活 10s，被事件顶掉就彻底看不到了；非终态任务气泡
    // 常驻（不设自动收起），让位 10s 零损失。与浏览器 src/client/pet.ts 的单槽优先级同一套。
    // 工作气泡与碎碎念同款弹窗样式：宽度自适应 + 自动换行（is-whisper：正常 white-space、宽随内容）
    // 配图标记交给 CSS：带图时取消 min-width（样式在 shared 的 MEME_BUBBLE_CSS，两端同一份）。
    // 图片 URL 与视频同规则：传 BASE 前缀（桌面是 file:// 页面，必须绝对地址）
    // 素材根同理（配图的归属与动画一致：pet/<素材根>-memes/ 独占 → 用户目录 → 包内）
    const workOn = !!(this.workOn && this.workText);
    const whisperOn = !!(this.whisperOn && this.whisperView);
    const balanceOn = !!(this.bubbleOn && this.balanceView);
    const workTerminal = this.workState === 'success' || this.workState === 'error';
    const slot =
      workTerminal && workOn ? 'work' : whisperOn ? 'whisper' : balanceOn ? 'balance' : workOn ? 'work' : 'none';
    const whisperImg = slot === 'whisper' ? S.createMemeImage(this.whisperImage, BASE, this.assetRoot) : null;
    this.bubble.classList.toggle(
      'is-whisper',
      // 余额「文字说明」（不可用状态）同样要换行变体：默认 nowrap 会把长文案顶出宠物宽度
      slot === 'whisper' || slot === 'work' || (slot === 'balance' && this.balanceWrap),
    );
    this.bubble.classList.toggle(S.MEME_BUBBLE_CLASS, !!whisperImg);
    if (slot === 'none') {
      // 三者都没有可显示的内容：隐藏（不占位，也就不会挡住任何一层）
      this.bubble.classList.remove('is-on');
      window.__dshPetDebug.lastBubbleTitle = '';
      return;
    }
    this.bubble.innerHTML = '';
    if (slot === 'work') {
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.workText;
      this.bubble.appendChild(line);
    } else if (slot === 'whisper') {
      // 配图（shared 生成的 <img> + 共用样式）：先看图再读话，符合"配图"的阅读顺序
      if (whisperImg) this.bubble.appendChild(whisperImg);
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.whisperView[0]?.text ?? '';
      this.bubble.appendChild(line);
    } else {
      const rows = this.balanceView;
      const hasTier = rows.some((r) => r.role === 'tier');
      if (hasTier) {
        // deepseek 余额单行：余额（峰/谷）¥x — 档位字着色
        const line = document.createElement('div');
        line.className = 'pet-bub-row';
        for (const r of rows) {
          const span = document.createElement('span');
          if (r.role === 'tier') span.className = 'pet-bub-tier pet-bub-tier-' + r.tier;
          span.textContent = r.text;
          line.appendChild(span);
        }
        this.bubble.appendChild(line);
      } else {
        for (const r of rows) {
          const div = document.createElement('div');
          if (r.role === 'error') div.className = 'pet-bub-err';
          else if (r.role === 'sub') div.className = 'pet-bub-row pet-bub-sub';
          else div.className = 'pet-bub-row';
          div.textContent = r.text;
          this.bubble.appendChild(div);
        }
      }
    }
    this.bubble.classList.add('is-on');
    window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
  }
}
