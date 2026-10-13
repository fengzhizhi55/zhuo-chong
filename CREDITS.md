# 署名与来源

## 上游

| 项目 | 说明 |
|---|---|
| [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | 桌宠插件本体（MIT）。补丁的目标版本 **0.3.6** |
| [npm: dsh-pet](https://www.npmjs.com/package/dsh-pet) | 插件发布渠道（`dsh plugin --profile desktop add dsh-pet`） |
| [DeepSeek Harness](https://github.com/deepseek-ai) | 宿主应用 |

上游的素材链（`scripts/watermark_step01.py` / `chroma_step02.py` / `normalize_step03.py`）是我们这套管线的**设计参考**：
HSV 色相抠像、按站立高度归一化、VP9-alpha 输出这些思路都来自它。我们的 `pipeline/` 是针对
**单段 AI 生成视频（会移动的水印、人物大小不一致、没有 mask 素材）** 重写的版本。

## 本仓库原创

| 内容 | 位置 |
|---|---|
| 桌面感知（前台窗口 → 模型 → 说话 + 动作） | `patch/lib/index.js`、`patch/src/host/perception.ts` |
| 设置页支持文件宠物 + 按种类保存路由 | `patch/lib/client.js`、`patch/lib/index.js` |
| 边缘探头待机动画 + 右键设置菜单（自启 / 启动 DSH） | `patch/runtime/electron-helper/*` |
| 绿幕视频 → 透明 webm 素材管线 | `pipeline/scripts/*.py` |
| 粉毛小女仆宠物包（配置 + 9 段动画） | `pet-pack/pinkmaid/` |

## 素材来源

粉毛小女仆的动画由 **AI 视频生成**（即梦 / 豆包，绿幕素材）经本仓库的管线转为透明 webm。
这部分内容的版权归生成者；本仓库只做格式转换与抠像。

## 如果你想给上游提 PR

上游仓库的源码树在 `src/`（TypeScript），而本仓库的补丁改的是构建产物 `lib/*.js`
（因为运行时装的就是它）。要提 PR 需要把改动**回写到 `src/` 并重新构建**——
`patch/src/host/perception.ts` 是其中唯一已经写好源码镜像的部分，其余改动
（`sprite.js` / `main.js` 是手写的运行时 JS，`client.js` 的设置页）需要按上游的
组件结构重新落到 `src/` 里。
