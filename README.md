# 🛠️ OpenClaw Plugin: Tool Trace

Automatically append tool call statistics to the end of each reply.
Supports **Telegram / Webchat / Slack** text channels and **Feishu (Lark)** card/post channels via the official `reply_payload_sending` hook — no patching required.

---

## ✨ Example Output

**Telegram / Webchat:**
```
...reply content...

调用工具：web_search(3)，academic_search(2)
```

**Feishu (card / post):**
```
...reply content...

调用工具：web_search(3)，academic_search(2)
```

---

## 📦 Installation

### 1. Clone to local

```bash
git clone https://github.com/ffexis/openclaw-plugin-tool-trace.git
# Or symlink to OpenClaw's plugins path
ln -s /path/to/openclaw-plugin-tool-trace /path/to/openclaw/plugins/tool-trace
```

### 2. Enable the plugin

Configure in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "tool-trace": { "enabled": true }
    },
    "load": {
      "paths": ["/path/to/openclaw-plugin-tool-trace"]
    }
  }
}
```

### 3. Restart Gateway

```bash
# Find gateway PID and restart
kill -9 $(pgrep -f openclaw-gateway)
```

### 4. Verify

Send a tool-triggering message from TG / Webchat. The reply should end with `调用工具：xxx(y)`.

---

## 🦜 Feishu (Lark) Support

Feishu uses the same official `reply_payload_sending` hook as the text channels — **no patching required**.

### How it works (v3)

```
after_tool_call → runToolCounts Map
                      ↓
        reply_payload_sending (final payload only)
                      ↓
        payload.text += "\n\n调用工具：xxx(n)"
                      ↓
   Feishu card / post (rendered from payload.text)
```

The hook is emitted by the core reply pipeline after payload normalization and before channel delivery, so the appended line lands in the final card or post.

### Trade-off: preview streaming

The Feishu plugin disables **preview streaming** (token-by-token CardKit updates) whenever any `reply_payload_sending` or `message_sending` hook is registered:

```js
const previewStreamingEnabled = streamingEnabled && !modifyingHooksRegistered;
```

With this plugin enabled, Feishu replies arrive as a final card/post instead of a live-streaming card. Block streaming may still apply depending on your `channels.feishu.streaming` config.

If you need both live streaming and tool stats, the only options are patching/forking the Feishu plugin or sending a separate follow-up message — the official hook runs before delivery and cannot modify an in-flight streaming card.

### Verify

Send a tool-triggering message from Feishu; the final card/post should end with `调用工具：xxx(y)`.

> Legacy v2 (`patch-feishu.mjs` + `globalThis.__FEISHU_TOOL_STATS`) was removed in v3. Reinstall/upgrade the Feishu plugin to clear any old injected code.

---

## 🏗️ Architecture

### Text Channels (TG / Webchat / Slack)

```
after_tool_call → runToolCounts Map → reply_payload_sending hook → inject at text end
```

### Feishu

```
after_tool_call → runToolCounts Map → reply_payload_sending (kind=final) → payload.text
```

- Counts are keyed by `runId` / `sessionKey` and deleted after consumption, so no `before_dispatch` cleanup is needed.
- Only the `final` payload is modified; `block` payloads are skipped to avoid stats appearing mid-stream.

---

## ⚙️ Customizing Exec Script Name Detection

The plugin detects `script.js`, `task.js`, and similar patterns by default.
To add custom scripts, modify the `EXEC_SCRIPT_PATTERNS` array in `index.mjs`:

```javascript
const EXEC_SCRIPT_PATTERNS = [
  { re: /my-script\.js/, name: "my-script.js" },
];
```

---

## 🤖 Special Thanks (AI Workforce)

While the project repository is single-authored, the grueling warfare against Feishu's nested JSON serialization and custom dispatcher isolation was fought alongside two tireless digital collaborators:

| DeepSeek-V4-Flash | Gemini Pro (LLM) |
| :--- | :--- |
| **The Resident Bootstrapper** <br>• Excavated the native `plugin-sdk`<br>• Monitored standard hook pipelines<br>• Executed localized code patching | **The Remote Think-Tank** <br>• Decoded Feishu's internal AST routing<br>• Formulated the pull-based injection strategy<br>• Blind-solved the fallback interactive card bug |

*Shoutout to the AI workforce for running the repetitive AST extractions and pipeline tracking so the Author didn't have to melt their own bank account on full-scale raw API tokens.*

---

## ⚠️ Test Status

**v3 uses the official hook path.** Tested on OpenClaw 2026.9.3 + @openclaw/feishu 2026.9.3 (Windows/Linux). The main behavioral change is that Feishu preview streaming is disabled while any modifying reply hook is registered — verify this trade-off in your environment before relying on it.

---

## 📄 License

MIT

---

# 🛠️ OpenClaw 插件：Tool Trace

在每个回复末尾自动附上本轮调用的工具统计。
支持 **Telegram / Webchat / Slack** 等文本通道，以及 **飞书（Feishu / Lark）** 卡片/富文本通道。

---

## ✨ 效果

**Telegram / Webchat:**
```
...回复内容...

调用工具：web_search(3)，academic_search(2)
```

**飞书（卡片 / 富文本）:**
```
...回复内容...

调用工具：web_search(3)，academic_search(2)
```

---

## 📦 安装

### 1. 克隆到本地

```bash
git clone https://github.com/ffexis/openclaw-plugin-tool-trace.git
# 或者放在 OpenClaw 的 plugins 路径下
ln -s /path/to/openclaw-plugin-tool-trace /path/to/openclaw/plugins/tool-trace
```

### 2. 启用插件

在 `openclaw.json` 中配置：

```json
{
  "plugins": {
    "entries": {
      "tool-trace": { "enabled": true }
    },
    "load": {
      "paths": ["/path/to/openclaw-plugin-tool-trace"]
    }
  }
}
```

### 3. 重启 Gateway

```bash
# 找到 gateway PID 并重启
kill -9 $(pgrep -f openclaw-gateway)
```

### 4. 验证

从 TG / Webchat 发一条会调用工具的对话，回复末尾应出现 `调用工具：xxx(y)`。

---

## 🦜 飞书（Feishu / Lark）支持

飞书与文本通道共用官方 `reply_payload_sending` hook，**无需 patch**。

### 原理（v3）

```
after_tool_call → runToolCounts Map
                      ↓
        reply_payload_sending（只处理 final）
                      ↓
        payload.text += "\n\n调用工具：xxx(n)"
                      ↓
   飞书卡片 / 富文本（由 payload.text 渲染）
```

hook 由核心回复管线在 payload 规范化之后、channel 投递之前触发，因此追加的统计会进入最终卡片或富文本。

### 代价：预览流式

只要注册了任意 `reply_payload_sending` / `message_sending` hook，飞书插件就会关闭**预览流式**（逐字刷新 CardKit 卡片）：

```js
const previewStreamingEnabled = streamingEnabled && !modifyingHooksRegistered;
```

启用本插件后，飞书回复会以最终卡片/富文本送达，而不是逐字流式卡片。block streaming 是否保留取决于 `channels.feishu.streaming` 配置。

若既要逐字流式又要统计，只能 patch/fork 飞书插件，或另发一条统计消息——官方 hook 在投递前运行，改不了正在流式更新的卡片。

### 验证

从飞书发一条会调用工具的对话，最终卡片/富文本末尾应出现 `调用工具：xxx(y)`。

> v2 的 `patch-feishu.mjs` + `globalThis.__FEISHU_TOOL_STATS` 已在 v3 移除。建议重装/升级飞书插件，清掉可能残留的注入代码。

---

## 🏗️ 架构

### 文本通道（TG / Webchat / Slack 等）

```
after_tool_call → runToolCounts Map → reply_payload_sending hook → 注入 text 末尾
```

### 飞书

```
after_tool_call → runToolCounts Map → reply_payload_sending（kind=final）→ payload.text
```

- 统计按 `runId` / `sessionKey` 归档，消费后立即删除，不再需要 `before_dispatch` 清理。
- 只改写 `final` payload；`block` 跳过，避免统计出现在流式中间块。

---

## ⚙️ 自定义 exec 脚本名识别

插件默认识别 `script.js`、`task.js` 等常见模式。
如需添加自定义脚本，修改 `index.mjs` 中的 `EXEC_SCRIPT_PATTERNS` 数组：

```javascript
const EXEC_SCRIPT_PATTERNS = [
  { re: /my-script\.js/, name: "my-script.js" },
];
```

---

## 🤖 特别致谢（AI 工作组）

虽然项目仓库是单人创作，但对抗飞书嵌套 JSON 序列化和自定义调度器隔离的艰苦战争，是由两位不知疲倦的数字合作者并肩作战：

| DeepSeek-V4-Flash | Gemini Pro (LLM) |
| :--- | :--- |
| **驻场启动器** <br>• 挖掘原生 `plugin-sdk`<br>• 监控标准钩子管道<br>• 执行本地化代码修补 | **远程智囊团** <br>• 解码飞书内部 AST 路由<br>• 制定拉取式注入策略<br>• 盲解回退交互卡片 bug |

*感谢 AI 工作组执行重复的 AST 提取和管道追踪，让作者不用烧掉自己的账户来支付全量原始 API token。*

---

## ⚠️ 测试状态

**此代码尚未经过完整测试。** v2 架构（从 `sendCardFeishu` 迁移到 `monitor.account`）是一次重大重构，覆盖了 CardKit 流式、静态卡片和富文本消息。虽然设计经过了讨论和审查，但实际运行时行为可能与预期有差异。请在生产环境依赖此代码前充分测试。

---

## 📄 License

MIT
