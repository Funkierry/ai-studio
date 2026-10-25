'use strict';
// DeepSeek through its OpenAI-compatible endpoint.
const { createCompatible } = require('./compatible');

module.exports = createCompatible({
  name: 'DeepSeek',
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  keyEnv: 'DEEPSEEK_API_KEY',
  model: 'deepseek-flash',
  modelEnv: 'STUDIO_DEEPSEEK_MODEL',
  maxTokens: 64000,
  // USD per million tokens at peak hours; off-peak is half, so this is an upper bound
  currency: 'USD',
  prices: {
    'deepseek-flash': { cachedInput: 0.006, input: 0.3, output: 1.2 },
    'deepseek-v4-pro': { cachedInput: 0.044, input: 1.32, output: 3.96 },
  },
});
