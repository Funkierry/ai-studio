'use strict';
// DeepSeek through its OpenAI-compatible endpoint (official OpenAI SDK with DeepSeek's base URL).
// JSON mode only guarantees valid JSON, not a schema, so the prompt carries an example and the writer validates the result.
const sdk = require('openai');
const OpenAI = sdk.OpenAI || sdk.default || sdk;

const MODEL = process.env.STUDIO_DEEPSEEK_MODEL || 'deepseek-flash';
// USD per million tokens at peak hours (cache hit, cache miss, output); off-peak is half, so this is an upper bound
const PRICES = { 'deepseek-flash': [0.006, 0.3, 1.2], 'deepseek-v4-pro': [0.044, 1.32, 3.96] };

let client;
const getClient = () => (client ||= new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  timeout: 20 * 60 * 1000,
}));

const status = () => ({
  name: 'DeepSeek', model: MODEL, configured: Boolean(process.env.DEEPSEEK_API_KEY),
  hint: process.env.DEEPSEEK_API_KEY ? '已配置密钥' : '没有配置 DEEPSEEK_API_KEY',
});

async function generate({ system, prompt, example }) {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('没有配置 DEEPSEEK_API_KEY');
  const request = {
    model: MODEL,
    max_tokens: 64000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `${system}\n\n只输出一个 json 对象，不要有任何其他文字。格式示例：\n${example}` },
      { role: 'user', content: prompt },
    ],
  };
  let r;
  // the API can occasionally return empty content; one retry covers that
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await getClient().chat.completions.create(request);
    if (r.choices?.[0]?.message?.content?.trim()) break;
  }
  const choice = r.choices?.[0];
  if (!choice?.message?.content?.trim()) throw new Error('DeepSeek 返回了空内容');
  if (choice.finish_reason === 'length') throw new Error('输出超过长度上限被截断');
  const u = r.usage || {};
  const hit = u.prompt_cache_hit_tokens || 0, miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens || 0) - hit);
  const [ph, pm, po] = PRICES[r.model] || PRICES[MODEL] || [];
  const usd = ph == null ? null : (hit * ph + miss * pm + (u.completion_tokens || 0) * po) / 1e6;
  return { text: choice.message.content, model: r.model || MODEL, input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0, usd };
}

function describeError(err) {
  if (err instanceof OpenAI.AuthenticationError) return 'DeepSeek 密钥无效';
  if (err instanceof OpenAI.RateLimitError) return 'DeepSeek 请求太频繁或余额不足';
  if (err instanceof OpenAI.APIError) return `DeepSeek 接口出错（${err.status ?? '网络'}）：${err.message}`;
  return null;
}

module.exports = { status, generate, describeError };
