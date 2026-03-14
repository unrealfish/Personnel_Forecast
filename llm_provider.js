(function(global) {
  const PROVIDERS = Object.freeze({
    minimax: 'minimax',
    aliyun: 'aliyun',
    ollama: 'ollama',
    openai_compatible: 'openai_compatible'
  });

  function normalizeBaseUrl(baseUrl, path) {
    const base = String(baseUrl || '').trim().replace(/\/$/, '');
    if (!base) return path;
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  function parseResponseText(data, provider) {
    if (!data || typeof data !== 'object') return null;
    if (provider === PROVIDERS.ollama) {
      return data.message?.content || data.response || null;
    }
    return data.choices?.[0]?.message?.content || data.reply || null;
  }

  function buildHeaders(provider, config = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = String(config.apiKey || '').trim();

    if (provider !== PROVIDERS.ollama && apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    if (config.extraHeaders && typeof config.extraHeaders === 'object') {
      Object.assign(headers, config.extraHeaders);
    }

    return headers;
  }

  function getDefaultConfig(provider = PROVIDERS.minimax) {
    switch (provider) {
      case PROVIDERS.aliyun:
        return {
          provider,
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen-plus',
          apiKey: '',
          temperature: 0.3
        };
      case PROVIDERS.ollama:
        return {
          provider,
          baseUrl: 'http://127.0.0.1:11434',
          model: 'qwen2.5:7b',
          apiKey: '',
          temperature: 0.3
        };
      case PROVIDERS.openai_compatible:
        return {
          provider,
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: '',
          temperature: 0.3
        };
      case PROVIDERS.minimax:
      default:
        return {
          provider: PROVIDERS.minimax,
          baseUrl: 'https://api.minimaxi.com',
          model: 'MiniMax-M2.5',
          apiKey: '',
          temperature: 0.3
        };
    }
  }

  function buildRequest(provider, config, messages, temperature) {
    if (provider === PROVIDERS.minimax) {
      return {
        url: normalizeBaseUrl(config.baseUrl, '/v1/text/chatcompletion_v2'),
        body: {
          model: config.model || 'MiniMax-M2.5',
          messages,
          temperature
        }
      };
    }

    if (provider === PROVIDERS.ollama) {
      return {
        url: normalizeBaseUrl(config.baseUrl, '/api/chat'),
        body: {
          model: config.model,
          messages,
          stream: false,
          options: { temperature }
        }
      };
    }

    return {
      url: normalizeBaseUrl(config.baseUrl, '/chat/completions'),
      body: {
        model: config.model,
        messages,
        temperature
      }
    };
  }

  async function chat(options = {}) {
    const provider = options.provider || PROVIDERS.minimax;
    const defaults = getDefaultConfig(provider);
    const config = { ...defaults, ...options };
    const systemPrompt = options.systemPrompt || '';
    const prompt = options.prompt || '';
    const temperature = Number(options.temperature ?? config.temperature ?? 0.3);

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const { url, body } = buildRequest(provider, config, messages, temperature);
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(provider, config),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    return parseResponseText(data, provider);
  }

  global.UnifiedLLMClient = {
    PROVIDERS,
    getDefaultConfig,
    chat
  };
})(window);
