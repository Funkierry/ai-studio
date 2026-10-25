'use strict';
// Has an employee's own model write a deliverable. Any failure returns a reason so the caller can fall back to a template.
const fs = require('node:fs');
const path = require('node:path');
const anthropic = require('./providers/anthropic');
const openai = require('./providers/openai');
const deepseek = require('./providers/deepseek');
const { createCompatible } = require('./providers/compatible');
const { claudeCode, codexCli } = require('./providers/cli');

const PROVIDERS = { anthropic, openai, deepseek, 'claude-cli': claudeCode, 'codex-cli': codexCli };
// which model each kind of employee really is, in order of preference: an API key when there is one,
// otherwise the agent installed and logged in on this computer. Every hire of a kind uses the same model.
const CANDIDATES = { claude: ['anthropic', 'claude-cli'], gpt: ['openai', 'codex-cli'], codex: ['codex-cli', 'openai'], deepseek: ['deepseek'] };
const PROVIDER_OF = {};
function providerFor(type) {
  const list = CANDIDATES[type];
  if (!list) return PROVIDER_OF[type];
  return list.find(id => PROVIDERS[id].status().configured) || list[0];
}
const USD_CNY = +process.env.STUDIO_USD_CNY || 7.2;
const FAKE = process.env.STUDIO_FAKE_LLM === '1'; // offline test double, never for real use

/* ---------- extra employee kinds from models.json (any OpenAI-compatible API) ---------- */
const CONFIG_FILE = path.join(__dirname, '..', 'models.json');
const CUSTOM_TYPES = [];
let configError = null;
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    for (const t of cfg.types || []) {
      if (!/^[a-z][a-z0-9_-]{1,23}$/.test(t.type || '')) throw new Error(`type「${t.type}」只能用小写字母、数字、-、_，2 到 24 个字符`);
      if (CANDIDATES[t.type] || PROVIDER_OF[t.type]) throw new Error(`type「${t.type}」和已有的员工类型重名`);
      for (const k of ['label', 'baseURL', 'keyEnv', 'model']) if (!t[k]) throw new Error(`「${t.type}」缺少 ${k}`);
      const id = `custom:${t.type}`;
      PROVIDERS[id] = createCompatible({
        name: t.label, baseURL: t.baseURL, keyEnv: t.keyEnv, model: t.model, maxTokens: t.maxTokens, json: t.json, noKey: t.noKey,
        currency: t.price?.currency === 'CNY' ? 'CNY' : 'USD', prices: t.price ? { input: t.price.input, output: t.price.output, cachedInput: t.price.cachedInput } : null,
      });
      PROVIDER_OF[t.type] = id;
      CUSTOM_TYPES.push({ type: t.type, label: t.label, names: t.names || [], traits: t.traits || [], pitch: t.pitch || '' });
    }
  } catch (err) {
    configError = `models.json 有问题：${err.message}`;
    console.error(configError);
  }
}

/* ---------- what the model must return ---------- */
const DOC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'document', 'open_questions'],
  properties: {
    summary: { type: 'string', description: '一两句话说明交付了什么，给老板和同事看' },
    document: { type: 'string', description: '完整的 Markdown 正文，不含一级标题' },
    open_questions: { type: 'array', items: { type: 'string' }, description: '需要老板确认或补充的信息，没有就给空数组' },
  },
};
const CODE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'notes', 'files'],
  properties: {
    summary: { type: 'string', description: '一两句话说明这次交付了什么' },
    notes: { type: 'string', description: 'Markdown：改了什么、怎么运行、同事需要知道的约定和已知限制' },
    files: {
      type: 'array', description: '这次新增或修改的文件，每个都是完整内容',
      items: { type: 'object', additionalProperties: false, required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } } },
    },
  },
};
// shown to models whose JSON mode can't take a schema
const DOC_EXAMPLE = '{"summary": "一两句话", "document": "## 小标题\\n正文……", "open_questions": ["需要老板确认的问题"]}';
const CODE_EXAMPLE = '{"summary": "一两句话", "notes": "## 改动\\n……", "files": [{"path": "src/index.js", "content": "完整文件内容"}]}';

const BASE_SYSTEM = `你是「AI 工作室」的一名员工，替老板完成工作。你交出的东西会被直接保存和使用：文档进公司文档库，代码提交到 Git 仓库。

- 用简体中文写文档和说明；代码里的注释也用简体中文。
- 以老板给的要求、参考资料和同事的交付为依据。没有给出的事实（真实数据、用户数量、价格等）不要编造，确实需要时写成假设并标明。
- 老板的长期要求和已经做的决定必须遵守；老板的修改意见优先级最高。
- 只返回要求的 JSON 结构。`;

const READABLE = '- 代码要能让同事审查：正常换行和缩进，变量名有意义，不要压缩成一行或做任何混淆。\n- 文件路径用相对路径，返回每个文件的完整内容，只返回这次新增或修改的文件。';
const PROJECT_CODE_RULES = `代码约定（项目里所有分工共用，保证大家的代码能拼在一起）：
- 只用 Node.js 22 及以上的内置模块（node:http、node:sqlite、node:fs、node:path、node:test、node:assert 等），不引入任何 npm 依赖。
- 后端在 server/：server/index.js 用 node:http 提供 JSON 接口；数据库用 node:sqlite 的 DatabaseSync，文件路径取环境变量 DB_FILE（默认项目根目录的 data.db），并且在加载模块时就读取它；表结构写在 server/schema.sql（CREATE TABLE IF NOT EXISTS），示例数据写在 server/seed.sql，表为空时导入；module.exports = { server }，只有 require.main === module 时才 listen（端口取 PORT，默认 4000）；同时把 web/ 目录当静态页面提供。
- 接口文档写在 docs/API.md，前端和测试都以它为准。
- 前端在 web/：纯 HTML、CSS 和原生 JavaScript，用相对路径调用后端接口。
- 测试在 tests/，文件名以 .test.js 结尾，用 node:test 和 node:assert：先设置 process.env.DB_FILE = ':memory:'，再 require 后端，用 server.listen(0) 启动，通过 fetch 调接口，测完关闭服务；不依赖网络和外部服务。
${READABLE}`;
const ORDER_CODE_RULES = `代码约定：
- 按订单要求选择语言和结构；订单没有指定时，优先用 Node.js 内置模块，不引入依赖。
- 附上 README.md，写清楚怎么运行。
${READABLE}`;

const KIND_ASK = {
  prd: '写一份需求文档：用户与场景、功能清单（带优先级）、页面或模块清单、关键流程、边界情况、验收标准。',
  design: '写一份界面设计说明：每个页面的线框（可以用代码块画 ASCII 线框）、元素和交互说明、状态（空、加载、出错）。',
  doc: '按分工要求写出完整的文档，先给结论，再给依据和下一步。',
  backend: '实现后端：数据表、示例数据、接口和接口文档。',
  frontend: '实现前端页面，严格按接口文档调用后端。',
  code: '按分工要求实现代码。',
  test: '为当前代码写自动化测试，覆盖主要接口和关键流程；在 notes 里写测试计划、覆盖范围和发现的问题。测试会被真的运行，结果会写进测试报告。',
};
const isCodeKind = k => ['backend', 'frontend', 'code', 'test'].includes(k);

function status() {
  const out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) out[id] = p.status();
  const types = { ...PROVIDER_OF };
  for (const t of Object.keys(CANDIDATES)) types[t] = providerFor(t);
  return { fake: FAKE, providers: out, types, custom_types: CUSTOM_TYPES, config_error: configError };
}

function cleanFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('没有返回任何文件');
  if (files.length > 40) throw new Error(`一次返回了 ${files.length} 个文件，太多了`);
  const out = {};
  for (const f of files) {
    const p = String(f.path || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const norm = path.posix.normalize(p);
    if (!p || path.posix.isAbsolute(p) || norm.startsWith('..') || /(^|\/)\.git(\/|$)/.test(norm) || /^[a-zA-Z]:/.test(p)) throw new Error(`文件路径不合法：${p}`);
    if (typeof f.content !== 'string') throw new Error(`文件内容不是文本：${p}`);
    if (f.content.length > 300000) throw new Error(`文件太大：${p}`);
    out[norm] = f.content;
  }
  return out;
}

// prompt: the full brief; ask: what to hand in (defaults per kind); rules: 'project' | 'order' code conventions;
// fake: template output used only when STUDIO_FAKE_LLM=1
async function write({ employee, kind, prompt, ask, rules = 'project', fake }) {
  const code = isCodeKind(kind);
  const providerId = providerFor(employee.type);
  if (!FAKE && !providerId) return { ok: false, reason: `${employee.name}（${employee.model}）还没有接入真实模型` };
  const system = code ? `${BASE_SYSTEM}\n\n${rules === 'order' ? ORDER_CODE_RULES : PROJECT_CODE_RULES}` : BASE_SYSTEM;
  const full = `${prompt}\n\n## 这次要交的东西\n${ask || KIND_ASK[kind] || KIND_ASK.doc}`;
  const started = Date.now();
  try {
    const r = FAKE
      ? { text: JSON.stringify(fake()), model: 'fake-model', input_tokens: Math.round(full.length / 2), output_tokens: 1200, usd: 0 }
      : await PROVIDERS[providerId].generate({ system, prompt: full, schema: code ? CODE_SCHEMA : DOC_SCHEMA,
        example: code ? CODE_EXAMPLE : DOC_EXAMPLE, effort: code ? 'high' : 'medium' });
    let data;
    try { data = JSON.parse(r.text); } catch { throw new Error('模型返回的不是合法 JSON'); }
    if (!data || typeof data !== 'object') throw new Error('模型返回的不是 JSON 对象');
    if (typeof data.summary !== 'string') data.summary = '';
    if (code) data.files = cleanFiles(data.files);
    else if (!String(data.document || '').trim()) throw new Error('文档是空的');
    if (!code && !Array.isArray(data.open_questions)) data.open_questions = [];
    const cny = r.cny != null ? r.cny : r.usd == null ? null : r.usd * USD_CNY;
    return {
      ok: true, data,
      meta: { provider: FAKE ? 'fake' : providerId, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens,
        usd: r.usd ?? null, cny, plan_usd: r.plan_usd ?? null, ms: Date.now() - started, prompt_chars: full.length },
    };
  } catch (err) {
    const p = PROVIDERS[providerId];
    return { ok: false, reason: (p && p.describeError(err)) || err.message, ms: Date.now() - started };
  }
}

module.exports = { write, status, isCodeKind };
