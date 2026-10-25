'use strict';
// Coding agents already installed and logged in on this computer (Claude Code, Codex CLI).
// They run headless with the user's own account, so no API key is needed. Each call gets an empty
// scratch folder and read-only permissions: the agent only writes text back, it never touches files.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TIMEOUT = 20 * 60 * 1000;
const installed = {};
function isInstalled(cmd) {
  if (!(cmd in installed)) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    installed[cmd] = r.status === 0 ? (r.stdout || '').trim().split('\n')[0] : null;
  }
  return installed[cmd];
}

function run(cmd, args, input, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${cmd} 超过 ${TIMEOUT / 60000} 分钟没有完成`)); }, TIMEOUT);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(input);
  });
}
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-studio-'));
const cleanup = dir => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };

/* ---------- Claude Code ---------- */
const claudeCode = {
  status: () => {
    const v = isInstalled('claude');
    return { name: 'Claude Code（本机）', model: process.env.STUDIO_CLAUDE_CLI_MODEL || '你在 Claude Code 里的默认模型', configured: Boolean(v),
      hint: v ? `用你登录的 Claude Code 账号（${v}）` : '本机没有安装 Claude Code' };
  },
  async generate({ system, prompt, schema }) {
    const dir = scratch();
    try {
      const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--system-prompt', system,
        '--no-session-persistence', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task'];
      if (process.env.STUDIO_CLAUDE_CLI_MODEL) args.push('--model', process.env.STUDIO_CLAUDE_CLI_MODEL);
      const r = await run('claude', args, prompt, dir);
      let j;
      try { j = JSON.parse(r.out); } catch { throw new Error(`Claude Code 没有返回结果：${(r.err || r.out).trim().slice(0, 300)}`); }
      if (j.is_error) throw new Error(`Claude Code 出错：${String(j.result || j.subtype).slice(0, 300)}`);
      const data = j.structured_output ?? j.result;
      const u = j.usage || {};
      const models = Object.keys(j.modelUsage || {});
      return {
        text: typeof data === 'string' ? data : JSON.stringify(data),
        model: `${models[0] || 'claude'}（Claude Code）`,
        input_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        output_tokens: u.output_tokens || 0,
        // uses the user's own plan; the API-price equivalent is recorded for reference only
        usd: null, plan_usd: j.total_cost_usd ?? null,
      };
    } finally { cleanup(dir); }
  },
  describeError: err => (err.code === 'ENOENT' ? '本机没有安装 Claude Code' : null),
};

/* ---------- Codex CLI ---------- */
const codexCli = {
  status: () => {
    const v = isInstalled('codex');
    return { name: 'Codex（本机）', model: process.env.STUDIO_CODEX_MODEL || '你在 Codex 里的默认模型', configured: Boolean(v),
      hint: v ? `用你登录的 Codex 账号（${v}）` : '本机没有安装 Codex' };
  },
  async generate({ system, prompt, schema }) {
    const dir = scratch();
    try {
      const schemaFile = path.join(dir, 'schema.json'), last = path.join(dir, 'answer.json');
      fs.writeFileSync(schemaFile, JSON.stringify(schema));
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never',
        '--output-schema', schemaFile, '-o', last];
      if (process.env.STUDIO_CODEX_MODEL) args.push('-m', process.env.STUDIO_CODEX_MODEL);
      args.push('-');
      const r = await run('codex', args, `${system}\n\n${prompt}`, dir);
      const text = fs.existsSync(last) ? fs.readFileSync(last, 'utf8').trim() : '';
      if (!text) throw new Error(`Codex 没有返回结果：${r.err.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`);
      const model = (r.err.match(/^model:\s*(.+)$/m) || [])[1]?.trim();
      const used = +((r.err.match(/tokens used\s*\n?\s*([\d,]+)/i) || [])[1] || '0').replace(/,/g, '');
      return { text, model: `${model || 'codex'}（Codex）`, input_tokens: used, output_tokens: 0, usd: null };
    } finally { cleanup(dir); }
  },
  describeError: err => (err.code === 'ENOENT' ? '本机没有安装 Codex' : null),
};

module.exports = { claudeCode, codexCli };
