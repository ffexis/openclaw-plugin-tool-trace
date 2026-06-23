# 🛠️ OpenClaw Plugin: Tool Trace

> 在每个回复末尾自动附上本轮调用的工具统计。
> 支持 **Telegram / Webchat / Slack** 等文本通道，以及 **飞书（Feishu / Lark）** 卡片通道。

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
sendCardFeishu (已 patch) → 读取 statsMap.has(params.to)
                        ↓
                追加到 card.body.elements[0].content
                        ↓
                调用原始 sendCardFeishu 发送
```

### 跨轮防污染

`before_dispatch` hook 在飞书入站阶段自动清理上一轮的残留统计。

---

## ⚙️ 自定义 exec 脚本名识别

插件默认识别 `academic.js`、`pmphai.js`、`hgnc.js`、`google-books.js` 等脚本。
如需添加自定义脚本，修改 `index.mjs` 中的 `EXEC_SCRIPT_PATTERNS` 数组：

```javascript
const EXEC_SCRIPT_PATTERNS = [
  { re: /tools\/my-script\.js/, name: "my-script.js" },
];
```

---

## 📄 License

MIT
