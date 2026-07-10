#!/usr/bin/env node
/**
 * patch-feishu.mjs
 *
 * 飞书工具统计注入 Patch（v2 — 上游统一注入）
 *
 * 架构变更（v1 → v2）：
 *   v1: 在 sendCardFeishu 函数入口拦截，追加到 card body
 *       问题：CardKit 流式不走 sendCardFeishu，post 消息也不走
 *   v2: 在 monitor.account 的 deliver/closeStreaming/resolveCardNote 三个点注入
 *       覆盖：CardKit 流式卡片 + 静态卡片 + post 富文本消息
 *
 * 注入点：
 *   A. resolveCardNote — 静态卡片的 note footer（灰色小字）
 *   B. closeStreaming — CardKit 流式卡片关闭时的最终文本
 *   C. deliver post 分支 — post 富文本消息的最终文本
 *
 * 同时移除 v1 在 sendCardFeishu 中的旧 patch。
 *
 * 用法:
 *   node patch-feishu.mjs
 *
 * 注意：
 *   需要先安装 @openclaw/feishu 插件
 *   幂等设计，重复运行安全
 *   ⚠️ 代码尚未经过完整测试，请谨慎使用
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 查找飞书插件 dist 目录 ─────────────────────────────
function findFeishuDistDir() {
  const candidates = [
    path.resolve(__dirname, "node_modules/@openclaw/feishu/dist"),
    path.resolve(__dirname, "../data/home/.openclaw/npm"),
  ];

  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs.readdirSync(base);
    const feishuDir = dirs.find(
      (d) => d.startsWith("openclaw-feishu-") || d === "@openclaw"
    );
    if (feishuDir) {
      const fullPath = path.resolve(base, feishuDir);
      const sendFile = fs
        .readdirSync(fullPath)
        .find((f) => f.startsWith("send-") && f.endsWith(".js"));
      if (sendFile) return fullPath;
      const altPath = path.resolve(fullPath, "node_modules/@openclaw/feishu/dist");
      if (fs.existsSync(altPath)) return altPath;
    }
  }

  // 全盘扫描兜底
  const root = path.resolve("/");
  const found = [];
  try {
    const walk = (dir, depth) => {
      if (depth > 5) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (e.name.startsWith("openclaw-feishu-")) {
            const sendFile = fs
              .readdirSync(path.join(dir, e.name))
              .find((f) => f.startsWith("send-") && f.endsWith(".js"));
            if (sendFile) found.push(path.join(dir, e.name));
          }
          if (depth < 5) walk(path.join(dir, e.name), depth + 1);
        }
      } catch {}
    };
    walk(root, 0);
  } catch {}

  if (found.length > 0) return found[0];
  return null;
}

// ─── 常量 ──────────────────────────────────────────────
const OLD_PATCH_MARKER = "/* __FEISHU_TOOL_STATS_PATCHED__ */";
const NEW_PATCH_MARKERS = {
  NOTE:    "/* __FEISHU_TOOL_STATS_NOTE_PATCH__ */",
  STREAM:  "/* __FEISHU_TOOL_STATS_STREAM_CLOSE_PATCH__ */",
  POST:    "/* __FEISHU_TOOL_STATS_POST_PATCH__ */",
};

// ─── 注入代码片段 ──────────────────────────────────────

/**
 * Patch A: resolveCardNote — 静态卡片的 note footer
 * 注入到 parts.push 之前，追加 tool stats 到 parts 数组
 * 注意：不 delete statsMap，留给 Patch B/C 在最终消费时清理
 */
const INJECT_NOTE = `
\t/* ${NEW_PATCH_MARKERS.NOTE} */
\ttry {
\t\tconst statsMap = globalThis.__FEISHU_TOOL_STATS;
\t\tif (statsMap && statsMap.size > 0) {
\t\t\tconst entries = [...statsMap.entries()];
\t\t\tconst [matchedKey, counts] = entries[0];
\t\t\tconst toolParts = Object.entries(counts)
\t\t\t\t.sort((a, b) => a[0].localeCompare(b[0]))
\t\t\t\t.map(x => x[0] + '(' + x[1] + ')')
\t\t\t\t.join('，');
\t\t\tparts.push('调用工具: ' + toolParts);
\t\t\t// 不 delete — 留给 closeStreaming 或 deliver 在最终消费时清理
\t\t}
\t} catch(e) {}
`;

/**
 * Patch B: closeStreaming — CardKit 流式卡片关闭时
 * 在 text 末尾追加 tool stats，然后 delete statsMap
 * 注意：text 原本是 const，需要改成 let
 */
const INJECT_STREAM = `
\t\t/* ${NEW_PATCH_MARKERS.STREAM} */
\t\ttry {
\t\t\tconst statsMap = globalThis.__FEISHU_TOOL_STATS;
\t\t\tif (statsMap && statsMap.size > 0) {
\t\t\t\tconst entries = [...statsMap.entries()];
\t\t\t\tconst [matchedKey, counts] = entries[0];
\t\t\t\tconst parts = Object.entries(counts)
\t\t\t\t\t.sort((a, b) => a[0].localeCompare(b[0]))
\t\t\t\t\t.map(x => x[0] + '(' + x[1] + ')')
\t\t\t\t\t.join('，');
\t\t\t\ttext = text + '\\n\\n调用工具：' + parts;
\t\t\t\tstatsMap.delete(matchedKey);
\t\t\t}
\t\t} catch(e) {}
`;

/**
 * Patch C: deliver post 分支 — post 富文本消息
 * 在 sendChunkedTextReply 之前注入 tool stats 到 text
 * 同时 delete statsMap
 */
const INJECT_POST = `
\t\t\t\t/* ${NEW_PATCH_MARKERS.POST} */
\t\t\t\ttry {
\t\t\t\t\tconst statsMap = globalThis.__FEISHU_TOOL_STATS;
\t\t\t\t\tif (statsMap && statsMap.size > 0) {
\t\t\t\t\t\tconst entries = [...statsMap.entries()];
\t\t\t\t\t\tconst [matchedKey, counts] = entries[0];
\t\t\t\t\t\tconst parts = Object.entries(counts)
\t\t\t\t\t\t\t.sort((a, b) => a[0].localeCompare(b[0]))
\t\t\t\t\t\t\t.map(x => x[0] + '(' + x[1] + ')')
\t\t\t\t\t\t\t.join('，');
\t\t\t\t\t\ttext = text + '\\n\\n调用工具：' + parts;
\t\t\t\t\t\tstatsMap.delete(matchedKey);
\t\t\t\t\t}
\t\t\t\t} catch(e) {}
`;

// ─── 移除 v1 旧 patch ──────────────────────────────────
function removeOldPatchFromSendFile(distDir) {
  const files = fs.readdirSync(distDir);
  const sendFile = files.find(
    (f) => f.startsWith("send-") && f.endsWith(".js")
  );
  if (!sendFile) {
    console.error("❌ 未找到 send-*.js 文件");
    return false;
  }

  const targetPath = path.join(distDir, sendFile);
  let code = fs.readFileSync(targetPath, "utf-8");

  if (!code.includes(OLD_PATCH_MARKER)) {
    console.log("  ℹ️  send-*.js 中未找到旧 patch，跳过移除。");
    return true;
  }

  // 移除从 OLD_PATCH_MARKER 到 catch(e){} 的整段代码
  // 匹配模式：
  // /* __FEISHU_TOOL_STATS_PATCHED__ */
  // \ttry {
  //   ... 多行 ...
  // \t} catch(e) {}
  const oldPatchRegex = new RegExp(
    `\\n\\t${escapeRegex(OLD_PATCH_MARKER)}[\\s\\S]*?\\n\\t\\}\\)\\{\\}`,
    "g"
  );

  const beforeLen = code.length;
  code = code.replace(oldPatchRegex, "");
  if (code.length === beforeLen) {
    console.error("  ⚠️  找到旧 patch 标记但无法匹配完整代码块，请手动检查。");
    return false;
  }

  fs.writeFileSync(targetPath, code, "utf-8");
  console.log(`  ✅ 已移除 sendCardFeishu 中的旧 patch`);
  return true;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── 注入新 patch ──────────────────────────────────────
function patchMonitorAccount(distDir) {
  const files = fs.readdirSync(distDir);
  const monitorFile = files.find(
    (f) => f.startsWith("monitor.account-") && f.endsWith(".js")
  );
  if (!monitorFile) {
    console.error("❌ 未找到 monitor.account-*.js 文件");
    return false;
  }

  const targetPath = path.join(distDir, monitorFile);
  console.log(`📁 目标文件: ${targetPath}`);
  let code = fs.readFileSync(targetPath, "utf-8");

  // 幂等性检查
  if (code.includes(NEW_PATCH_MARKERS.NOTE)) {
    console.log("✅ monitor.account 已打过补丁，跳过。");
    return true;
  }

  // ─── Patch A: resolveCardNote ──────────────────────────
  // 目标代码：
  //   return parts.join(" | ");
  // 在 return 之前注入
  const noteReturnPattern = "return parts.join(\" | \");";
  if (!code.includes(noteReturnPattern)) {
    console.error("❌ 无法定位 resolveCardNote 的 return 语句");
    return false;
  }
  code = code.replace(noteReturnPattern, `${INJECT_NOTE}\t${noteReturnPattern}`);
  console.log("  ✅ Patch A (resolveCardNote) 注入成功");

  // ─── Patch B: closeStreaming ──────────────────────────
  // 目标代码：
  //   const text = buildCombinedStreamText(reasoningText, streamText);
  // 改成：
  //   let text = buildCombinedStreamText(reasoningText, streamText);
  //   后面注入 INJECT_STREAM
  const streamTextPattern = "const text = buildCombinedStreamText(reasoningText, streamText);";
  if (!code.includes(streamTextPattern)) {
    console.error("❌ 无法定位 closeStreaming 的 buildCombinedStreamText");
    return false;
  }
  code = code.replace(
    streamTextPattern,
    `let text = buildCombinedStreamText(reasoningText, streamText);${INJECT_STREAM}`
  );
  console.log("  ✅ Patch B (closeStreaming) 注入成功");

  // ─── Patch C: deliver post 分支 ───────────────────────
  // 目标代码：
  //   } else await sendChunkedTextReply({
  // 在 else 之后、sendChunkedTextReply 之前注入
  // 注意：要确保只匹配 deliver 函数里的那个 else（不是其他地方）
  // 我们用更精确的上下文：`useCard: false,` 前面的 `} else await sendChunkedTextReply({`
  const postPattern = "} else await sendChunkedTextReply({";
  if (!code.includes(postPattern)) {
    console.error("❌ 无法定位 deliver 的 post 分支");
    return false;
  }
  code = code.replace(postPattern, `}${INJECT_POST}\t\t\tawait sendChunkedTextReply({`);
  console.log("  ✅ Patch C (deliver post 分支) 注入成功");

  fs.writeFileSync(targetPath, code, "utf-8");
  console.log(`\n✅ 所有 Patch 注入成功！`);
  console.log(`   - 文件: ${monitorFile}`);
  return true;
}

// ─── 主流程 ─────────────────────────────────────────────
function main() {
  console.log("🔧 openclaw-plugin-tool-trace — Feishu Patch v2\n");

  const distDir = findFeishuDistDir();
  if (!distDir) {
    console.error("❌ 未找到飞书插件的 dist 目录。请确认 @openclaw/feishu 已安装。");
    console.error("   常见位置: node_modules/@openclaw/feishu/dist");
    process.exit(1);
  }

  console.log(`📁 飞书插件 dist 目录: ${distDir}`);

  // 1. 移除 v1 旧 patch
  console.log("\n🔸 步骤 1/2: 移除 v1 旧 patch (sendCardFeishu)...");
  const removed = removeOldPatchFromSendFile(distDir);

  // 2. 注入 v2 新 patch
  console.log("\n🔸 步骤 2/2: 注入 v2 新 patch (monitor.account)...");
  const patched = patchMonitorAccount(distDir);

  if (removed && patched) {
    console.log("\n✅ 全部完成！");
    console.log("");
    console.log("📋 变更摘要:");
    console.log("   - send-*.js: 移除 sendCardFeishu 中的旧 patch");
    console.log("   - monitor.account-*.js: 注入 3 个新 patch");
    console.log("     A. resolveCardNote → 静态卡片 note footer");
    console.log("     B. closeStreaming → CardKit 流式卡片最终文本");
    console.log("     C. deliver post 分支 → post 富文本消息");
    console.log("");
    console.log("⚠️  代码尚未经过完整测试，请谨慎使用。");
    console.log("⚠️  请重启 OpenClaw Gateway 使 Patch 生效。");
  } else {
    console.log("\n❌ 部分步骤失败，请检查上述错误信息。");
    process.exit(1);
  }
}

main();
