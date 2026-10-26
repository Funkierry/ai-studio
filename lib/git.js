'use strict';
// Thin wrapper over the system git. Every repository the company owns goes through here.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const BASE = ['-c', 'user.name=AI 工作室', '-c', 'user.email=studio@ai-studio.local',
  '-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', '-c', 'advice.detachedHead=false'];

function git(cwd, args) {
  return execFileSync('git', [...BASE, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
}
function tryGit(cwd, args) {
  try { return { ok: true, out: git(cwd, args) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}

const isRepo = dir => fs.existsSync(path.join(dir, '.git'));
const sig = a => `${a.name} <${a.email}>`;

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (!isRepo(dir)) git(dir, ['init', '-q', '-b', 'main']);
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
}

const branchExists = (dir, b) => tryGit(dir, ['rev-parse', '--verify', '-q', `refs/heads/${b}`]).ok;

// Commit files onto a branch (created from main when it does not exist yet), then go back to main.
function commit(dir, { files, message, author, branch = 'main' }) {
  if (branch !== 'main') git(dir, branchExists(dir, branch) ? ['checkout', '-q', branch] : ['checkout', '-q', '-b', branch, 'main']);
  try {
    write(dir, files);
    git(dir, ['add', '-A']);
    if (!git(dir, ['status', '--porcelain'])) return { hash: git(dir, ['rev-parse', '--short', 'HEAD']), branch, empty: true };
    git(dir, ['commit', '-q', '-m', message, '--author', sig(author)]);
    return { hash: git(dir, ['rev-parse', '--short', 'HEAD']), branch };
  } finally {
    if (branch !== 'main') git(dir, ['checkout', '-q', 'main']);
  }
}

function merge(dir, branch, message) {
  git(dir, ['checkout', '-q', 'main']);
  const r = tryGit(dir, ['merge', '--no-ff', '-q', '-m', message, branch]);
  if (!r.ok) { tryGit(dir, ['merge', '--abort']); return { ok: false, out: r.out }; }
  return { ok: true, hash: git(dir, ['rev-parse', '--short', 'HEAD']) };
}

// Run a callback with a branch checked out (used to run tests on a branch).
function withBranch(dir, branch, fn) {
  git(dir, ['checkout', '-q', branch]);
  try { return fn(); } finally { git(dir, ['checkout', '-q', 'main']); }
}

// Validate the exact combined tree before changing main. Always discard the temporary ref.
function withIntegration(dir, branches, fn) {
  const branch = `verify/${randomUUID()}`;
  git(dir, ['checkout', '-q', '-b', branch, 'main']);
  try {
    for (const ref of branches) {
      const result = tryGit(dir, ['merge', '--no-ff', '-q', '-m', `集成验证：${ref}`, ref]);
      if (!result.ok) {
        tryGit(dir, ['merge', '--abort']);
        throw Object.assign(new Error(`分支 ${ref} 合并冲突，请修复后重试`), { status: 409 });
      }
    }
    return fn(branch);
  } finally {
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['branch', '-D', branch]);
  }
}

function log(dir, ref = 'main', file) {
  const args = ['log', ref, '-n', '300', '--date=format:%Y-%m-%d %H:%M', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s'];
  if (file) args.push('--', file);
  const r = tryGit(dir, args);
  if (!r.ok || !r.out) return [];
  return r.out.split('\n').map(l => { const [hash, author, date, subject] = l.split('\x1f'); return { hash, author, date, subject }; });
}
const lines = r => (r.ok && r.out ? r.out.split('\n') : []);
const branches = dir => lines(tryGit(dir, ['branch', '--format=%(refname:short)']));
const tags = dir => lines(tryGit(dir, ['tag', '--list']));
const tree = (dir, ref = 'main') => lines(tryGit(dir, ['ls-tree', '-r', '--name-only', ref]));
const show = (dir, ref, file) => git(dir, ['show', `${ref}:${file}`]);
function commitDetail(dir, hash) {
  const head = git(dir, ['show', '-s', '--date=format:%Y-%m-%d %H:%M', '--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%b', hash]).split('\x1f');
  let patch = git(dir, ['show', '--pretty=format:', '--patch', '--stat', hash]);
  if (patch.length > 200000) patch = patch.slice(0, 200000) + '\n…（内容过长，已截断）';
  return { hash: head[0], author: head[1], date: head[2], subject: head[3], body: head[4] || '', patch };
}
function tag(dir, name, message) {
  let n = name, i = 1;
  while (tags(dir).includes(n)) n = `${name}.${i++}`;
  git(dir, ['tag', '-a', n, '-m', message]);
  return n;
}

module.exports = { git, tryGit, init, commit, merge, withBranch, withIntegration, log, branches, tags, tree, show, commitDetail, tag, isRepo };
