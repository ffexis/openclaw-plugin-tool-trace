import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// ─── 模块级计数器（TG / Webchat 用）────────────────────
const runToolCounts = new Map();

// ─── exec 脚本名识别（可自定义扩展）─────────────────────
const EXEC_SCRIPT_PATTERNS = [
  { re: /script\.js/, name: "script.js" },
  { re: /task\.js/, name: "task.js" },
];

function detectExecScript(command) {
  for (const { re, name } of EXEC_SCRIPT_PATTERNS) {
    if (re.test(command)) return name;
  }
  return null;
}

// ─── 从 sessionKey 提取飞书 targetId ────────────────────
function extractFeishuTargetId(sessionKey) {
  if (!sessionKey) return null;
  const parts = sessionKey.split(":");
  return parts[parts.length - 1] || null;
}

export default definePluginEntry({
  id: "tool-trace",
  name: "Tool Trace",
  description: "在每个回复末尾自动附上本轮调用的工具统计",
  register(api) {

    // ─── 收集工具调用次数 ─────────────────────────────────
    api.on("after_tool_call", async (event, ctx) => {
      // TG / Webchat: 写入模块级 Map（供 reply_payload_sending 消费）
      const primary = event.runId || ctx?.sessionKey || "default";
      let tgCounts = runToolCounts.get(primary);
      if (!tgCounts) { tgCounts = {}; runToolCounts.set(primary, tgCounts); }

      let label = event.toolName;
      if (event.toolName === "exec" && event.params?.command) {
        const scriptName = detectExecScript(event.params.command);
        if (scriptName) label = `exec(${scriptName})`;
      }

      tgCounts[label] = (tgCounts[label] ?? 0) + 1;

      const sk = ctx?.sessionKey;
      if (sk && sk !== primary) {
        let alt = runToolCounts.get(sk);
        if (!alt) { alt = {}; runToolCounts.set(sk, alt); }
        alt[label] = (alt[label] ?? 0) + 1;
      }

      // 飞书：额外写入 globalThis.__FEISHU_TOOL_STATS
      //（由 patch-feishu.mjs 注入的 sendCardFeishu 拦截代码消费）
      if (sk?.includes("feishu")) {
        const targetId = extractFeishuTargetId(sk);
        if (targetId) {
          globalThis.__FEISHU_TOOL_STATS = globalThis.__FEISHU_TOOL_STATS || new Map();
          const fsCounts = globalThis.__FEISHU_TOOL_STATS.get(targetId) || {};
          fsCounts[label] = (fsCounts[label] ?? 0) + 1;
          globalThis.__FEISHU_TOOL_STATS.set(targetId, fsCounts);
        }
      }
    });

    // ─── 入站前清空，防止跨轮污染（飞书）──────────────────
    api.on("before_dispatch", async (event, ctx) => {
      const sessionKey = ctx?.sessionKey || event.sessionKey || "default";
      if (!sessionKey.includes("feishu")) return;

      const targetId = extractFeishuTargetId(sessionKey);
      if (targetId && globalThis.__FEISHU_TOOL_STATS) {
        globalThis.__FEISHU_TOOL_STATS.delete(targetId);
      }
    });

    // ─── 文本通道（TG / Webchat）在回复末尾追加统计 ─────────
    api.on("reply_payload_sending", async (event, ctx) => {
      const candidates = [
        event.runId,
        ctx?.sessionKey,
        event.sessionKey,
        "default",
      ].filter(Boolean);

      let counts = null;
      let matchedKey = null;
      for (const key of candidates) {
        const c = runToolCounts.get(key);
        if (c && Object.keys(c).length > 0) {
          counts = c;
          matchedKey = key;
          break;
        }
      }

      if (event.channel === "feishu") return;
      if (!counts) return;

      const parts = Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => `${name}(${count})`)
        .join("，");

      const text = (event.payload.text || "") + `\n\n调用工具：${parts}`;
      for (const key of candidates) runToolCounts.delete(key);

      return { payload: { ...event.payload, text } };
    });
  },
});
