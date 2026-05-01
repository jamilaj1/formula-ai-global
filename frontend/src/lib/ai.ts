/**
 * Unified AI provider: tries Groq (free) first by default, falls back to
 * Anthropic on error. preferredProvider just changes the order — fallback
 * always happens. This guarantees we keep working even when one provider
 * has a billing cap or rate-limit issue.
 */
import Anthropic from '@anthropic-ai/sdk'

export type AIProvider = 'groq' | 'anthropic' | 'none'

export type AIRequest = {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
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
 * Try the preferred provider first (or Groq by default), and ALWAYS fall back
 * to the other provider on error. preferredProvider just changes the order.
 */
export async function generate(req: AIRequest): Promise<AIResponse> {
  const groqAvailable = Boolean(process.env.GROQ_API_KEY)
  const anthropicAvailable = Boolean(process.env.ANTHROPIC_API_KEY)

  if (!groqAvailable && !anthropicAvailable) {
    throw new Error(
      'No AI provider configured. Set GROQ_API_KEY (free) and/or ANTHROPIC_API_KEY in env.'
    )
  }

  const order: AIProvider[] = req.preferredProvider === 'anthropic'
    ? ['anthropic', 'groq']
    : ['groq', 'anthropic']

  let lastErr: unknown = null
  for (const provider of order) {
    if (provider === 'groq' && !groqAvailable) continue
    if (provider === 'anthropic' && !anthropicAvailable) continue
    try {
      if (provider === 'groq') return await callGroq(req)
      return await callAnthropic(req)
    } catch (err) {
      lastErr = err
      console.warn(`${provider} call failed, trying next provider:`, err)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All AI providers failed')
}
