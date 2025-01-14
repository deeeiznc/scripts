/**
 *
 * AI 检测(适配 Sub-Store Node.js 版)
 *
 * 注意:
 * 1) 仅在节点名称包含以下字符串时检测: 🇭🇰, 香港, Hong, HK
 * 2) 完整通过 Google AI、Anthropic、OpenAI 检测后, 才会在节点名前添加 [AI]
 *
 * 使用参数示例:
 * https://raw.githubusercontent.com/deeeiznc/scripts/main/surge/modules/sub-store-scripts/check/AI.js#timeout=1000&retries=1&retry_delay=1000&concurrency=10&client=iOS
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
 * - [http_meta_proxy_timeout] 每个节点耗时(单位: 毫秒). 此参数是为了防止脚本异常退出未关闭核心.
 *   设置过小将导致核心过早退出. 目前逻辑: 启动初始的延时 + 每个节点耗时. 默认: 10000
 *
 * 其它参数
 * - [timeout] 请求超时(单位: 毫秒) 默认 5000
 * - [retries] 重试次数 默认 1
 * - [retry_delay] 重试延时(单位: 毫秒) 默认 1000
 * - [concurrency] 并发数 默认 10
 * - [client] OpenAI 检测的客户端类型. 默认 iOS
 * - [method] 请求方法. 默认 get
 * - [cache] 是否使用缓存, 默认不使用
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
  // 原脚本中: client===Android => https://android.chat.openai.com, 否则 => https://ios.chat.openai.com
  // 这里作为 OpenAI 检测地址
  const openai_url =
    $arguments.client === 'Android'
      ? 'https://android.chat.openai.com'
      : 'https://ios.chat.openai.com'

  // Google AI 检测地址
  const google_url = 'https://aistudio.google.com'
  // Anthropic (Claude) 检测地址
  const anthropic_url = 'https://claude.ai'

  const $ = $substore
  const internalProxies = []

  // 仅保留可用的 ClashMeta 方式节点
  proxies.map((proxy, index) => {
    try {
      // 只检测名字中包含 🇭🇰、香港、Hong、HK 的节点
      if (!isHKNode(proxy.name)) {
        return
      }
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

  $.info(`核心支持节点数(匹配 🇭🇰/香港/Hong/HK): ${internalProxies.length}/${proxies.length}`)
  if (!internalProxies.length) return proxies

  // 若启用缓存, 检查是否全部都有缓存
  if (cacheEnabled) {
    try {
      let allCached = true
      for (let i = 0; i < internalProxies.length; i++) {
        const proxy = internalProxies[i]
        const id = getCacheId(proxy)
        const cached = cache.get(id)
        if (cached && cached.ai) {
          // 通过 AI 检测
          proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
        } else if (!cached) {
          // 缓存中无记录
          allCached = false
          break
        }
      }
      if (allCached) {
        $.info('所有匹配节点都有有效缓存，检测完成')
        return proxies
      }
    } catch (e) {
      $.info(`cache check error: ${e}`)
    }
  }

  // 启动 HTTP META
  const http_meta_timeout = http_meta_start_delay + internalProxies.length * http_meta_proxy_timeout
  let http_meta_pid
  let http_meta_ports = []
  const resStart = await http({
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

  let body = resStart.body
  try {
    body = JSON.parse(body)
  } catch (e) {}
  const { ports, pid } = body
  if (!pid || !ports) {
    throw new Error(`======== HTTP META 启动失败 ====\n${body}`)
  }
  http_meta_pid = pid
  http_meta_ports = ports

  $.info(
    `\n======== HTTP META 启动 ====\n[端口] ${ports}\n[PID] ${pid}\n[超时] ${
      Math.round(http_meta_timeout / 6000) / 10
    } 分钟后自动关闭\n`
  )
  $.info(`等待 ${http_meta_start_delay / 1000} 秒后开始检测`)
  await $.wait(http_meta_start_delay)

  // 并发检测
  const concurrency = parseInt($arguments.concurrency || 10)
  await executeAsyncTasks(
    internalProxies.map(proxy => () => checkAllAI(proxy)),
    { concurrency }
  )

  // 关闭 HTTP META
  try {
    const resStop = await http({
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
    $.info(`\n======== HTTP META 关闭 ====\n${JSON.stringify(resStop, null, 2)}`)
  } catch (e) {
    $.error(e)
  }

  return proxies

  /**
   * 顺序检测：Google AI -> Anthropic -> OpenAI
   * 全部通过后 => [AI]
   */
  async function checkAllAI(proxy) {
    const id = cacheEnabled ? getCacheId(proxy) : null
    try {
      if (cacheEnabled) {
        const cached = cache.get(id)
        if (cached && cached.ai) {
          // 缓存已有, 无需重新检测
          $.info(`[${proxy.name}] 使用缓存通过: AI`)
          proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
          return
        }
      }

      // 顺序检测
      const googlePass = await checkGoogleAI(proxy)
      if (!googlePass) {
        setFailCache(id)
        return
      }
      const anthropicPass = await checkAnthropic(proxy)
      if (!anthropicPass) {
        setFailCache(id)
        return
      }
      const openAIPass = await checkOpenAI(proxy)
      if (!openAIPass) {
        setFailCache(id)
        return
      }

      // 全部通过 => [AI] 标记
      proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
      if (cacheEnabled) {
        $.info(`[${proxy.name}] 设置成功缓存 (AI)`)
        cache.set(id, { ai: true })
      }
    } catch (err) {
      $.error(`[${proxy.name}] ${err.message ?? err}`)
      setFailCache(id)
    }

    function setFailCache(cacheId) {
      if (cacheEnabled && cacheId) {
        cache.set(cacheId, {})
      }
    }
  }

  /**
   * Google AI 检测
   * 若返回的 headers.location === 'https://ai.google.dev/gemini-api/docs/available-regions'，判定为失败
   */
  async function checkGoogleAI(proxy) {
    const { status, headers } = await requestThroughProxy(proxy, google_url)
    const loc = headers?.location || ''
    // 如果出现 301/302 并且跳转到 restricted url，则失败
    if ((status === 301 || status === 302) && loc.includes('ai.google.dev/gemini-api/docs/available-regions')) {
      $.info(`[${proxy.name}] Google AI 检测 -> FAIL (Region Restricted)`)
      return false
    }
    $.info(`[${proxy.name}] Google AI 检测 -> PASS`)
    return true
  }

  /**
   * Anthropic 检测 (Claude)
   * 若返回的 headers.location === 'https://www.anthropic.com/app-unavailable-in-region?utm_source=country'，判定为失败
   */
  async function checkAnthropic(proxy) {
    const { status, headers } = await requestThroughProxy(proxy, anthropic_url)
    const loc = headers?.location || ''
    if ((status === 301 || status === 302) && loc.includes('anthropic.com/app-unavailable-in-region?utm_source=country')) {
      $.info(`[${proxy.name}] Claude (Anthropic) 检测 -> FAIL (Region Restricted)`)
      return false
    }
    $.info(`[${proxy.name}] Claude (Anthropic) 检测 -> PASS`)
    return true
  }

  /**
   * OpenAI 检测 (原脚本的做法)
   * 以403并且非 unsupported_country 为通过
   */
  async function checkOpenAI(proxy) {
    const { status, body } = await requestThroughProxy(proxy, openai_url)
    let msg = ''
    try {
      const parsed = JSON.parse(body)
      msg = parsed?.error?.error_type || parsed?.cf_details
    } catch (e) {
      // ignore
    }
    // 当 status=403 且 msg != 'unsupported_country' => 通过
    if (status === 403 && msg !== 'unsupported_country') {
      $.info(`[${proxy.name}] OpenAI 检测 -> PASS`)
      return true
    }
    $.info(`[${proxy.name}] OpenAI 检测 -> FAIL`)
    return false
  }

  // 判断节点名是否含有 🇭🇰/香港/Hong/HK
  function isHKNode(name) {
    return /🇭🇰|香港|Hong|HK/i.test(name)
  }

  // 获取缓存ID
  function getCacheId(proxy) {
    const relevantProxyFields = Object.fromEntries(
      Object.entries(proxy).filter(([key]) => !/^(name|collectionName|subName|id|_.*)$/i.test(key))
    )
    return `http-meta:ai-detect:${JSON.stringify(relevantProxyFields)}`
  }

  // 发起请求的通用函数
  async function requestThroughProxy(proxy, url) {
    const index = internalProxies.indexOf(proxy)
    const startedAt = Date.now()
    const TIMEOUT = parseFloat($arguments.timeout || 5000)

    // 每个检测都可按需 retry，这里复用主脚本的 retry 参数
    const RETRIES = parseInt($arguments.retries ?? 1)
    const RETRY_DELAY = parseInt($arguments.retry_delay ?? 1000)

    let count = 0
    async function doRequest() {
      try {
        const res = await $.http[method]({
          proxy: `http://${http_meta_host}:${http_meta_ports[index]}`,
          timeout: TIMEOUT,
          url,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
          },
        })
        return res
      } catch (e) {
        if (count < RETRIES) {
          count++
          $.info(`第 ${count} 次请求失败: ${e.message || e}, 等待 ${RETRY_DELAY}ms 后重试`)
          await $.wait(RETRY_DELAY)
          return doRequest()
        } else {
          throw e
        }
      }
    }

    const res = await doRequest()
    const latency = Date.now() - startedAt
    $.info(`[${proxy.name}] 请求 ${url} -> status:${res.status}, latency:${latency}ms`)
    return { status: parseInt(res.status ?? res.statusCode ?? 200), headers: res.headers ?? {}, body: String(res.body ?? '') }
  }

  // 并发调度
  async function executeAsyncTasks(tasks, { concurrency = 1 } = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let running = 0
        let index = 0

        async function executeNextTask() {
          while (index < tasks.length && running < concurrency) {
            const taskIndex = index++
            const task = tasks[taskIndex]
            running++
            task()
              .finally(() => {
                running--
                executeNextTask()
              })
          }

          if (running === 0 && index >= tasks.length) {
            resolve()
          }
        }

        await executeNextTask()
      } catch (err) {
        reject(err)
      }
    })
  }

  // 简化的 http 帮助函数
  async function http(opt = {}) {
    const METHOD = opt.method || $arguments.method || 'get'
    const TIMEOUT = parseFloat(opt.timeout || $arguments.timeout || 5000)
    const RETRIES = parseFloat(opt.retries ?? $arguments.retries ?? 1)
    const RETRY_DELAY = parseFloat(opt.retry_delay ?? $arguments.retry_delay ?? 1000)

    let count = 0
    async function fn() {
      try {
        return await $.http[METHOD]({ ...opt, timeout: TIMEOUT })
      } catch (e) {
        if (count < RETRIES) {
          count++
          $.info(`第 ${count} 次请求失败: ${e.message || e}, 等待 ${RETRY_DELAY}ms 后重试`)
          await $.wait(RETRY_DELAY)
          return fn()
        } else {
          throw e
        }
      }
    }
    return fn()
  }
}
