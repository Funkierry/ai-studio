'use strict';
// Claude through the official Anthropic SDK: structured JSON output, streamed to the final message.
const sdk = require('@anthropic-ai/sdk');
const Anthropic = sdk.Anthropic || sdk.default || sdk;

const MODEL = process.env.STUDIO_CLAUDE_MODEL || 'claude-opus-5-5';
// USD per million tokens (input, output) from the published price list
const PRICES = {
  'claude-fable-5-1': [10, 50], 'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25],
  'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
};

let client;
const getClient = () => (client ||= new Anthropic());

// An unset ANTHROPIC_API_KEY doesn't rule out a login profile, so this is a hint, not a gate.
const status = () => ({
  name: 'Claude', model: MODEL,
  configured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  hint: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? '已配置密钥' : '没检测到 ANTHROPIC_API_KEY（用 ant auth login 登录过也能用）',
});

async function generate({ system, prompt, schema, effort }) {
  const params = {
    model: MODEL,
    max_tokens: 64000,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  let message;
  try {
    // A safety decline is re-run on Anthropic's recommended fallback model instead of failing the hand-over.
    message = await getClient().beta.messages
      .stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      .finalMessage();
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message))) throw err;
    message = await getClient().messages.stream(params).finalMessage();
  }
  if (message.stop_reason === 'refusal') {
    throw new Error(`模型拒绝了这个请求${message.stop_details?.category ? `（${message.stop_details.category}）` : ''}`);
  }
  if (message.stop_reason === 'max_tokens') throw new Error('输出超过长度上限被截断');
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const [pin, pout] = PRICES[message.model] || PRICES[MODEL] || [0, 0];
  const { input_tokens: inTok = 0, output_tokens: outTok = 0 } = message.usage || {};
  return { text, model: message.model, input_tokens: inTok, output_tokens: outTok, usd: (inTok * pin + outTok * pout) / 1e6 };
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude 密钥无效或没有配置';
  if (err instanceof Anthropic.RateLimitError) return 'Claude 请求太频繁，被限流了';
  if (err instanceof Anthropic.APIError) return `Claude 接口出错（${err.status ?? '网络'}）：${err.message}`;
  if (err instanceof Anthropic.AnthropicError && /authentication method/i.test(err.message)) return '没有 Claude 的凭据：在 .env 里填 ANTHROPIC_API_KEY，或者先运行 ant auth login';
  return null;
}

module.exports = { status, generate, describeError };
