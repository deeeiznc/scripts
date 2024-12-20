/**
 * AI 检测(适配 Surge/Loon 版)
 *
 * 适配 Sub-Store Node.js 版 请查看: https://t.me/zhetengsha/1209
 *
 * 欢迎加入 Telegram 群组 https://t.me/zhetengsha
 * 检测方法: https://zset.cc/archives/34/
 * 需求来源: @underHZLY
 * 讨论贴: https://www.nodeseek.com/post-78153-1
 *
 * 参数
 * - [timeout] 请求超时(单位: 毫秒) 默认 5000
 * - [retries] 重试次数 默认 1
 * - [retry_delay] 重试延时(单位: 毫秒) 默认 1000
 * - [concurrency] 并发数 默认 10
 * - [client] GPT 检测的客户端类型. 默认 iOS
 * - [method] 请求方法. 默认 get
 * - [cache] 使用缓存, 默认不使用缓存
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = $substore;
  const { isLoon, isSurge } = $.env;
  if (!isLoon && !isSurge) {
    throw new Error('仅支持 Loon 和 Surge(ability=http-client-policy)');
  }

  const cacheEnabled = $arguments.cache;
  const cache = scriptResourceCache;
  const method = $arguments.method || 'get';
  const client = $arguments.client === 'Android' ? 'Android' : 'iOS';
  const target = isLoon ? 'Loon' : isSurge ? 'Surge' : undefined;
  const concurrency = parseInt($arguments.concurrency || 10);

  const claude_url = 'https://claude.ai/new';
  const google_ai_url = 'https://aistudio.google.com/prompts/new_chat';

  const filteredProxies = proxies.filter(proxy =>
    ['🇭🇰', '香港', 'Hong', 'HK'].some(tag => proxy.name.includes(tag))
  );

  await executeAsyncTasks(
    filteredProxies.map(proxy => () => checkAI(proxy)),
    { concurrency }
  );

  return proxies;

  async function checkAI(proxy) {
    const id = cacheEnabled
      ? `ai:${client}:${JSON.stringify(
          Object.fromEntries(
            Object.entries(proxy).filter(([key]) => !/^(name|collectionName|subName|id|_.*)$/i.test(key))
          )
        )}`
      : undefined;

    try {
      const node = ProxyUtils.produce([proxy], target);
      if (node) {
        const cached = cache.get(id);
        if (cacheEnabled && cached && cached.ai) {
          $.info(`[${proxy.name}] 使用缓存 (AI)`);
          proxy.name = `[AI] ${proxy.name}`;
          return;
        }

        let openaiPassed = await checkOpenAI(proxy, node);
        if (!openaiPassed) {
          if (cacheEnabled) cache.set(id, { ai: false });
          return;
        }

        let googleAIPassed = await checkGoogleAI(proxy, node);
        if (!googleAIPassed) {
          if (cacheEnabled) cache.set(id, { ai: false });
          return;
        }

        let claudePassed = await checkClaude(proxy, node);
        if (!claudePassed) {
          if (cacheEnabled) cache.set(id, { ai: false });
          return;
        }

        proxy.name = `[AI] ${proxy.name}`;
        if (cacheEnabled) {
          $.info(`[${proxy.name}] AI 检测成功，设置缓存`);
          cache.set(id, { ai: true });
        }
      }
    } catch (e) {
      $.error(`[${proxy.name}] AI 检测失败: ${e.message ?? e}`);
      if (cacheEnabled) {
        cache.set(id, { ai: false });
      }
    }
  }

  async function checkOpenAI(proxy, node) {
    const startedAt = Date.now();
    const res = await http({
      method,
      headers: {
        'User-Agent':
          client === 'Android'
            ? 'Mozilla/5.0 (Linux; Android 10; KOR-L71 Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36 com.openai.chatgpt/1.2024.052.0'
            : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
      },
      url: client === 'Android' ? `https://android.chat.openai.com` : `https://ios.chat.openai.com`,
      'policy-descriptor': node,
      node,
    });
    const status = parseInt(res.status ?? res.statusCode ?? 200);
    let body = String(res.body ?? res.rawBody);
    try {
      body = JSON.parse(body);
    } catch (e) {}
    const msg = body?.error?.error_type || body?.cf_details;
    const latency = `${Date.now() - startedAt}`;
    $.info(`[${proxy.name}] OpenAI status: ${status}, msg: ${msg}, latency: ${latency}`);
    if (status === 403 && !['unsupported_country'].includes(msg)) {
      return true;
    }
    return false;
  }

  async function checkClaude(proxy, node) {
    const startedAt = Date.now();
    const res = await http({
      method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      url: claude_url,
      'policy-descriptor': node,
      node,
    });
    const status = parseInt(res.status ?? res.statusCode ?? 200);
    const latency = `${Date.now() - startedAt}`;
    $.info(`[${proxy.name}] Claude status: ${status}, latency: ${latency}`);
    const body = String(res.body ?? res.rawBody);
    return status >= 200 && status < 400 && !body.includes('unavailable-in-region');
  }

  async function checkGoogleAI(proxy, node) {
    const startedAt = Date.now();
    try {
      const res = await http({
        method: 'get',
        followRedirect: false,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
        url: google_ai_url,
        'policy-descriptor': node,
        node,
      });
      const status = parseInt(res.status ?? res.statusCode ?? 200);
      const latency = `${Date.now() - startedAt}`;
      $.info(`[${proxy.name}] Google AI status: ${status}, latency: ${latency}`);
      if (status >= 300 && status < 400 && res.headers?.Location === 'https://ai.google.dev/gemini-api/docs/available-regions') {
        return false;
      }
      return true;
    } catch (e) {
      $.error(`[${proxy.name}] Google AI check error: ${e.message ?? e}`);
      return false;
    }
  }

  // 请求
  async function http(opt = {}) {
    const METHOD = opt.method || 'get';
    const TIMEOUT = parseFloat(opt.timeout || $arguments.timeout || 5000);
    const RETRIES = parseFloat(opt.retries ?? $arguments.retries ?? 1);
    const RETRY_DELAY = parseFloat(opt.retry_delay ?? $arguments.retry_delay ?? 1000);

    let count = 0;
    const fn = async () => {
      try {
        return await $.http[METHOD]({ ...opt, timeout: TIMEOUT });
      } catch (e) {
        if (count < RETRIES) {
          count++;
          const delay = RETRY_DELAY * count;
          await $.wait(delay);
          return await fn();
        } else {
          throw e;
        }
      }
    };
    return await fn();
  }

  function executeAsyncTasks(tasks, { wrap, result, concurrency = 1 } = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let running = 0;
        const results = [];
        let index = 0;

        function executeNextTask() {
          while (index < tasks.length && running < concurrency) {
            const taskIndex = index++;
            const currentTask = tasks[taskIndex];
            running++;

            currentTask()
              .then(data => {
                if (result) {
                  results[taskIndex] = wrap ? { data } : data;
                }
              })
              .catch(error => {
                if (result) {
                  results[taskIndex] = wrap ? { error } : error;
                }
              })
              .finally(() => {
                running--;
                executeNextTask();
              });
          }

          if (running === 0) {
            resolve(result ? results : undefined);
          }
        }

        await executeNextTask();
      } catch (e) {
        reject(e);
      }
    });
  }
}
