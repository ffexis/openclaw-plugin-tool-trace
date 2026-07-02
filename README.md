# 🛠️ OpenClaw Plugin: Tool Trace

Automatically append tool call statistics to the end of each reply.
Supports **Telegram / Webchat / Slack** text channels and **Feishu (Lark)** card channels.

---

## ✨ Example Output

**Telegram / Webchat:**
```
...reply content...

Tools used: web_search(3), academic_search(2)
```

**Feishu Card:**
```
...reply content...

Tools used: amap-mcp__maps_weather(1)
Agent: main | Model: deepseek-v4-flash | Provider: volcengine coding plan
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

Send a tool-triggering message from TG / Webchat. The reply should end with `Tools used: xxx(y)`.

---

## 🦜 Feishu (Lark) Support

Feishu plugin uses a separate bundle for card message sending, requiring an extra step.

### How it works

```mermaid
flowchart LR
  Plugin["Plugin after_tool_call"] -->|"Write globalThis.__FEISHU_TOOL_STATS"| Map[Map<targetId, counts>]
  Map -->|"Consume"| Patch["sendCardFeishu (patched)"]
  Patch -->|"Append to card.body.elements[].content"| Card["Feishu Card"]
```

### Run Patch

```bash
cd /path/to/openclaw-plugin-tool-trace
node patch-feishu.mjs
```

The script auto-locates the Feishu plugin's dist directory and injects interception code into the `sendCardFeishu` function.
Idempotent — safe to run multiple times.

**If auto-location fails, specify manually:**

```bash
# Find Feishu plugin location
find / -path "*/@openclaw/feishu/dist" -type d 2>/dev/null
# Then patch manually
node -e "
const fs = require('fs');
const path = '/path/to/@openclaw/feishu/dist/send-*.js';
// ... manual modification
"
```

### Restart Gateway

After patching, restart Gateway:

```bash
kill -9 $(pgrep -f openclaw-gateway)
```

### Verify

Send a tool-triggering message from Feishu. The reply should end with `Tools used: xxx(y)`.

---

## 🏗️ Architecture

### Text Channels (TG / Webchat / Slack)

```
after_tool_call → runToolCounts Map → reply_payload_sending hook → inject at text end
```

### Feishu Card Channel

```
after_tool_call → globalThis.__FEISHU_TOOL_STATS[targetId]
                        ↓
sendCardFeishu (patched) → read statsMap (first entry)
                        ↓
                append to card.body.elements[0].content
                        ↓
                call original sendCardFeishu to send
```

### Cross-turn Contamination Prevention

`before_dispatch` hook auto-clears previous turn's residual stats on Feishu inbound.

### Key Fix: ID Mismatch Resolution

Feishu's `sendCardFeishu` receives `params.to` as a bare chat ID (e.g. `oc_xxx`),
while the plugin stores stats keyed by the raw sessionKey tail (e.g. `ou_xxx` for DM, `oc_xxx` for group).
Since Feishu dispatches are serialized per-channel, the patch reads the **first (and only)** entry
from the stats Map instead of matching by key, avoiding ID format mismatches.

### Known Issue: Concurrent DM + Group Chat

If a DM and a group chat are processed simultaneously (within the same channel),
the stats Map may contain **two entries** at the moment `sendCardFeishu` is called.
In this rare case, the patch reads the first entry, which may belong to the other conversation,
causing tool stats to appear on the wrong card.

**Current workaround:** Disable DM with the bot to prevent concurrent dispatches.

**Possible future solutions:**
1. **FIFO Queue:** Replace the Map with an ordered queue so stats are consumed in dispatch order.
2. **Run ID Tracking:** Include `runId` in the stats entry and match via `params.runId` (if available).
3. **Hybrid Key:** Use `params.to` for group chats (direct match) and fallback to queue order for DMs.

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

## 📄 License

MIT

---

# 🛠️ OpenClaw 插件：Tool Trace

在每个回复末尾自动附上本轮调用的工具统计。
支持 **Telegram / Webchat / Slack** 等文本通道，以及 **飞书（Feishu / Lark）** 卡片通道。

---

## ✨ 效果

**Telegram / Webchat:**
```
...回复内容...

调用工具：web_search(3)，academic_search(2)
```

**飞书卡片:**
```
...回复内容...

调用工具：amap-mcp__maps_weather(1)
Agent: main | Model: deepseek-v4-flash | Provider: volcengine coding plan
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

飞书插件使用独立的 bundle 管理卡片消息发送，因此多了一个额外步骤。

### 原理

```mermaid
flowchart LR
  Plugin["插件 after_tool_call"] -->|"写入 globalThis.__FEISHU_TOOL_STATS"| Map[Map<targetId, counts>]
  Map -->|"消费"| Patch["sendCardFeishu（已 patch）"]
  Patch -->|"追加到 card.body.elements[].content"| Card["飞书卡片"]
```

### 执行 Patch

```bash
cd /path/to/openclaw-plugin-tool-trace
node patch-feishu.mjs
```

脚本会自动定位飞书插件的 dist 目录，在 `sendCardFeishu` 函数入口注入拦截代码。
幂等设计，重复运行安全。

**如脚本未能自动定位飞书路径，可手动指定：**

```bash
# 查看飞书插件实际位置
find / -path "*/@openclaw/feishu/dist" -type d 2>/dev/null
# 然后手动 patch
node -e "
const fs = require('fs');
const path = '/path/to/@openclaw/feishu/dist/send-*.js';
// ... 手动修改
"
```

### 重启 Gateway

Patch 后需要重启 Gateway 使拦截代码生效：

```bash
kill -9 $(pgrep -f openclaw-gateway)
```

### 验证

从飞书发一条会调用工具的对话，回复末尾应出现 `调用工具：xxx(y)`。

---

## 🏗️ 架构

### 文本通道（TG / Webchat / Slack 等）

```
after_tool_call → runToolCounts Map → reply_payload_sending hook → 注入 text 末尾
```

### 飞书卡片通道

```
after_tool_call → globalThis.__FEISHU_TOOL_STATS[targetId]
                        ↓
sendCardFeishu（已 patch）→ 读取 statsMap（取第一条）
                        ↓
                追加到 card.body.elements[0].content
                        ↓
                调用原始 sendCardFeishu 发送
```

### 跨轮防污染

`before_dispatch` hook 在飞书入站阶段自动清理上一轮的残留统计。

### 关键修复：ID 不匹配问题

飞书的 `sendCardFeishu` 收到的 `params.to` 是裸聊天 ID（如 `oc_xxx`），
而插件存储的 key 是 sessionKey 末尾（单聊 `ou_xxx`、群聊 `oc_xxx`）。
由于飞书 dispatch 是串行处理的，patch 直接取 stats Map 的**第一条（也是唯一一条）**记录，
避免 ID 格式不匹配的问题。

### 已知问题：单聊与群聊并发

如果单聊和群聊消息同时被处理（同一 channel 内），
stats Map 在 `sendCardFeishu` 被调用时可能包含**两条记录**。
这时 patch 读取第一条记录，可能导致工具统计显示在错误的卡片上。

**当前解决方案：** 禁用机器人单聊，防止并发 dispatch。

**可能的未来方案：**
1. **FIFO 队列：** 用有序队列替代 Map，按 dispatch 顺序消费统计。
2. **Run ID 追踪：** 在 stats 条目中包含 `runId`，通过 `params.runId` 匹配。
3. **混合 Key：** 群聊直接用 `params.to` 匹配，单聊回退到队列顺序。

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

## 📄 License

MIT
