// Run: npx jiti electron/agent/model-aimlapi.test.ts
import assert from 'node:assert/strict'
import { AIMLAPI_BASE_URL, AIMLAPI_DEFAULT_MODELS, aimlapiToolKey, fetchAimlapiModels, isAimlapiProvider } from './model-aimlapi.ts'
import type { Provider } from './types'

const provider = (baseUrl = AIMLAPI_BASE_URL, extra: Partial<Provider> = {}): Provider => ({ id: 'aimlapi', name: 'AI/ML API', baseUrl, apiKey: 'sk-aiml-test', models: [], kind: 'cloud', source: 'aimlapi', ...extra })

assert.equal(isAimlapiProvider(provider()), true)
for (const url of ['https://api.aimlapi.com.evil.test/v1', 'https://evil.test/api.aimlapi.com/v1', 'http://api.aimlapi.com/v1', 'https://aimlapi.com/v1', 'not a url']) {
  assert.equal(isAimlapiProvider(provider(url)), false, `${url} is not the AI/ML API host`)
}

{
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ data: [
      { id: 'zhipu/glm-5.2', type: 'openai/chat-completions' },
      { id: 'vendor/new-chat', type: 'openai/chat-completions' },
      { id: 'vendor/new-chat', type: 'openai/chat-completions' },
      { id: 'vendor/image', type: 'openai/image-generations' },
      { id: 'anthropic/claude-sonnet-4.6', type: 'anthropic/messages' },
      { id: 'openai/gpt-5.4-mini', type: 'openai/chat-completions' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const models = await fetchAimlapiModels(provider(), fetchImpl)
  assert.deepEqual(models, ['openai/gpt-5.4-mini', 'zhipu/glm-5.2', 'vendor/new-chat'], 'only chat-completions models, curated first, no duplicates')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.aimlapi.com/v1/models')
  assert.equal(calls[0].init?.redirect, 'error', 'the catalogue request never follows a redirect')
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), null, 'the public catalogue gets no key')
}

{
  let called = false
  await assert.rejects(fetchAimlapiModels(provider('https://api.aimlapi.com.evil.test/v1'), (async () => { called = true; return new Response('{}') }) as typeof fetch))
  assert.equal(called, false, 'a lookalike base URL is never fetched')
}

assert.equal(aimlapiToolKey([provider()]), 'sk-aiml-test')
assert.equal(aimlapiToolKey([provider('https://proxy.example/v1')]), '', 'an AI/ML API entry edited to another host does not hand its key to the web tools')
assert.equal(aimlapiToolKey([provider(AIMLAPI_BASE_URL, { source: 'openai' })]), '', 'only the AI/ML API entry supplies the web-tool key')
assert.equal(aimlapiToolKey([]), '')

console.log('AI/ML API model catalogue, host binding pass')
