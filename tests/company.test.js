'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCompany } = require('../lib/company');
const G = require('../lib/git');

const author = { name: 'QA', email: 'qa@studio.local' };
const passing = "const test=require('node:test'); const assert=require('node:assert/strict'); test('works',()=>assert.equal(1+1,2));";
function fixture(t, files, failModel = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-regression-'));
  const co = createCompany(root, { writer: {
    status: () => ({ fake: true }),
    write: async () => failModel ? { ok: false, reason: 'Test provider unavailable' } : ({
      ok: true, data: { summary: 'QA', notes: '', files, document: 'QA' },
      meta: { model: 'fixture', input_tokens: 0, output_tokens: 0, cny: 0, ms: 0 },
    }),
  } });
  co.syncEmployees([{ id: 'qa', name: 'QA', model: 'fixture', profile: { type: 'deepseek' } }]);
  const p = co.launchProject({ name: 'Regression', roles: [{ name: '代码开发', out: '代码', who: 'qa', deps: [] }] });
  const dir = path.join(root, 'repos', p.slug);
  // Keep fixtures for failure diagnostics; no live company data is used.
  return { co, p, dir };
}

test('unfinished roles cannot be accepted', t => {
  const { co, p, dir } = fixture(t, {});
  assert.throws(() => co.projectReview(p.id, { stars: 3 }), /未完成/);
  assert.deepEqual(G.tags(dir), []);
});

test('failing integrated tests do not change main or publish a tag', async t => {
  const { co, p, dir } = fixture(t, { 'tests/fail.test.js': passing.replace('1+1,2', '1+1,3') });
  await co.roleDone(p.id, 0, {});
  const head = G.git(dir, ['rev-parse', 'main']);
  assert.throws(() => co.projectReview(p.id, { stars: 3 }), /集成测试未通过/);
  assert.equal(G.git(dir, ['rev-parse', 'main']), head);
  assert.deepEqual(G.tags(dir), []);
  assert.equal(co.state().projects[0].status, 'running');
});

for (const [name, files] of [
  ['missing tests', { 'README.md': 'No tests' }],
  ['all skipped tests', { 'tests/skip.test.js': "require('node:test')('skipped',{skip:true},()=>{});" }],
]) test(`${name} cannot be published`, async t => {
  const { co, p, dir } = fixture(t, files);
  await co.roleDone(p.id, 0, {});
  assert.throws(() => co.projectReview(p.id, { stars: 3 }), /集成测试未通过/);
  assert.deepEqual(G.tags(dir), []);
});

test('model fallback cannot be accepted as a real deliverable', async t => {
  const { co, p } = fixture(t, {}, true);
  await co.roleDone(p.id, 0, {});
  assert.throws(() => co.projectReview(p.id, { stars: 3 }), /生成失败/);
});

test('merge conflict leaves main and release tags unchanged', async t => {
  const { co, p, dir } = fixture(t, { 'README.md': 'Feature version', 'tests/ok.test.js': passing });
  await co.roleDone(p.id, 0, {});
  G.commit(dir, { files: { 'README.md': 'Independent main change' }, message: 'conflict fixture', author });
  const head = G.git(dir, ['rev-parse', 'main']);
  assert.throws(() => co.projectReview(p.id, { stars: 3 }), /合并冲突/);
  assert.equal(G.git(dir, ['rev-parse', 'main']), head);
  assert.deepEqual(G.tags(dir), []);
  assert.ok(!G.branches(dir).some(b => b.startsWith('verify/')));
});

test('successful acceptance is idempotent and runs the integrated tests', async t => {
  const { co, p, dir } = fixture(t, { 'tests/ok.test.js': passing });
  await co.roleDone(p.id, 0, {});
  const result = co.projectReview(p.id, { stars: 3 });
  assert.equal(result.artifacts.find(a => a.type === 'test').pass, 1);
  assert.equal(co.projectReview(p.id, { stars: 3 }).alreadyAccepted, true);
  assert.deepEqual(G.tags(dir), ['v1.0']);
  assert.equal(co.summary().deliverables, 1);
});
