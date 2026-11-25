// Run: npx jiti electron/store/aimlapi-default-provider.test.ts
import assert from 'node:assert/strict'
import { AIMLAPI_BASE_URL, AIMLAPI_DEFAULT_MODELS } from '../agent/model-aimlapi.ts'
import { defaultSettings, seedProviders } from './defaults.ts'

const fresh = defaultSettings()
const seeded = fresh.providers.find((p) => p.id === 'aimlapi')
assert.ok(seeded, 'a fresh profile lists AI/ML API')
assert.equal(seeded.baseUrl, AIMLAPI_BASE_URL)
assert.equal(seeded.apiKey, '')
assert.equal(seeded.source, 'aimlapi')
assert.deepEqual(seeded.models, AIMLAPI_DEFAULT_MODELS)
assert.equal(fresh.activeProviderId, 'tensorfold', 'the built-in engine stays the active provider')
assert.ok(seedProviders(fresh.providers, undefined).some((p) => p.id === 'aimlapi'), 'first run seeds AI/ML API')
const saved = fresh.providers.filter((p) => p.id === 'openrouter').map((p) => ({ ...p, apiKey: 'sk-or-user' }))
assert.deepEqual(seedProviders(fresh.providers, saved).map((p) => p.id), ['openrouter'], 'an existing saved provider list is not extended with AI/ML API')

console.log('AI/ML API is listed for new profiles only')
