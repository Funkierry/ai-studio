'use strict';
// Has an employee's own model write a role's deliverable. Any failure returns a reason so the caller can fall back to the template.
const path = require('node:path');
const anthropic = require('./providers/anthropic');
const openai = require('./providers/openai');
const deepseek = require('./providers/deepseek');

const PROVIDERS = { anthropic, openai, deepseek };
// which model each kind of employee really is; every hire of a kind uses the same model
const PROVIDER_OF = { claude: 'anthropic', gpt: 'openai', codex: 'openai', deepseek: 'deepseek' };
// shown to models whose JSON mode can't take a schema
const DOC_EXAMPLE = '{"summary": "一两句话", "document": "## 小标题\\n正文……", "open_questions": ["需要老板确认的问题"]}';
const CODE_EXAMPLE = '{"summary": "一两句话", "notes": "## 改动\\n……", "files": [{"path": "server/index.js", "content": "完整文件内容"}]}';
const USD_CNY = +process.env.STUDIO_USD_CNY || 7.2;
const FAKE = process.env.STUDIO_FAKE_LLM === '1'; // offline test double, never for real use

const DOC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'document', 'open_questions'],
  properties: {
    summary: { type: 'string', description: '一两句话说明交付了什么，给老板和下游同事看' },
    document: { type: 'string', description: '完整的 Markdown 文档正文，不含一级标题' },
    open_questions: { type: 'array', items: { type: 'string' }, description: '需要老板确认或补充的信息，没有就给空数组' },
  },
};
const CODE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'notes', 'files'],
  properties: {
    summary: { type: 'string', description: '一两句话说明这次交付了什么' },
    notes: { type: 'string', description: 'Markdown：改了什么、怎么运行、下游同事需要知道的约定和已知限制' },
    files: {
      type: 'array', description: '这次新增或修改的文件，每个都是完整内容',
      items: { type: 'object', additionalProperties: false, required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } } },
    },
  },
};

const BASE_SYSTEM = `你是「AI 工作室」的一名员工，正在和同事接力完成老板安排的项目。你交出的东西会被直接保存和使用：文档进公司文档库，代码提交到项目的 Git 仓库、由同事审查后合并，测试会被真的运行。

- 用简体中文写文档和说明；代码里的注释也用简体中文。
- 以项目目标、工作单和上游同事的交付为依据。上游没有给出的事实（真实数据、用户数量、价格等）不要编造，确实需要时写成假设并标明。
- 老板的长期要求和本项目里老板已经做的决定必须遵守；老板的修改意见优先级最高。
- 只返回要求的 JSON 结构。`;

const CODE_RULES = `代码约定（项目里所有分工共用，保证大家的代码能拼在一起）：
- 只用 Node.js 22 及以上的内置模块（node:http、node:sqlite、node:fs、node:path、node:test、node:assert 等），不引入任何 npm 依赖。
- 后端在 server/：server/index.js 用 node:http 提供 JSON 接口；数据库用 node:sqlite 的 DatabaseSync，文件路径取环境变量 DB_FILE（默认项目根目录的 data.db），并且在加载模块时就读取它；表结构写在 server/schema.sql（CREATE TABLE IF NOT EXISTS），示例数据写在 server/seed.sql，表为空时导入；module.exports = { server }，只有 require.main === module 时才 listen（端口取 PORT，默认 4000）；同时把 web/ 目录当静态页面提供。
- 接口文档写在 docs/API.md，前端和测试都以它为准。
- 前端在 web/：纯 HTML、CSS 和原生 JavaScript，用相对路径调用后端接口。
- 测试在 tests/，文件名以 .test.js 结尾，用 node:test 和 node:assert：先设置 process.env.DB_FILE = ':memory:'，再 require 后端，用 server.listen(0) 启动，通过 fetch 调接口，测完关闭服务；不依赖网络和外部服务。
- 代码要能让同事审查：正常换行和缩进，变量名有意义，不要压缩成一行或做任何混淆。
- 文件路径用相对路径，返回每个文件的完整内容，只返回这次新增或修改的文件。`;

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
  return { fake: FAKE, providers: out, types: { ...PROVIDER_OF } };
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

// prompt: the full brief for this role; fake: template output used only when STUDIO_FAKE_LLM=1
async function write({ employee, kind, prompt, fake }) {
  const code = isCodeKind(kind);
  const providerId = PROVIDER_OF[employee.type];
  if (!FAKE && !providerId) return { ok: false, reason: `${employee.name}（${employee.model}）还没有接入真实模型` };
  const system = code ? `${BASE_SYSTEM}\n\n${CODE_RULES}` : BASE_SYSTEM;
  const full = `${prompt}\n\n## 这次要交的东西\n${KIND_ASK[kind] || KIND_ASK.doc}`;
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
    return {
      ok: true, data,
      meta: { provider: FAKE ? 'fake' : providerId, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens,
        usd: r.usd, cny: r.usd == null ? null : r.usd * USD_CNY, ms: Date.now() - started, prompt_chars: full.length },
    };
  } catch (err) {
    const p = PROVIDERS[providerId];
    return { ok: false, reason: (p && p.describeError(err)) || err.message, ms: Date.now() - started };
  }
}

module.exports = { write, status, isCodeKind };
