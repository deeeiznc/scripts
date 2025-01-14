/**
 *
 * AI 检测(适配 Sub-Store Node.js 版)
 * 
 * 在使用时可加参数，例如:
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
 *
 * 
 * [AI] 检测逻辑:
 *  1) Google AI Check:  访问 https://aistudio.google.com 
 *     - 如果跳转至 https://ai.google.dev/gemini-api/docs/available-regions 则判定无法访问
 *  2) Claude Check:     访问 https://claude.ai
 *     - 如果跳转至 https://www.anthropic.com/app-unavailable-in-region?utm_source=country 则判定无法访问
 *  3) OpenAI Check:     访问 https://ios.chat.openai.com (或 https://android.chat.openai.com)
 *     - 原脚本逻辑: status=403 且返回体中不含 'unsupported_country' 时判定成功
 *
 * 如果全部成功, 则给节点名添加 `[AI] ` 前缀.
 * 仅对节点名包含 "🇭🇰", "香港", "Hong", "HK" 的节点执行检测.
 *
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

  // 访问的三个目标
  const googleAIURL = 'https://aistudio.google.com'
  const anthroURL = 'https://claude.ai'
  const openAIURL =
    $arguments.client === 'Android'
      ? `https://android.chat.openai.com`
      : `https://ios.chat.openai.com`

  const $ = $substore
  const internalProxies = []
  // 只对名字包含 🇭🇰 / 香港 / Hong / HK 的节点执行检测
  const targetKeywords = ['🇭🇰', '香港', 'Hong', 'HK']

  proxies.map((proxy, index) => {
    try {
      // 判断节点名是否符合关键词匹配
      if (!targetKeywords.some(k => proxy.name.includes(k))) {
        // 跳过不符合条件的节点
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

  $.info(`核心支持节点数: ${internalProxies.length}/${proxies.length}`)
  if (!internalProxies.length) return proxies

  if (cacheEnabled) {
    try {
      let allCached = true
      for (var i = 0; i < internalProxies.length; i++) {
        const proxy = internalProxies[i]
        const id = getCacheId({ proxy })
        const cached = cache.get(id)
        if (cached && cached.ai) {
          proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
        } else if (!cached) {
          allCached = false
          break
        }
      }
      if (allCached) {
        $.info('所有可检测节点都有有效缓存, 完成')
        return proxies
      }
    } catch (e) {
      $.error(e)
    }
  }

  const http_meta_timeout = http_meta_start_delay + internalProxies.length * http_meta_proxy_timeout
  let http_meta_pid
  let http_meta_ports = []

  // 启动 HTTP META
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
  $.info(`等待 ${http_meta_start_delay / 1000} 秒后开始检测...`)
  await $.wait(http_meta_start_delay)

  const concurrency = parseInt($arguments.concurrency || 10) // 一组并发数
  await executeAsyncTasks(
    internalProxies.map(proxy => () => doAllChecks(proxy)),
    { concurrency }
  )

  // stop http meta
  try {
    const stopRes = await http({
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
    $.info(`\n======== HTTP META 关闭 ====\n${JSON.stringify(stopRes, null, 2)}`)
  } catch (e) {
    $.error(e)
  }

  return proxies

  /**
   * 先后顺序:
   * 1) Google AI  => 若失败则不检测后续
   * 2) Claude(AI) => 若失败则不检测后续
   * 3) OpenAI     => 若失败则不加 [AI]
   */
  async function doAllChecks(proxy) {
    const id = cacheEnabled ? getCacheId({ proxy }) : null
    try {
      const cached = cache.get(id)
      if (cacheEnabled && cached) {
        // 缓存存在
        $.info(`[${proxy.name}] 使用缓存结果: ${JSON.stringify(cached)}`)
        if (cached.ai) {
          proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
        }
        return
      }

      // 如果没有缓存或缓存不完整, 重新检测
      const index = internalProxies.indexOf(proxy)
      const proxyURL = `http://${http_meta_host}:${http_meta_ports[index]}`

      const googleAI = await checkGoogleAI(proxyURL)
      if (!googleAI) {
        // 若失败
        updateCache(false)
        return
      }
      const anthro = await checkAnthro(proxyURL)
      if (!anthro) {
        updateCache(false)
        return
      }
      const openai = await checkOpenAI(proxyURL)
      if (!openai) {
        updateCache(false)
        return
      }

      // 全部成功 => 标记 [AI]
      proxies[proxy._proxies_index].name = `[AI] ${proxies[proxy._proxies_index].name}`
      updateCache(true)

      function updateCache(ok) {
        if (cacheEnabled) {
          $.info(`[${proxy.name}] 设置${ok ? '成功' : '失败'}缓存`)
          cache.set(id, { ai: ok })
        }
      }
    } catch (e) {
      $.error(`[${proxy.name}] 检测出现错误: ${e.message ?? e}`)
      if (cacheEnabled && id) {
        cache.set(id, { ai: false })
      }
    }
  }

  async function checkGoogleAI(proxyURL) {
    try {
      const res = await http({
        proxy: proxyURL,
        method,
        url: googleAIURL,
      })
      const status = parseInt(res.status || res.statusCode || 200)
      const finalLocation = res.headers?.location || ''
      $.info(`[Google AI] ${googleAIURL} => status: ${status}, location: ${finalLocation}`)
      // 如果重定向到不可用地区说明失败
      if (finalLocation.startsWith('https://ai.google.dev/gemini-api/docs/available-regions')) {
        return false
      }
      // 只要没跳到限制页面，就视为成功
      return true
    } catch (e) {
      $.error(`[Google AI] 检测异常: ${e.message ?? e}`)
      return false
    }
  }

  async function checkAnthro(proxyURL) {
    try {
      const res = await http({
        proxy: proxyURL,
        method,
        url: anthroURL,
        // Claude 有时需要 UA，否则可能 403
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
        },
      })
      const status = parseInt(res.status || res.statusCode || 200)
      const finalLocation = res.headers?.location || ''
      $.info(`[Claude AI] ${anthroURL} => status: ${status}, location: ${finalLocation}`)
      // 如果重定向到 app-unavailable 则失败
      if (finalLocation.startsWith('https://www.anthropic.com/app-unavailable-in-region?utm_source=country')) {
        return false
      }
      // 同理，只要没跳到限制页面，就视为成功
      return true
    } catch (e) {
      $.error(`[Claude AI] 检测异常: ${e.message ?? e}`)
      return false
    }
  }

  async function checkOpenAI(proxyURL) {
    try {
      const startedAt = Date.now()
      const res = await http({
        proxy: proxyURL,
        method,
        url: openAIURL,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
        },
      })
      const status = parseInt(res.status || res.statusCode || 200)
      let body = String(res.body ?? res.rawBody)
      try {
        body = JSON.parse(body)
      } catch (e) {}
      const msg = body?.error?.error_type || body?.cf_details
      const latency = Date.now() - startedAt
      $.info(`[OpenAI] => status: ${status}, msg: ${msg || ''}, latency: ${latency}ms`)

      // 原有逻辑: cf拦截时返回 status=400, 403说明不在支持地区或没鉴权？
      // 最终判断: status == 403 && msg != 'unsupported_country' => 视为成功
      if (status === 403 && !['unsupported_country'].includes(msg)) {
        return true
      }
      // 其他情况视为失败
      return false
    } catch (e) {
      $.error(`[OpenAI] 检测异常: ${e.message ?? e}`)
      return false
    }
  }

  // =========== 基础函数 =============

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
          const delay = RETRY_DELAY * count
          $.info(`第 ${count} 次请求失败: ${e.message || e}, 等待 ${delay / 1000}s 后重试`)
          await $.wait(delay)
          return await fn()
        } else {
          throw e
        }
      }
    }
    return fn()
  }

  function getCacheId({ proxy = {} }) {
    // 注意: 去掉了对 url 的区分, 因为我们要对同一个节点做三次检测.
    // 这里可仅以节点信息作为 CacheKey, 或者进一步分开.
    return `http-meta:ai-check:${JSON.stringify(
      Object.fromEntries(
        Object.entries(proxy).filter(([key]) => !/^(name|collectionName|subName|id|_.*)$/i.test(key))
      )
    )}`
  }

  function executeAsyncTasks(tasks, { wrap, result, concurrency = 1 } = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let running = 0
        const results = []
        let index = 0

        async function executeNextTask() {
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
