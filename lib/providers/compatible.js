'use strict';
// Any OpenAI-compatible chat API (DeepSeek, Qwen, Kimi, GLM, a local model server…) through the official OpenAI SDK.
// JSON mode only promises valid JSON, not a schema, so the prompt carries an example and the writer validates the result.
const sdk = require('openai');
const OpenAI = sdk.OpenAI || sdk.default || sdk;

// cfg: { name, baseURL, keyEnv, model, modelEnv?, maxTokens?, json?: 'json_object' | 'none', noKey?,
//        currency: 'USD' | 'CNY', prices: { input, output, cachedInput? } or { [model]: {...} } per million tokens }
function createCompatible(cfg) {
  const model = () => (cfg.modelEnv && process.env[cfg.modelEnv]) || cfg.model;
  const key = () => process.env[cfg.keyEnv];
  let client;
  const getClient = () => (client ||= new OpenAI({ apiKey: key() || 'not-needed', baseURL: cfg.baseURL, timeout: 20 * 60 * 1000 }));

  const status = () => ({
    name: cfg.name, model: model(), configured: Boolean(key()) || Boolean(cfg.noKey),
    hint: key() || cfg.noKey ? '已配置' : `没有配置 ${cfg.keyEnv}`,
  });

  function priceOf(m) {
    const p = cfg.prices;
    if (!p) return null;
    return typeof p.input === 'number' ? p : p[m] || p[model()] || null;
  }

  async function generate({ system, prompt, example }) {
    if (!key() && !cfg.noKey) throw new Error(`没有配置 ${cfg.keyEnv}`);
    const request = {
      model: model(),
      max_tokens: cfg.maxTokens || 32000,
      messages: [
        { role: 'system', content: `${system}\n\n只输出一个 json 对象，不要有任何其他文字。格式示例：\n${example}` },
        { role: 'user', content: prompt },
      ],
    };
    if (cfg.json !== 'none') request.response_format = { type: 'json_object' };
    let r;
    // some of these APIs occasionally return empty content; one retry covers that
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await getClient().chat.completions.create(request);
      if (r.choices?.[0]?.message?.content?.trim()) break;
    }
    const choice = r.choices?.[0];
    if (!choice?.message?.content?.trim()) throw new Error(`${cfg.name} 返回了空内容`);
    if (choice.finish_reason === 'length') throw new Error('输出超过长度上限被截断');
    let text = choice.message.content.trim();
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenced) text = fenced[1];
    const u = r.usage || {};
    const inTok = u.prompt_tokens || 0, outTok = u.completion_tokens || 0;
    const hit = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
    const p = priceOf(r.model);
    const cost = p ? (hit * (p.cachedInput ?? p.input) + (inTok - hit) * p.input + outTok * p.output) / 1e6 : null;
    const usdCost = cfg.currency === 'CNY' ? undefined : cost;
    return { text, model: r.model || model(), input_tokens: inTok, output_tokens: outTok, usd: usdCost ?? null, cny: cfg.currency === 'CNY' ? cost : undefined };
  }

  function describeError(err) {
    if (err instanceof OpenAI.AuthenticationError) return `${cfg.name} 密钥无效`;
    if (err instanceof OpenAI.RateLimitError) return `${cfg.name} 请求太频繁或余额不足`;
    if (err instanceof OpenAI.APIError) return `${cfg.name} 接口出错（${err.status ?? '网络'}）：${err.message}`;
    return null;
  }

  return { status, generate, describeError };
}

module.exports = { createCompatible };
