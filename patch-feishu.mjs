#!/usr/bin/env node
/**
 * patch-feishu.mjs
 *
 * 飞书工具统计注入 Patch
 * 在 Feishu 插件底层 sendCardFeishu 函数入口注入拦截代码，
 * 从 globalThis.__FEISHU_TOOL_STATS 读取工具调用统计并追加到卡片正文。
 *
 * 用法:
 *   node patch-feishu.mjs
 *
 * 注意：
 *   需要先安装 @openclaw/feishu 插件（通常 OpenClaw 已自带）
 *   脚本会自动定位飞书插件的 dist 目录
 *   幂等设计，重复运行安全
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 尝试在 node_modules 中寻找飞书插件的 dist 目录
 */
function findFeishuDistDir() {
  const candidates = [
    // 常见安装路径
    path.resolve(__dirname, "node_modules/@openclaw/feishu/dist"),
    // OpenClaw workspace 路径
    path.resolve(__dirname, "../data/home/.openclaw/npm"),
  ];

  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    // 精确匹配 feishu 项目
    const dirs = fs.readdirSync(base);
    const feishuDir = dirs.find(
      (d) => d.startsWith("openclaw-feishu-") || d === "@openclaw"
    );
    if (feishuDir) {
      // 可能是 npm/projects/openclaw-feishu-xxx/node_modules/@openclaw/feishu/dist
      const fullPath = path.resolve(base, feishuDir);
      const sendFile = fs
        .readdirSync(fullPath)
        .find((f) => f.startsWith("send-") && f.endsWith(".js"));
      if (sendFile) return fullPath;
      // 或者 npm/node_modules/@openclaw/feishu/dist
      const altPath = path.resolve(fullPath, "node_modules/@openclaw/feishu/dist");
      if (fs.existsSync(altPath)) return altPath;
    }
  }

  // 全盘扫描（谨慎使用）
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

const PATCH_MARKER = "/* __FEISHU_TOOL_STATS_PATCHED__ */";

function patchFeishuSender() {
  const distDir = findFeishuDistDir();
  if (!distDir) {
    console.error(
      "❌ 未找到飞书插件的 dist 目录。请确认 @openclaw/feishu 已安装。"
    );
    console.error(
      "   常见位置: node_modules/@openclaw/feishu/dist"
    );
    process.exit(1);
  }

  const files = fs.readdirSync(distDir);
  const sendFile = files.find(
    (f) => f.startsWith("send-") && f.endsWith(".js")
  );
  if (!sendFile) {
    console.error("❌ 未找到 send-*.js 文件");
    process.exit(1);
  }

  const targetPath = path.join(distDir, sendFile);
  console.log(`📁 目标文件: ${targetPath}`);

  let code = fs.readFileSync(targetPath, "utf-8");

  // 幂等性检查
  if (code.includes(PATCH_MARKER)) {
    console.log("✅ 飞书发送器已打过补丁，跳过。");
    return;
  }

  const targetSignature = "async function sendCardFeishu(params) {";
  if (!code.includes(targetSignature)) {
    console.error("❌ 无法在源码中定位 sendCardFeishu 函数签名。");
    console.error("   可能是飞书插件版本不兼容。");
    process.exit(1);
  }

  // 注入的拦截代码（严格语法，无需额外依赖）
  const injectedCode = `
${PATCH_MARKER}
\ttry {
\t\tconst statsMap = globalThis.__FEISHU_TOOL_STATS;
\t\tif (statsMap && statsMap.has(params.to)) {
\t\t\tconst counts = statsMap.get(params.to);
\t\t\tconst parts = Object.entries(counts)
\t\t\t\t.sort((a, b) => a[0].localeCompare(b[0]))
\t\t\t\t.map(x => x[0] + '(' + x[1] + ')')
\t\t\t\t.join("，");
\t\t\tconst suffix = "\\n\\n调用工具：" + parts;

\t\t\tif (params.card && params.card.body && Array.isArray(params.card.body.elements)) {
\t\t\t\tconst mainElement = params.card.body.elements.find(el => el.tag === "markdown");
\t\t\t\tif (mainElement) {
\t\t\t\t\tmainElement.content += suffix;
\t\t\t\t}
\t\t\t}
\t\t\tstatsMap.delete(params.to);
\t\t}
\t} catch(e) {}
`;

  code = code.replace(
    targetSignature,
    `${targetSignature}\n${injectedCode}`
  );

  fs.writeFileSync(targetPath, code, "utf-8");
  console.log("✅ 飞书底层发包函数 Patch 注入成功！");
  console.log(`   - 文件: ${sendFile}`);
  console.log(`   - 注入位置: sendCardFeishu 函数入口`);
  console.log(`   - 读取源: globalThis.__FEISHU_TOOL_STATS`);
  console.log(`   - 写入目标: params.card.body.elements[] markdown content`);
  console.log("");
  console.log("⚠️  请重启 OpenClaw Gateway 使 Patch 生效。");
}

patchFeishuSender();
