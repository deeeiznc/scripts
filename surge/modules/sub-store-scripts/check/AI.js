/**
 * GPT 检测(适配 Surge/Loon 版)
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
  const $ = $substore
  const { isLoon, isSurge } = $.env
  if (!isLoon && !isSurge) throw new Error('仅支持 Loon 和 Surge(ability=http-client-policy)')
  const cacheEnabled = $arguments.cache
  const cache = scriptResourceCache
  const method = $arguments.method || 'get'
  const gpt_url = $arguments.client === 'Android' ? `https://android.chat.openai.com` : `https://ios.chat.openai.com`
  const aistudio_url = `https://aistudio.google.com`
  const claude_url = `https://claude.ai`
  const target = isLoon ? 'Loon' : isSurge ? 'Surge' : undefined
  const concurrency = parseInt($arguments.concurrency || 10) // 一组并发数
  await executeAsyncTasks(
    proxies.map(proxy => () => check(proxy)),
    { concurrency }
  )


  return proxies

  async function check(proxy) {
    const hkRegex = /🇭🇰|香港|Hong|HK/i
    if (!hkRegex.test(proxy.name)) {
      return
    }
    // $.info(`[${proxy.name}] 检测`)
    // $.info(`检测 ${JSON.stringify(proxy, null, 2)}`)
    const id = cacheEnabled
      ? `gpt:${gpt_url}:${aistudio_url}:${claude_url}:${JSON.stringify(
        Object.fromEntries(
          Object.entries(proxy).filter(([key]) => !/^(name|collectionName|subName|id|_.*)$/i.test(key))
        )
      )}`
      : undefined
    // $.info(`检测 ${id}`)
    try {
      const node = ProxyUtils.produce([proxy], target)
      if (node) {
        const cached = cache.get(id)
        if (cacheEnabled && cached) {
          $.info(`[${proxy.name}] 使用缓存`)
          if (cached.gpt) {
            proxy.name = `[AI] ${proxy.name}`
          }
          return
        }
        // 请求
        const gpt_status = await checkGpt(proxy, node);
        const aistudio_status = await checkAistudio(proxy, node);
        const claude_status = await checkClaude(proxy, node);
        if (gpt_status && aistudio_status && claude_status) {
          proxy.name = `[AI] ${proxy.name}`
          if (cacheEnabled) {
            $.info(`[${proxy.name}] 设置成功缓存`)
            cache.set(id, { gpt: true })
          }
        } else {
          if (cacheEnabled) {
            $.info(`[${proxy.name}] 设置失败缓存`)
            cache.set(id, {})
          }
        }
      }
    } catch (e) {
      $.error(`[${proxy.name}] ${e.message ?? e}`)
      if (cacheEnabled) {
        $.info(`[${proxy.name}] 设置失败缓存`)
        cache.set(id, {})
      }
    }
  }
  async function checkGpt(proxy, node) {
    const startedAt = Date.now();
    const res = await http({
      method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
      },
      url: gpt_url,
      'policy-descriptor': node,
      node,
    });
    const status = parseInt(res.status ?? res.statusCode ?? 200);
    let body = String(res.body ?? res.rawBody);
    try {
      body = JSON.parse(body);
    } catch (e) { }
    // $.info(`body ${JSON.stringify(body, null, 2)}`)
    const msg = body?.error?.error_type || body?.cf_details;
    let latency = `${Date.now() - startedAt}`;
    $.info(`[${proxy.name}] GPT status: ${status}, msg: ${msg}, latency: ${latency}`);
    // cf 拦截是 400 错误, 403 就是没被拦截, 走到了未鉴权的逻辑
    // https://zset.cc/archives/34/
    // 更新: 403 的时候, 还得看响应
    if (status == 403 && !['unsupported_country'].includes(msg)) {
      return true;

    } else {
      return false;
    }

  }
  async function checkAistudio(proxy, node) {
    const startedAt = Date.now()
    const res = await http({
      method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      url: aistudio_url,
      'policy-descriptor': node,
      node,
    })
    const status = parseInt(res.status ?? res.statusCode ?? 200);

    let body = String(res.body ?? res.rawBody)
    let latency = `${Date.now() - startedAt}`
    $.info(`[${proxy.name}] Aistudio status: ${status}, latency: ${latency}`)


    if (status >= 200 && status < 400) {

      return true;
    } else {
      return false
    }
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
    })
    const status = parseInt(res.status ?? res.statusCode ?? 200);

    let body = String(res.body ?? res.rawBody)
    let latency = `${Date.now() - startedAt}`
    $.info(`[${proxy.name}] Claude status: ${status}, latency: ${latency}`)
    if (status >= 200 && status < 400) {

      if (body.includes("unavailable-in-region")) {
        return false
      }
      return true;
    } else {
      return false
    }
  }
  // 请求
  async function http(opt = {}) {
    const METHOD = opt.method || 'get'
    const TIMEOUT = parseFloat(opt.timeout || $arguments.timeout || 5000)
    const RETRIES = parseFloat(opt.retries ?? $arguments.retries ?? 1)
    const RETRY_DELAY = parseFloat(opt.retry_delay ?? $arguments.retry_delay ?? 1000)

    let count = 0
    const fn = async () => {
      try {
        return await $.http[METHOD]({ ...opt, timeout: TIMEOUT })
      } catch (e) {
        // $.error(e)
        if (count < RETRIES) {
          count++
          const delay = RETRY_DELAY * count
          // $.info(`第 ${count} 次请求失败: ${e.message || e}, 等待 ${delay / 1000}s 后重试`)
          await $.wait(delay)
          return await fn()
        } else {
          throw e
        }
      }
    }
    return await fn()
  }
  function executeAsyncTasks(tasks, { wrap, result, concurrency = 1 } = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let running = 0
        const results = []

        let index = 0

        function executeNextTask() {
          while (index < tasks.length && running < concurrency) {
            const taskIndex = index++
            const currentTask = tasks[taskIndex]
            running++

            currentTask()
              .then(data => {
                if (result) {
                  results[taskIndex] = wrap ? { data } : data
                }
              })
              .catch(error => {
                if (result) {
                  results[taskIndex] = wrap ? { error } : error
                }
              })
              .finally(() => {
                running--
                executeNextTask()
              })
          }

          if (running === 0) {
            return resolve(result ? results : undefined)
          }
        }

        await executeNextTask()
      } catch (e) {
        reject(e)
      }
    })
  }
}
