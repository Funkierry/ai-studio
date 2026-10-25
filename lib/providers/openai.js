'use strict';
// GPT through the official OpenAI SDK (Responses API) with a strict JSON schema.
const sdk = require('openai');
const OpenAI = sdk.OpenAI || sdk.default || sdk;

const MODEL = process.env.STUDIO_OPENAI_MODEL || 'gpt-5';
// USD per million tokens, e.g. STUDIO_OPENAI_PRICE=1.25,10; unset means cost is not tracked
const PRICE = (process.env.STUDIO_OPENAI_PRICE || '').split(',').map(Number);

let client;
const getClient = () => (client ||= new OpenAI());

const status = () => ({
  name: 'GPT', model: MODEL, configured: Boolean(process.env.OPENAI_API_KEY),
  hint: process.env.OPENAI_API_KEY ? '已配置密钥' : '没有配置 OPENAI_API_KEY',
});

async function generate({ system, prompt, schema }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('没有配置 OPENAI_API_KEY');
  const r = await getClient().responses.create({
    model: MODEL,
    instructions: system,
    input: prompt,
    text: { format: { type: 'json_schema', name: 'deliverable', schema, strict: true } },
  });
  if (r.status === 'incomplete') throw new Error(`输出不完整：${r.incomplete_details?.reason || '未知原因'}`);
  const inTok = r.usage?.input_tokens || 0, outTok = r.usage?.output_tokens || 0;
  const usd = PRICE.length === 2 && PRICE.every(Number.isFinite) ? (inTok * PRICE[0] + outTok * PRICE[1]) / 1e6 : null;
  return { text: r.output_text, model: r.model || MODEL, input_tokens: inTok, output_tokens: outTok, usd };
}

function describeError(err) {
  if (err instanceof OpenAI.AuthenticationError) return 'OpenAI 密钥无效';
  if (err instanceof OpenAI.RateLimitError) return 'OpenAI 请求太频繁或额度不足';
  if (err instanceof OpenAI.APIError) return `OpenAI 接口出错（${err.status ?? '网络'}）：${err.message}`;
  return null;
}

module.exports = { status, generate, describeError };
