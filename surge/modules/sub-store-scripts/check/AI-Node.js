/**
 *
 * AI 检测(适配 Sub-Store Node.js 版)
 *
 * Surge/Loon 版 请查看: https://t.me/zhetengsha/1207
 *
 * 欢迎加入 Telegram 群组 https://t.me/zhetengsha
 *
 * HTTP META(https://github.com/xream/http-meta) 参数
 * - [http_meta_protocol] 协议 默认: http
 * - [http_meta_host] 服务地址 默认: 127.0.0.1
 * - [http_meta_port] 端口号 默认: 9876
 * - [http_meta_authorization] Authorization 默认无
 * - [http_meta_start_delay] 初始启动延时(单位: 毫秒) 默认: 3000
 * - [http_meta_proxy_timeout] 每个节点耗时(单位: 毫秒). 此参数是为了防止脚本异常退出未关闭核心. 设置过小将导致核心过早退出. 目前逻辑: 启动初始的延时 + 每个节点耗时. 默认: 10000
 *
 * 其它参数
 * - [timeout] 请求超时(单位: 毫秒) 默认 5000
 * - [retries] 重试次数 默认 1
 * - [retry_delay] 重试延时(单位: 毫秒) 默认 1000
 * - [concurrency] 并发数 默认 10
 * - [client] GPT 检测的客户端类型. 默认 iOS
 * - [method] 请求方法. 默认 get
 * - [cache] 使用缓存, 默认不使用缓存
 * 关于缓存时长
 * 当使用相关脚本时, 若在对应的脚本中使用参数开启缓存, 可设置持久化缓存 sub-store-csr-expiration-time 的值来自定义默认缓存时长, 默认为 172800000 (48 * 3600 * 1000, 即 48 小时)
 * 🎈Loon 可在插件中设置
 * 其他平台同理, 持久化缓存数据在 JSON 里
 */

async function operator(proxies = [], targetPlatform, context) {
  const cacheEnabled = $arguments.cache
  const cache = scriptResourceCache
  const http_meta_host = $arguments.http_meta_host ?? '127.0.0.1'
  const http_meta_port = $arguments.http_meta_port ?? 9876
  const http_meta_protocol = $arguments.http_meta_protocol ?? 'http'
  const http_meta_authorization = $arguments.http_meta_authorization ?? ''
  const http_meta_api = `${http_meta_protocol}://${http_meta_host}:${http_meta_port}`
  const http_meta_start_delay = parseFloat($arguments.http_meta_start_delay ?? 3000)
  const http_meta_proxy_timeout = parseFloat($arguments.http_meta_proxy_timeout ?? 10000)
  const method = $arguments.method || 'get'
  const openai_url = $arguments.client === 'Android' ? `https://android.chat.openai.com` : `https://ios.chat.openai.com`
  const claude_url = `https://claude.ai`
  const googleai_url = `https://aistudio.google.com`

  const $ = $substore
  const internalProxies = []
  proxies.map((proxy, index) => {
    try {
      
      if (!(proxy.name.includes("🇭🇰") || proxy.name.includes("香港") || proxy.name.includes("Hong") || proxy.name.includes("HK"))) {
        return;
      }

      const node = ProxyUtils.produce([{ ...proxy }], 'ClashMeta', 'internal')?.[0]
      if (node) {
        for (const key in proxy) {
          if (/^_/i.test(key)) {
            node[key] = proxy[key]
          }
        }
        // $.info(JSON.stringify(node, null, 2))
        internalProxies.push({ ...node, _proxies_index: index })
      }
    } catch (e) {
      $.error(e)
    }
  })
  // $.info(JSON.stringify(internalProxies, null, 2))
  $.info(`核心支持节点数: ${internalProxies.length}/${proxies.length}`)
  if (!internalProxies.length) return proxies

  if (cacheEnabled) {
    try {
      let allCached = true
      for (var i = 0; i < internalProxies.length; i++) {
        const proxy = internalProxies[i]
        const id = getCacheId({ proxy, openai_url, claude_url, googleai_url })
        const cached = cache.get(id)
        if (cached) {
          if (cached.ai) {
            proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
          }
        } else {
          allCached = false
          break
        }
      }
      if (allCached) {
        $.info('所有节点都有有效缓存 完成')
        return proxies
      }
    } catch (e) {}
  }

  const http_meta_timeout = http_meta_start_delay + internalProxies.length * http_meta_proxy_timeout

  let http_meta_pid
  let http_meta_ports = []
  // 启动 HTTP META
  const res = await http({
    retries: 0,
    method: 'post',
    url: `${http_meta_api}/start`,
    headers: {
      'Content-type': 'application/json',
      Authorization: http_meta_authorization,
    },
    body: JSON.stringify({
      proxies: internalProxies,
      timeout: http_meta_timeout,
    }),
  })
  let body = res.body
  try {
    body = JSON.parse(body)
  } catch (e) {}
  const { ports, pid } = body
  if (!pid || !ports) {
    throw new Error(`======== HTTP META 启动失败 ====
${body}`)
  }
  http_meta_pid = pid
  http_meta_ports = ports
  $.info(
    `
======== HTTP META 启动 ====
[端口] ${ports}
[PID] ${pid}
[超时] 若未手动关闭 ${
      Math.round(http_meta_timeout / 60 / 10) / 100
    } 分钟后自动关闭
`
  )
  $.info(`等待 ${http_meta_start_delay / 1000} 秒后开始检测`)
  await $.wait(http_meta_start_delay)

  const concurrency = parseInt($arguments.concurrency || 10) // 一组并发数
  await executeAsyncTasks(
    internalProxies.map(proxy => () => check(proxy)),
    { concurrency }
  )

  // const batches = []
  // for (let i = 0; i < internalProxies.length; i += concurrency) {
  //   const batch = internalProxies.slice(i, i + concurrency)
  //   batches.push(batch)
  // }
  // for (const batch of batches) {
  //   await Promise.all(batch.map(check))
  // }

  // stop http meta
  try {
    const res = await http({
      method: 'post',
      url: `${http_meta_api}/stop`,
      headers: {
        'Content-type': 'application/json',
        Authorization: http_meta_authorization,
      },
      body: JSON.stringify({
        pid: [http_meta_pid],
      }),
    })
    $.info(`
======== HTTP META 关闭 ====
${JSON.stringify(res, null, 2)}`)
  } catch (e) {
    $.error(e)
  }

  return proxies

  async function check(proxy) {
    const id = cacheEnabled ? getCacheId({ proxy, openai_url, claude_url, googleai_url }) : undefined
    try {
      const cached = cache.get(id)
      if (cacheEnabled && cached) {
        $.info(`[${proxy.name}] 使用缓存`)
        if (cached.ai) {
          proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
        }
        return
      }
      const index = internalProxies.indexOf(proxy)
      
      const googleAiStatus = await checkGoogleAI(proxy, http_meta_host, http_meta_ports[index]);
      if (!googleAiStatus) {
        if (cacheEnabled) {
          $.info(`[${proxy.name}] 设置失败缓存`)
          cache.set(id, {})
        }
        return;
      }
      const claudeStatus = await checkClaude(proxy, http_meta_host, http_meta_ports[index]);
      if (!claudeStatus) {
        if (cacheEnabled) {
          $.info(`[${proxy.name}] 设置失败缓存`)
          cache.set(id, {})
        }
        return;
      }
      
      const openaiStatus = await checkOpenAI(proxy, http_meta_host, http_meta_ports[index]);

      if (googleAiStatus && claudeStatus && openaiStatus) {
        proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
        if (cacheEnabled) {
          $.info(`[${proxy.name}] 设置成功缓存`)
          cache.set(id, { ai: true })
        }
      } else {
        if (cacheEnabled) {
          $.info(`[${proxy.name}] 设置失败缓存`)
          cache.set(id, {})
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

  async function checkOpenAI(proxy, http_meta_host, http_meta_port) {
    const startedAt = Date.now();
    const res = await http({
      proxy: `http://${http_meta_host}:${http_meta_port}`,
      method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
      },
      url: openai_url,
    })
    const status = parseInt(res.status || res.statusCode || 200)
      let body = String(res.body ?? res.rawBody)
      try {
        body = JSON.parse(body)
      } catch (e) {}
      const msg = body?.error?.error_type || body?.cf_details
      let latency = ''
      latency = `${Date.now() - startedAt}`
      $.info(`[${proxy.name}] OpenAI status: ${status}, msg: ${msg}, latency: ${latency}`)
      if (status == 403 && !['unsupported_country'].includes(msg)) {
        return true;
      } else {
        return false;
      }
  }

  async function checkClaude(proxy, http_meta_host, http_meta_port) {
    const startedAt = Date.now();
    const res = await http({
      proxy: `http://${http_meta_host}:${http_meta_port}`,
      method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
      },
      url: claude_url,
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

  async function checkGoogleAI(proxy, http_meta_host, http_meta_port) {
    const startedAt = Date.now();
    const res = await http({
      proxy: `http://${http_meta_host}:${http_meta_port}`,
      method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
      },
      url: googleai_url,
    })
    const status = parseInt(res.status ?? res.statusCode ?? 200);

    let body = String(res.body ?? res.rawBody)
    let latency = `${Date.now() - startedAt}`
    $.info(`[${proxy.name}] Google AI status: ${status}, latency: ${latency}`)
    if (status >= 200 && status < 400) {
      if (body.includes("available-regions")) {
        return false;
      }
      return true;
    } else {
      return false
    }
  }

  // 请求
  async function http(opt = {}) {
    const METHOD = opt.method || $arguments.method || 'get'
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
  function getCacheId({ proxy = {}, openai_url, claude_url, googleai_url }) {
    return `http-meta:ai:${openai_url}:${claude_url}:${googleai_url}:${JSON.stringify(
      Object.fromEntries(Object.entries(proxy).filter(([key]) => !/^(name|collectionName|subName|id|_.*)$/i.test(key)))
    )}`
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
