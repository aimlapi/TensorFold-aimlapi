import { readBoundedResponseText } from './bounded-response'
import { assertFetchableUrl, safePublicWebUrl } from './tool-web'
import type { ToolContext, ToolResult } from './tools'

const RUN_ENDPOINT = 'https://tools.aimlapi.com/v1/tools/run'
const SEARCH_TOOL = 'litescrape/duckduckgo-search'
const FETCH_TOOL = 'litescrape/web-fetch'
const USER_AGENT = 'TensorFold/1.0 (+https://github.com/ashhart/TensorFold)'
const TIMEOUT_MS = 60_000
const RESPONSE_LIMIT = 2 * 1024 * 1024
const SNIPPET_CHARS = 2000

function aimlapiKey(ctx: ToolContext): string {
  const key = (ctx.aimlapiApiKey?.() ?? '').trim()
  if (!key) throw new Error('AI/ML API web tools need an API key: add it to the AI/ML API provider in Settings → Providers.')
  return key
}

async function runAimlapiTool(tool: string, input: object, key: string, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason)
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('AI/ML API request timed out.')), TIMEOUT_MS)
  try {
    // The key is bound to the fixed tools.aimlapi.com URL; redirects are refused so it never reaches another host.
    const response = await fetch(RUN_ENDPOINT, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ tool, input }),
    })
    const text = await readBoundedResponseText(response, 'AI/ML API', RESPONSE_LIMIT)
    if (!response.ok) throw new Error(`AI/ML API request failed: HTTP ${response.status}${response.status === 401 ? ' (check the API key)' : response.status === 402 ? ' (insufficient balance)' : response.status === 429 ? ' (rate limit reached)' : ''}.`)
    const run = JSON.parse(text)
    if (run?.status !== 'completed' || run.is_error) throw new Error(`AI/ML API tool run ${String(run?.status || 'failed').slice(0, 40)}.`)
    return run.output
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

async function fetchPage(args: Record<string, any>, key: string, signal?: AbortSignal): Promise<ToolResult> {
  const target = await assertFetchableUrl(String(args.url ?? ''))
  const data = await runAimlapiTool(FETCH_TOOL, { url: target.href }, key, signal)
  const content = typeof data?.content === 'string' ? data.content.trim() : ''
  if (!content) throw new Error('AI/ML API could not extract this page.')
  const rawMax = Number(args.max_chars ?? 6000)
  const maxChars = Math.max(500, Math.min(12_000, Number.isFinite(rawMax) ? Math.floor(rawMax) : 6000))
  const title = String(data.title || target.hostname)
  return { ok: true, output: [title, target.href, content].join('\n').slice(0, maxChars), title, path: target.href, meta: 'AI/ML API' }
}

export async function executeAimlapiWebTool(name: 'web_search' | 'web_fetch', args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.networkCapabilityAllowed === false || ctx.disabledCapabilityIds?.includes('tool:web') || ctx.disabledToolNames?.includes(name)) {
    throw new Error('Public web access is disabled for this run.')
  }
  ctx.signal?.throwIfAborted()
  if (name === 'web_fetch') return await fetchPage(args, aimlapiKey(ctx), ctx.signal)
  const query = String(args.query ?? '').trim()
  if (!query) throw new Error('Search query is required.')
  const rawLimit = Number(args.limit ?? 5)
  const limit = Math.max(1, Math.min(8, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5))
  const data = await runAimlapiTool(SEARCH_TOOL, { q: query, m: limit }, aimlapiKey(ctx), ctx.signal)
  if (!data || !Array.isArray(data.organic_results)) throw new Error('AI/ML API returned an invalid search result.')
  const rows = data.organic_results.slice(0, limit).map((row: any) => {
    const target = safePublicWebUrl(String(row.link ?? ''))
    const snippet = typeof row.snippet === 'string' ? row.snippet.trim().slice(0, SNIPPET_CHARS) : ''
    return [String(row.title || target.hostname), target.href, snippet].filter(Boolean).join('\n')
  })
  return { ok: true, output: rows.join('\n\n').slice(0, 25_000) || 'No web results found.', title: query, meta: 'AI/ML API' }
}
