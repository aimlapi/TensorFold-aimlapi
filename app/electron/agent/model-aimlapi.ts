import type { Provider } from './types'
import { readBoundedJsonResponse } from './bounded-response'

export const AIMLAPI_BASE_URL = 'https://api.aimlapi.com/v1'
export const AIMLAPI_HOST = 'api.aimlapi.com'

// Chat-completions models with tools, streaming and (except DeepSeek and GLM) vision in the live catalogue.
export const AIMLAPI_DEFAULT_MODELS = [
  'openai/gpt-5.4-mini',
  'anthropic/claude-sonnet-4.6',
  'google/gemini-2.5-flash',
  'deepseek/deepseek-chat',
  'zhipu/glm-5.2',
]

/** Matches only the exact AI/ML API host, so a lookalike or edited base URL keeps the generic path. */
export function isAimlapiProvider(provider: Pick<Provider, 'baseUrl'>): boolean {
  try {
    const url = new URL(provider.baseUrl)
    return url.protocol === 'https:' && url.hostname === AIMLAPI_HOST
  } catch {
    return false
  }
}

/** Lists chat models from the public catalogue; it needs no key, so none is sent. */
export async function fetchAimlapiModels(provider: Provider, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (!isAimlapiProvider(provider)) throw new Error('AI/ML API models are only listed from https://api.aimlapi.com.')
  const res = await fetchImpl(`${AIMLAPI_BASE_URL}/models`, { redirect: 'error', signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim())
  const payload: any = await readBoundedJsonResponse(res, 'AI/ML API models')
  const data: any[] = Array.isArray(payload?.data) ? payload.data : []
  const chat = data.filter((model) => model?.type === 'openai/chat-completions' && typeof model.id === 'string' && model.id.trim()).map((model) => model.id.trim() as string)
  return Array.from(new Set([...AIMLAPI_DEFAULT_MODELS.filter((id) => chat.includes(id)), ...chat]))
}

/** The web tools reuse the saved AI/ML API provider key, and only while that provider still points at the exact host. */
export function aimlapiToolKey(providers: Provider[]): string {
  return providers.find((provider) => provider.source === 'aimlapi' && isAimlapiProvider(provider))?.apiKey ?? ''
}
