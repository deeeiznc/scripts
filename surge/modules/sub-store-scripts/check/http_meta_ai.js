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
 * - [client] AI 检测的客户端类型. 默认 iOS
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

  // OpenAI default URL (last check)
  const openaiUrl = $arguments.client === 'Android'
    ? `https://android.chat.openai.com`
    : `https://ios.chat.openai.com`

  const googleAiUrl = `https://aistudio.google.com`
  const anthropicUrl = `https://claude.ai`

  const $ = $substore
  const internalProxies = []

  // Filter and convert proxies
  proxies.map((proxy, index) => {
    try {
      const node = ProxyUtils.produce([{ ...proxy }], 'ClashMeta', 'internal')?.[0]
      if (node) {
        for (const key in proxy) {
          if (/^_/i.test(key)) {
            node[key] = proxy[key]
          }
        }
        internalProxies.push({ ...node, _proxies_index: index })
      }
    } catch (e) {
      $.error(e)
    }
  })

  $.info(`核心支持节点数: ${internalProxies.length}/${proxies.length}`)
  if (!internalProxies.length) return proxies

  // If using cache, check first
  if (cacheEnabled) {
    try {
      let allCached = true
      for (let i = 0; i < internalProxies.length; i++) {
        const proxy = internalProxies[i]
        const id = getCacheId({ proxy })
        const cached = cache.get(id)
        if (cached && cached.ai) {
          // Already identified as AI
          proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
        } else if (cached) {
          // Cached, but no AI
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

  // Start HTTP META
  const http_meta_timeout = http_meta_start_delay + internalProxies.length * http_meta_proxy_timeout
  let http_meta_pid
  let http_meta_ports = []

  const startRes = await http({
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

  let startBody = startRes.body
  try {
    startBody = JSON.parse(startBody)
  } catch (e) {}

  const { ports, pid } = startBody
  if (!pid || !ports) {
    throw new Error(`======== HTTP META 启动失败 ====\n${startBody}`)
  }
  http_meta_pid = pid
  http_meta_ports = ports

  $.info(
    `\n======== HTTP META 启动 ====\n[端口] ${ports}\n[PID] ${pid}\n[超时] 若未手动关闭 ${
      Math.round(http_meta_timeout / 60 / 10) / 100
    } 分钟后自动关闭\n`
  )
  $.info(`等待 ${http_meta_start_delay / 1000} 秒后开始检测`)
  await $.wait(http_meta_start_delay)

  // Perform checks concurrently
  const concurrency = parseInt($arguments.concurrency || 10)
  await executeAsyncTasks(
    internalProxies.map(proxy => () => check(proxy)),
    { concurrency }
  )

  // Stop HTTP META
  try {
    const stopRes = await http({
      method: 'post',
      url: `${http_meta_api}/stop`,
      headers: {
        'Content-type': 'application/json',
        Authorization: http_meta_authorization,
      },
      body: JSON.stringify({ pid: [http_meta_pid] }),
    })
    $.info(`\n======== HTTP META 关闭 ====\n${JSON.stringify(stopRes, null, 2)}`)
  } catch (e) {
    $.error(e)
  }

  return proxies

  /**
   * Checks if the proxy can pass Google AI -> Anthropic -> OpenAI
   * If all pass, rename node to [AI].
   */
  async function check(proxy) {
    // Only detect if name contains 🇭🇰, 香港, Hong, HK
    const doDetection = /🇭🇰|香港|Hong|HK/i.test(proxy.name)
    if (!doDetection) {
      return
    }

    const id = cacheEnabled ? getCacheId({ proxy }) : null
    try {
      // If cached
      const cached = cacheEnabled ? cache.get(id) : null
      if (cached) {
        // Use cache
        $.info(`[${proxy.name}] 使用缓存`)
        if (cached.ai) {
          proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
        }
        return
      }

      const index = internalProxies.indexOf(proxy)
      const finalProxy = `http://${http_meta_host}:${http_meta_ports[index]}`

      // 1. Google AI check
      const googlePassed = await checkGoogleAI(finalProxy)
      if (!googlePassed) {
        $.info(`[${proxy.name}] Google AI 检测失败`)
        if (cacheEnabled) cache.set(id, {})
        return
      }

      // 2. Anthropic (Claude) check
      const anthropicPassed = await checkAnthropic(finalProxy)
      if (!anthropicPassed) {
        $.info(`[${proxy.name}] Anthropic 检测失败`)
        if (cacheEnabled) cache.set(id, {})
        return
      }

      // 3. OpenAI check (existing logic)
      const openaiPassed = await checkOpenAI(finalProxy)
      if (!openaiPassed) {
        $.info(`[${proxy.name}] OpenAI 检测失败`)
        if (cacheEnabled) cache.set(id, {})
        return
      }

      // If all checks pass, rename to [AI]
      proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
      if (cacheEnabled) {
        $.info(`[${proxy.name}] 设置成功缓存 (AI)`)
        cache.set(id, { ai: true })
      }
    } catch (e) {
      $.error(`[${proxy.name}] ${e.message ?? e}`)
      if (cacheEnabled) cache.set(id, {})
    }
  }

  /**
   * Google AI Check:
   * - Request https://aistudio.google.com
   * - Failure if it redirects to https://ai.google.dev/gemini-api/docs/available-regions
   */
  async function checkGoogleAI(proxyUrl) {
    try {
      const res = await http({
        proxy: proxyUrl,
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        },
        url: googleAiUrl,
        // We might rely on the "Location" header if there's a redirect
        // or if status is 30x with location
        allowRedirects: false,
      })

      // If we see a 30x with "location" we check if it is the blocked URL
      const status = parseInt(res.status || res.statusCode || 200)
      const location = res.headers?.location || ''
      if ((status >= 300 && status < 400) && location.includes('ai.google.dev/gemini-api/docs/available-regions')) {
        return false
      }
      // If it tries to do an immediate redirect and the final location is that region block
      // some platforms might auto-follow
      const finalUrl = res.responseUrl || ''
      if (finalUrl.includes('ai.google.dev/gemini-api/docs/available-regions')) {
        return false
      }
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * Anthropic (Claude) Check:
   * - Request https://claude.ai
   * - Failure if it redirects to https://www.anthropic.com/app-unavailable-in-region?utm_source=country
   */
  async function checkAnthropic(proxyUrl) {
    try {
      const res = await http({
        proxy: proxyUrl,
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        },
        url: anthropicUrl,
        allowRedirects: false,
      })

      const status = parseInt(res.status || res.statusCode || 200)
      const location = res.headers?.location || ''
      if (
        (status >= 300 && status < 400) &&
        location.includes('www.anthropic.com/app-unavailable-in-region?utm_source=country')
      ) {
        return false
      }
      const finalUrl = res.responseUrl || ''
      if (finalUrl.includes('www.anthropic.com/app-unavailable-in-region?utm_source=country')) {
        return false
      }
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * OpenAI Check (existing logic):
   * - If status == 403 and msg != 'unsupported_country' => pass
   * - Otherwise fail
   */
  async function checkOpenAI(proxyUrl) {
    let pass = false
    try {
      const startedAt = Date.now()
      const res = await http({
        proxy: proxyUrl,
        method,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        },
        url: openaiUrl,
      })

      const status = parseInt(res.status || res.statusCode || 200)
      let body = String(res.body ?? res.rawBody)
      try {
        body = JSON.parse(body)
      } catch (e) {}
      const msg = body?.error?.error_type || body?.cf_details
      const latency = `${Date.now() - startedAt}`
      // Cloudflare intercept 400, or 403 => region check
      // if 403 and msg != 'unsupported_country', then pass
      if (status === 403 && !['unsupported_country'].includes(msg)) {
        pass = true
      }
      $.info(`OpenAI -> status: ${status}, msg: ${msg}, latency: ${latency}, pass: ${pass}`)
    } catch (e) {
      $.error(`OpenAI 检测错误: ${e.message ?? e}`)
    }
    return pass
  }

  // Universal HTTP request with retries
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
        if (count < RETRIES) {
          count++
          const delay = RETRY_DELAY * count
          await $.wait(delay)
          return await fn()
        } else {
          throw e
        }
      }
    }
    return await fn()
  }

  // For caching
  function getCacheId({ proxy = {} }) {
    return `http-meta:ai:${JSON.stringify(
      Object.fromEntries(Object.entries(proxy).filter(([key]) => !/^(name|collectionName|subName|id|_.*)$/i.test(key)))
    )}`
  }

  // Async concurrency
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