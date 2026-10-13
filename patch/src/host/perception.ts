/**
 * 桌面感知（**文本层**）：读取"用户此刻在前台用的是什么软件、什么窗口标题"，变化并稳定下来后
 * 交给模型判断"他在干嘛"，让她说一句 + 挑一个动作播。
 *
 * ⚠️ 本文件是 lib/index.js 里 `//#region src/host/perception.ts` 那一段的**源码镜像**：
 * 插件当前是"改产物直接生效"的状态（宿主半边是构建产物），源码仅作设计与实现的留档；
 * 从源码重建（npm run build）会用本文件重新生成等价实现。改动请两边同步。
 *
 * 为什么只做文本层：看懂画面需要视觉模型，当前 DSH 配的 deepseek 模型收不收图尚未验证；
 * 而"进程名 + 窗口标题"已经够她知道你在写代码/看网页/打游戏，且**不截屏、不外传画面**。
 *
 * 设计要点：
 *   · 感知源 = 一个常驻 PowerShell 子进程（Add-Type 只编译一次），前台窗口变化时打一行
 *     `进程名<TAB>标题`；宿主按行读。比"每次轮询拉一个新进程"省得多（每次 Add-Type 约 0.4s）；
 *   · 去抖：切换窗口很频繁，必须"稳定 N 秒"才算一次场景，避免 alt-tab 抖动触发模型调用；
 *   · 限流：最小间隔 + 每小时上限（token 是用户的钱，宁可少说几句）；
 *   · 输出契约：模型只回一个 JSON {"say","anim"}；动作名必须能在该宠物的动画池里找到才采用，
 *     否则只说话不动（播放端"名字即文件名"，写不存在的动作名只会静默失败）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 动作清单：name 必须是真实存在的素材名；when 给模型判断用（会进提示词，尽量短） */
export const PERCEPTION_ACTIONS: Array<{ name: string; when: string }> = [
  { name: '写代码', when: '用户在写代码、看代码、翻仓库' },
  { name: '工作状态-思考冒泡', when: '用户在思考、等回复、卡着想事情' },
  { name: '工作状态-忙碌点按', when: '用户在处理任务、跑工具、批量干活' },
  { name: '工作状态-清点归档', when: '用户在整理文件、归档、翻资料' },
  { name: '工作状态-原地踱步张望', when: '用户在等待、进度条挂着' },
  { name: '工作状态-雀跃庆祝', when: '用户完成了什么、成功提示' },
  { name: '工作状态-垂头叹气冒汗', when: '用户遇到报错、失败、红字' },
  { name: '玩游戏气急败坏', when: '用户在打游戏、看着像卡关' },
  { name: '摇扇纳凉', when: '用户在看视频、追剧、休闲娱乐' },
  { name: '悠闲哼歌', when: '用户在听歌、放松、闲逛' },
  { name: '照镜子', when: '用户在开会、视频通话、镜头相关' },
  { name: '哈欠连天', when: '疑似深夜很晚、用户看着累了' },
  { name: '打瞌睡被惊醒', when: '长时间没动静、像睡着了' },
  { name: '超大伸懒腰', when: '长时间不动之后用户回来了' },
  { name: '吃Token', when: '用户在跟 AI 对话、烧 token' },
  { name: '大口吃零食', when: '用户在看吃的、外卖、美食' },
  { name: '偷吃零食被抓住', when: '用户在摸鱼、偷偷逛' },
  { name: '原地小憩沉眠', when: '真的很安静、没什么事' },
  { name: '深度思考碎碎念', when: '用户在啃难题、看论文' },
  { name: '鲸鱼吐泡泡特效', when: '用户在随便逛网页' },
];

/** 常驻 PowerShell 感知脚本：编译一次，之后每 1.5s 比一次前台窗口，变了才输出一行 */
const PERCEPTION_PS = [
  "$ErrorActionPreference='SilentlyContinue'",
  "Add-Type -Namespace DshPet -Name Fg -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);'",
  "$last=''",
  'while($true){',
  '  $h=[DshPet.Fg]::GetForegroundWindow()',
  '  $sb=New-Object System.Text.StringBuilder 512',
  '  [void][DshPet.Fg]::GetWindowText($h,$sb,512)',
  '  $procId=0',
  '  [void][DshPet.Fg]::GetWindowThreadProcessId($h,[ref]$procId)',
  '  $p=(Get-Process -Id $procId).ProcessName',
  '  $line="$p`t$($sb.ToString())"',
  '  if($line -ne $last){$last=$line;[Console]::Out.WriteLine($line);[Console]::Out.Flush()}',
  '  Start-Sleep -Milliseconds 1500',
  '}',
].join('\r\n');

/** -EncodedCommand 要 UTF-16LE 的 base64（省掉落一个 .ps1 文件） */
export function perceptionEncodedCommand(): string {
  return Buffer.from(PERCEPTION_PS, 'utf16le').toString('base64');
}

/** 感知子进程命令（Windows 才有前台窗口概念；其它平台返回 null → 该功能自动不可用） */
export function perceptionSpawnSpec(): { command: string; args: string[] } | null {
  if (process.platform !== 'win32') return null;
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', perceptionEncodedCommand()],
  };
}

/**
 * 这些进程的前台窗口不该触发反应：宠物自己、以及不属于"用户在干什么"的系统壳层。
 * 注意**不要**把终端类（powershell / WindowsTerminal / cmd）写进来——用户对着终端干活时她该看得见；
 * 感知脚本本身是隐藏窗口（windowsHide + 无窗口），不会成为前台窗口。
 */
const PERCEPTION_IGNORE = [
  'dsh-pet-electron-helper',
  'dsh-pet-electron-helper-boot',
  'electron',
  'ApplicationFrameHost',
  'TextInputHost',
];

export function perceptionIgnored(processName: unknown): boolean {
  const p = String(processName ?? '').toLowerCase();
  return PERCEPTION_IGNORE.some((n) => n.toLowerCase() === p);
}

/** 解析感知子进程的一行输出（`进程名<TAB>标题`）；非法行返回 null */
export function parsePerceptionLine(line: string): { process: string; title: string } | null {
  const text = String(line || '').replace(/\r$/, '');
  if (!text) return null;
  const i = text.indexOf('\t');
  const processName = (i >= 0 ? text.slice(0, i) : text).trim();
  const title = (i >= 0 ? text.slice(i + 1) : '').trim();
  if (!processName) return null;
  return { process: processName, title: title.slice(0, 120) };
}

/** 组装交给模型的用户指令（场景 → 一句话 + 一个动作） */
export function perceptionPrompt(scene: { process: string; title: string }): string {
  const list = PERCEPTION_ACTIONS.map((a) => '- ' + a.name + '：' + a.when).join('\n');
  return (
    '你趴在用户桌面上，能看到用户此刻在前台开的窗口。\n' +
    '当前前台：软件「' + scene.process + '」，窗口标题「' + scene.title + '」。\n' +
    '别复述标题，用一句话（20 字以内）说点符合情境的话，再从动作清单里挑一个最贴切的。\n' +
    '动作清单：\n' + list + '\n' +
    '只输出 JSON，不要解释、不要代码块：{"say":"…","anim":"动作名"}；拿不准 anim 就填空字符串。'
  );
}

/**
 * 解析模型回复：优先取 JSON 里的 say/anim；解析不出来就把整段当台词（宁可说一句，也别什么都不显示）。
 * 台词长度截断到 60 字，防模型长篇大论把气泡撑爆。
 */
export function parsePerceptionReply(text: string): { say: string; anim: string } {
  const raw = String(text || '').trim();
  const fenced = raw.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  const m = fenced.match(/\{[\s\S]*\}/);
  let obj: { say?: unknown; anim?: unknown } | null = null;
  if (m) {
    try {
      obj = JSON.parse(m[0]);
    } catch {
      obj = null;
    }
  }
  const say = obj && typeof obj.say === 'string' ? obj.say.trim() : '';
  const anim = obj && typeof obj.anim === 'string' ? obj.anim.trim() : '';
  if (say) return { say: say.slice(0, 60), anim };
  const plain = fenced.replace(/[\r\n]+/g, ' ').trim();
  return { say: plain.slice(0, 60), anim: '' };
}

/** 感知开关的落盘位置（放在用户数据根，与 main-config.jsonc 同级；不碰用户配置本身） */
export function perceptionFilePath(paths: { userFile: string }): string {
  return join(dirname(paths.userFile), 'perception.json');
}

/** 读感知状态（缺失/损坏 = 关） */
export function readPerceptionState(paths: { userFile: string }): { enabled: boolean } {
  try {
    const raw = JSON.parse(readFileSync(perceptionFilePath(paths), 'utf8')) as { enabled?: unknown };
    return { enabled: raw?.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export function writePerceptionState(paths: { userFile: string }, enabled: boolean): void {
  try {
    writeFileSync(perceptionFilePath(paths), JSON.stringify({ enabled: !!enabled }, null, 2));
  } catch (e) {
    console.warn('dsh-pet: 写感知开关失败 ' + String((e as Error)?.message ?? e));
  }
}

/** 单次感知生成超时（比碎碎念略短：这是"随口一句反应"，冷启动慢就放弃） */
export const PERCEPTION_TIMEOUT_MS = 25_000;
/** 场景去抖：同一画面稳定这么久才反应（防 alt-tab 抖动） */
export const PERCEPTION_SETTLE_MS = 6_000;
/** 两次反应的最小间隔 / 每小时上限（token 是用户的钱） */
export const PERCEPTION_MIN_GAP_MS = 60_000;
export const PERCEPTION_MAX_PER_HOUR = 20;

// 注：generatePerception / perceptionWith（模型调用）与 apply() 里的看门狗、/perception 路由
// 都直接写在 lib/index.js 的同一 region 与 apply 内，逻辑与本文件一一对应，此处不重复声明。
