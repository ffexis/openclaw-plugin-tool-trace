import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "../..");
const TOOLS_DIR = path.join(WORKSPACE, "tools");

// ─── 模块级计数器（所有通道共用）────────────────────────
const runToolCounts = new Map();

// ─── 调试日志 ────────────────────────────────────────────
import fs from "node:fs";
const LOG = process.env.TOOL_TRACE_LOG || path.join(WORKSPACE, "tool-trace-debug.log");
function debug(...args) {
  try { fs.appendFileSync(LOG, new Date().toISOString() + " " + args.join(" ") + "\n"); } catch(e) {}
}

function runScript(script, args) {
  const scriptPath = path.join(TOOLS_DIR, script);
  try {
    const output = execSync(
      `node ${[scriptPath, ...args].map(a => `"${a}"`).join(" ")}`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
    );
    return { content: [{ type: "text", text: output }] };
  } catch (err) {
    return { content: [{ type: "text", text: err.stdout || err.message }] };
  }
}

// ─── exec 脚本名识别 ────────────────────────────────────────
const EXEC_SCRIPT_PATTERNS = [
  { re: /tools\/academic\.js/, name: "academic.js" },
  { re: /tools\/pmphai\.js/, name: "pmphai.js" },
  { re: /tools\/hgnc\.js/, name: "hgnc.js" },
  { re: /tools\/google-books\.js/, name: "google-books.js" },
  { re: /tools\/ccdas\.js/, name: "ccdas.js" },
  { re: /tools\/name-sort\.js/, name: "name-sort.js" },
  { re: /tools\/yuanwen\.js/, name: "yuanwen.js" },
];

function detectExecScript(command) {
  for (const { re, name } of EXEC_SCRIPT_PATTERNS) {
    if (re.test(command)) return name;
  }
  return null;
}

// ─── 从 sessionKey 提取飞书 targetId ────────────────────
// sessionKey 格式: agent:main:feishu:default:direct:ou_xxx
// 或 agent:main:feishu:group:oc_xxx
function extractFeishuTargetId(sessionKey) {
  if (!sessionKey) return null;
  const parts = sessionKey.split(":");
  let targetId = parts[parts.length - 1];
  if (targetId?.startsWith("ou_")) return `user:${targetId}`;
  if (targetId?.startsWith("oc_")) return `chat:${targetId}`;
  return null;
}

export default definePluginEntry({
  id: "tool-trace",
  name: "Tool Trace",
  register(api) {
    // ─── 注册 academic_search 工具 ───────────────────────
    api.registerTool({
      name: "academic_search",
      description: "搜索学术文献。支持命令: doi(按DOI查), search(关键词搜索), author(查作者), isbn(按ISBN查), book(查图书), venue(查期刊), concept(查学术概念), pmid(按PubMed ID查), epmsearch(搜索医学文献), references(查参考文献), citations(查施引文献)",
      parameters: Type.Object({
        command: Type.String({ description: "子命令: doi/search/author/isbn/book/venue/concept/pmid/epmsearch/references/citations" }),
        query: Type.String({ description: "搜索关键词或ID" }),
      }),
      async execute(_id, params) {
        return runScript("academic.js", [params.command, params.query]);
      },
    });

    // ─── 注册 pmphai_query 工具 ──────────────────────────
    api.registerTool({
      name: "pmphai_query",
      description: "查询人卫出版社(pmphai.com)的医学术语。支持模糊搜索和精确搜索",
      parameters: Type.Object({
        term: Type.String({ description: "搜索术语" }),
        mode: Type.Optional(Type.String({ description: "搜索模式: fuzzy(模糊) 或 exact(精确)，默认 fuzzy" })),
      }),
      async execute(_id, params) {
        const mode = params.mode === "exact" ? "exact" : "fuzzy";
        return runScript("pmphai.js", ["--compact", params.term, mode]);
      },
    });

    // ─── 注册 google_books_search 工具 ───────────────────
    api.registerTool({
      name: "google_books_search",
      description: "通过Google Books API查询图书信息。支持: isbn(按ISBN查), search(关键词搜索), author(按作者查), title(按书名查)",
      parameters: Type.Object({
        command: Type.String({ description: "子命令: isbn/search/author/title" }),
        query: Type.String({ description: "搜索关键词或ISBN" }),
      }),
      async execute(_id, params) {
        return runScript("google-books.js", [params.command, params.query]);
      },
    });

    // ─── 注册 ccdas_lookup 工具 ──────────────────────────
    api.registerTool({
      name: "ccdas_lookup",
      description: "查询人卫临床助手(CCDAS)医学知识库。支持: search(搜索列表), detail(查看详情), categories(列出知识库类型)",
      parameters: Type.Object({
        command: Type.String({ description: "子命令: search/detail/categories" }),
        query: Type.Optional(Type.String({ description: "搜索关键词（search时必填）" })),
        id: Type.Optional(Type.String({ description: "条目ID（detail时必填）" })),
        lib: Type.Optional(Type.String({ description: "知识库类型，默认 disease" })),
      }),
      async execute(_id, params) {
        const args = [params.command];
        if (params.command === "search") {
          if (params.query) args.push(params.query);
          if (params.lib) args.push("--lib", params.lib);
        } else if (params.command === "detail") {
          if (params.id) args.push(params.id);
          if (params.lib) args.push("--lib", params.lib);
        }
        return runScript("ccdas.js", args);
      },
    });

    // ─── 注册 name_sort 工具 ───────────────────────────
    api.registerTool({
      name: "name_sort",
      description: "姓名排序工具（通过公司内网 API）。支持: spell(拼音排序), strokes(笔画排序), spell-unit(拼音表格排序,参数格式:姓名,单位), strokes-unit(笔画表格排序,参数格式:姓名,单位), getSpell(拼音查询), getStrokes(笔顺查询), excel(Excel导入排序), template(下载导入模板)",
      parameters: Type.Object({
        command: Type.String({ description: "子命令: spell/strokes/spell-unit/strokes-unit/getSpell/getStrokes/excel/template" }),
        arguments: Type.Optional(Type.String({ description: "子命令参数" })),
      }),
      async execute(_id, params) {
        const args = [params.command];
        if (params.arguments) {
          // 作为 JSON 数组解析，支持逗号分隔和空格
          try {
            const parsed = JSON.parse(params.arguments);
            if (Array.isArray(parsed)) {
              args.push(...parsed);
            } else {
              args.push(params.arguments);
            }
          } catch {
            // 按空白分割（保留逗号，spell-unit/strokes-unit 需要逗号让脚本自己解析）
            args.push(...params.arguments.split(/\s+/).filter(Boolean));
          }
        }
        return runScript("name-sort.js", args);
      },
    });

    // ─── 注册 yuanwen_search 工具 ───────────────────────
    api.registerTool({
      name: "yuanwen_search",
      description: "查原文（图书搜索）- 搜索人卫出版社图书内容。支持: search(搜索), detail(查看详情)",
      parameters: Type.Object({
        command: Type.String({ description: "子命令: search(搜索) 或 detail(查看详情)" }),
        query: Type.Optional(Type.String({ description: "搜索关键词（search时必填）" })),
        id: Type.Optional(Type.String({ description: "片段ID（detail时必填）" })),
        limit: Type.Optional(Type.Number({ description: "返回数量，默认30" })),
        publishYears: Type.Optional(Type.String({ description: "出版年份筛选，逗号分隔，如 2024,2023" })),
      }),
      async execute(_id, params) {
        const args = [];
        if (params.command === "search") {
          if (params.query) args.push(params.query);
          if (params.limit) args.push("--limit", String(params.limit));
          if (params.publishYears) args.push("--year", params.publishYears);
        } else if (params.command === "detail") {
          args.push("--detail");
          if (params.id) args.push(params.id);
        }
        return runScript("yuanwen.js", args);
      },
    });

    // ─── 注册 hgnc_lookup 工具 ───────────────────────────
    api.registerTool({
      name: "hgnc_lookup",
      description: "查询HGNC基因命名数据库。支持: lookup(按symbol快捷查), fetch(按字段查完整信息), search(搜索基因)",
      parameters: Type.Object({
        command: Type.String({ description: "子命令: lookup/fetch/search" }),
        field: Type.Optional(Type.String({ description: "查询字段: symbol/hgnc_id/entrez_id/ensembl_gene_id/name 等" })),
        value: Type.String({ description: "查询值" }),
      }),
      async execute(_id, params) {
        const args = [params.command];
        if (params.field) args.push(params.field);
        args.push(params.value);
        return runScript("hgnc.js", args);
      },
    });

    // ─── 收集工具调用次数 ─────────────────────────────────
    api.on("after_tool_call", async (event, ctx) => {
      // 所有通道：写入模块级 Map（供 reply_payload_sending 消费）
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
    });

    // ─── 所有通道（TG / Webchat / Feishu）走 reply_payload_sending ──
    api.on("reply_payload_sending", async (event, ctx) => {
      const candidates = [
        event.runId,
        ctx?.sessionKey,
        event.sessionKey,
        "default"
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

      // 飞书会按 block/final 多次回调；统计只挂在最终 payload 上
      if (event.channel === "feishu" && event.kind && event.kind !== "final") return;
      if (!counts) return;

      const parts = Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => `${name}(${count})`)
        .join("，");

      debug(`reply_payload_sending inject: ${parts} channel=${event.channel}`);

      const text = (event.payload.text || "") + `\n\n调用工具：${parts}`;
      for (const key of candidates) runToolCounts.delete(key);

      return { payload: { ...event.payload, text } };
    });
  },
});
