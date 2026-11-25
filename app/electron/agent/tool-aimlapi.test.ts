import assert from 'node:assert/strict'
import { executeTool, TOOL_SCHEMAS } from './tools'
import { installDnsFixture } from './test-fixtures/dns'

const runEndpoint = 'https://tools.aimlapi.com/v1/tools/run'
const publicPage = 'https://93.184.216.34/article'
const key = 'sk-aiml-synthetic'
const originalFetch = globalThis.fetch
const requests: Array<{ url: string; body: any; headers: Headers; redirect?: RequestRedirect }> = []
const foreign: Array<{ url: string; headers: Headers }> = []
let fault = ''

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

globalThis.fetch = async (input, init) => {
  const url = String(input)
  const headers = new Headers(init?.headers)
  if (url !== runEndpoint) {
    foreign.push({ url, headers })
    if (url.startsWith('https://news.google.com/rss/search?')) return new Response('<rss><channel><item><title>Default news source</title><link>https://example.org/news</link></item></channel></rss>')
    if (url === publicPage) return new Response('<title>Direct page</title><p>Direct page text.</p>', { headers: { 'Content-Type': 'text/html' } })
    return originalFetch(input, init)
  }
  requests.push({ url, body: JSON.parse(String(init?.body)), headers, redirect: init?.redirect })
  // A real redirect would be refused by fetch because the request sets redirect: 'error'.
  if (fault === 'redirect') {
    if (init?.redirect === 'error') throw new TypeError('fetch failed: redirect mode is set to error')
    return new Response(null, { status: 302, headers: { Location: 'https://evil.test/steal' } })
  }
  if (fault === 'http') return json({ error: 'unauthorized' }, 401)
  if (fault === 'failed') return json({ status: 'failed', is_error: true, output: null })
  const { tool, input: args } = requests.at(-1)!.body
  if (tool === 'litescrape/web-fetch') return json({ status: 'completed', is_error: false, output: { url: args.url, title: 'Fetched article', content: '# Fetched article\n\nThe page as Markdown.' } })
  const organic = [
    { position: 1, title: 'Example source', link: publicPage, snippet: 'Useful public text.' },
    { position: 2, title: 'Another source', link: 'https://example.org/', snippet: 'Second page text.' },
  ]
  if (fault === 'private-result') organic[0].link = 'http://127.0.0.1/secret'
  return json({ status: 'completed', is_error: false, output: { search_metadata: { status: 'Success' }, organic_results: organic } })
}

const restoreDns = installDnsFixture({ 'news.google.com': '8.8.8.8' })
const ctx = (extra: Record<string, unknown> = {}): any => ({ cwd: '', aimlapiApiKey: () => key, ...extra })
try {
  for (const name of ['web_search', 'web_fetch']) {
    const schema: any = TOOL_SCHEMAS.find((schema) => schema.function?.name === name)
    assert.ok(schema.function.parameters.properties.provider.enum.includes('aimlapi'), `${name} exposes AI/ML API`)
  }

  const result = await executeTool('web_search', { query: 'public research question', provider: 'aimlapi', limit: 2 }, ctx())
  assert.equal(result.ok, true, result.output)
  assert.match(result.output, /Example source\nhttps:\/\/93\.184\.216\.34\/article\nUseful public text\./)
  assert.match(result.output, /Another source/)
  assert.equal(result.meta, 'AI/ML API')
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].body, { tool: 'litescrape/duckduckgo-search', input: { q: 'public research question', m: 2 } })
  assert.equal(requests[0].headers.get('Authorization'), `Bearer ${key}`, 'the saved key goes to tools.aimlapi.com')
  assert.equal(requests[0].redirect, 'error', 'the keyed request never follows a redirect')
  assert.equal(requests[0].headers.get('X-AIMLAPI-Source'), null, 'no extra attribution header is sent')

  const page = await executeTool('web_fetch', { url: publicPage, provider: 'aimlapi' }, ctx())
  assert.equal(page.ok, true, page.output)
  assert.match(page.output, /^Fetched article\nhttps:\/\/93\.184\.216\.34\/article\n# Fetched article/)
  assert.deepEqual(requests.at(-1)!.body, { tool: 'litescrape/web-fetch', input: { url: publicPage } })
  assert.equal(requests.at(-1)!.redirect, 'error')

  fault = 'redirect'
  const redirected = await executeTool('web_search', { query: 'q', provider: 'aimlapi' }, ctx())
  assert.equal(redirected.ok, false, 'a redirect is an error, not a second keyed request')
  fault = 'http'
  assert.match((await executeTool('web_search', { query: 'q', provider: 'aimlapi' }, ctx())).output, /HTTP 401 \(check the API key\)/)
  fault = 'failed'
  assert.equal((await executeTool('web_fetch', { url: publicPage, provider: 'aimlapi' }, ctx())).ok, false)
  fault = 'private-result'
  assert.equal((await executeTool('web_search', { query: 'q', provider: 'aimlapi' }, ctx())).ok, false, 'private result URLs are rejected')
  fault = ''

  const before = requests.length
  const blocked = await executeTool('web_fetch', { url: 'http://127.0.0.1/admin', provider: 'aimlapi' }, ctx())
  assert.equal(blocked.ok, false, 'private targets are refused before calling AI/ML API')
  const noKey = await executeTool('web_search', { query: 'q', provider: 'aimlapi' }, ctx({ aimlapiApiKey: () => '' }))
  assert.match(noKey.output, /need an API key/)
  const offline = await executeTool('web_search', { query: 'q', provider: 'aimlapi' }, ctx({ networkCapabilityAllowed: false }))
  assert.equal(offline.ok, false)
  assert.equal(requests.length, before, 'no AI/ML API request without a key, with web disabled or for a private target')

  // Other providers keep their own path and never receive the AI/ML API key.
  for (const provider of [undefined, 'google_news']) {
    const news = await executeTool('web_search', { query: 'news', provider }, ctx())
    assert.equal(news.ok, true, news.output)
    assert.match(news.output, /Default news source/)
  }
  const direct = await executeTool('web_fetch', { url: publicPage }, ctx())
  assert.equal(direct.ok, true, direct.output)
  assert.equal(requests.length, before, 'default providers do not call AI/ML API')
  assert.ok(foreign.length >= 3)
  for (const call of foreign) assert.equal(call.headers.get('Authorization'), null, `${call.url} gets no AI/ML API key`)
  console.log('AI/ML API web tools pass')
} finally {
  globalThis.fetch = originalFetch
  restoreDns()
}
