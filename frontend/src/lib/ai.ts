/**
 * Unified AI provider: Groq (free, primary) → Anthropic (fallback)
 * - Groq: Llama 3.3 70B Versatile, 30 RPM free, no monthly cap
 * - Anthropic: Claude Haiku/Sonnet, paid, used only when GROQ_API_KEY missing
 *   or if Groq returns an error
 */
import Anthropic from '@anthropic-ai/sdk'

export type AIProvider = 'groq' | 'anthropic' | 'none'

export type AIRequest = {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
  /** When set, force using only this provider (for upload chunks etc.) */
  preferredProvider?: AIProvider
}

export type AIResponse = {
  text: string
  provider: AIProvider
  model: string
}

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

async function callGroq(req: AIRequest): Promise<AIResponse> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.1,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Groq ${res.status}: ${errText.slice(0, 500)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  return { text, provider: 'groq', model: GROQ_MODEL }
}

async function callAnthropic(req: AIRequest): Promise<AIResponse> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.1,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  })
  const firstBlock = message.content[0]
  const text = firstBlock && firstBlock.type === 'text' ? firstBlock.text : ''
  return { text, provider: 'anthropic', model: ANTHROPIC_MODEL }
}

export function availableProvider(): AIProvider {
  if (process.env.GROQ_API_KEY) return 'groq'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  return 'none'
}

/**
 * Try Groq first (free); on error, fall back to Anthropic if configured.
 * If `preferredProvider` is set, we only try that one.
 */
export async function generate(req: AIRequest): Promise<AIResponse> {
  const preferred = req.preferredProvider
  const groqAvailable = Boolean(process.env.GROQ_API_KEY)
  const anthropicAvailable = Boolean(process.env.ANTHROPIC_API_KEY)

  if (preferred === 'groq') {
    if (!groqAvailable) throw new Error('GROQ_API_KEY not configured')
    return callGroq(req)
  }
  if (preferred === 'anthropic') {
    if (!anthropicAvailable) throw new Error('ANTHROPIC_API_KEY not configured')
    return callAnthropic(req)
  }

  // Default: Groq → Anthropic
  if (groqAvailable) {
    try {
      return await callGroq(req)
    } catch (err) {
      // If Anthropic isn't configured, surface the Groq error
      if (!anthropicAvailable) throw err
      console.warn('Groq failed, falling back to Anthropic:', err)
      return callAnthropic(req)
    }
  }

  if (anthropicAvailable) return callAnthropic(req)

  throw new Error(
    'No AI provider configured. Set GROQ_API_KEY (free) and/or ANTHROPIC_API_KEY in env.'
  )
}
