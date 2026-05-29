/**
 * Unit tests for worker-src/lib/claude.js.
 *
 * Verifies plan→model routing, the 429/529/503 Sonnet→Haiku fallback,
 * cost computation, and the cheap JSON-extract helper used by /search.
 *
 * We mock globalThis.fetch so no real Anthropic calls happen. Each test
 * restores after itself via the suite-level beforeEach.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CLAUDE_SONNET,
  CLAUDE_HAIKU,
  PRICING_USD,
  modelForPlan,
  estimateCostUsd,
  claudeMessages,
  claudeCall,
  extractClaudeJson,
} from '../../worker-src/lib/claude.js';

const env = { ANTHROPIC_API_KEY: 'sk-ant-test' };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('modelForPlan', () => {
  it.each([
    ['professional', CLAUDE_SONNET],
    ['business',     CLAUDE_SONNET],
    ['enterprise',   CLAUDE_SONNET],
    ['PROFESSIONAL', CLAUDE_SONNET], // case-insensitive
    ['Business',     CLAUDE_SONNET],
    ['starter',      CLAUDE_HAIKU],
    ['guest',        CLAUDE_HAIKU],
    ['free',         CLAUDE_HAIKU],
    ['',             CLAUDE_HAIKU],
    [null,           CLAUDE_HAIKU],
    [undefined,      CLAUDE_HAIKU],
  ])('plan %p → %s', (plan, expected) => {
    expect(modelForPlan(plan)).toBe(expected);
  });
});

describe('PRICING_USD', () => {
  it('declares Sonnet and Haiku rates', () => {
    expect(PRICING_USD[CLAUDE_SONNET]).toEqual({ input: 3.00,  output: 15.00 });
    expect(PRICING_USD[CLAUDE_HAIKU]).toEqual({ input: 0.80,  output: 4.00 });
  });
});

describe('estimateCostUsd', () => {
  it('computes Sonnet correctly for 1M+1M tokens', () => {
    // 1M × $3 in + 1M × $15 out = $18
    expect(estimateCostUsd(CLAUDE_SONNET, { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(18);
  });

  it('computes Haiku correctly for small usage', () => {
    // 1000 × 0.8/1M + 1000 × 4/1M = 0.0008 + 0.0040 = 0.0048
    expect(estimateCostUsd(CLAUDE_HAIKU, { input_tokens: 1000, output_tokens: 1000 })).toBe(0.0048);
  });

  it('returns 0 for unknown model (never NaN)', () => {
    expect(estimateCostUsd('claude-fake-99', { input_tokens: 100, output_tokens: 100 })).toBe(0);
  });

  it('returns 0 for null/undefined usage', () => {
    expect(estimateCostUsd(CLAUDE_HAIKU, null)).toBe(0);
    expect(estimateCostUsd(CLAUDE_HAIKU, undefined)).toBe(0);
  });

  it('handles missing token fields as zero', () => {
    expect(estimateCostUsd(CLAUDE_HAIKU, {})).toBe(0);
    expect(estimateCostUsd(CLAUDE_HAIKU, { input_tokens: 1000 })).toBeCloseTo(0.0008, 7);
  });

  it('rounds to 6 decimal places', () => {
    // 1 input token Haiku = 0.0000008 → rounds to 0.000001
    expect(estimateCostUsd(CLAUDE_HAIKU, { input_tokens: 1, output_tokens: 0 })).toBe(0.000001);
  });
});

describe('claudeMessages', () => {
  it('success path returns { ok: true, data }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'msg_123', content: [{ type: 'text', text: 'hello' }] }),
        { status: 200 }
      )
    );
    const r = await claudeMessages(env, { model: CLAUDE_HAIKU, max_tokens: 100, messages: [] });
    expect(r.ok).toBe(true);
    expect(r.data.id).toBe('msg_123');
  });

  it('non-2xx returns { ok: false, status, detail }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('overloaded', { status: 529 })
    );
    const r = await claudeMessages(env, { model: CLAUDE_HAIKU, max_tokens: 100, messages: [] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(529);
    expect(r.detail).toContain('overloaded');
  });

  it('network error returns { ok: false, status: 0 }', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'));
    const r = await claudeMessages(env, { model: CLAUDE_HAIKU, max_tokens: 100, messages: [] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.detail).toContain('ECONNREFUSED');
  });

  it('truncates long error bodies to 300 chars', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('X'.repeat(1000), { status: 500 })
    );
    const r = await claudeMessages(env, { model: CLAUDE_HAIKU, max_tokens: 100, messages: [] });
    expect(r.detail.length).toBe(300);
  });
});

describe('claudeCall', () => {
  it('uses Sonnet for a paid plan and surfaces model_used', async () => {
    let capturedModel = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedModel = JSON.parse(init.body).model;
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200 }
      );
    });
    const r = await claudeCall(env, { max_tokens: 100, messages: [] }, { plan: 'professional' });
    expect(capturedModel).toBe(CLAUDE_SONNET);
    expect(r.ok).toBe(true);
    expect(r.model_used).toBe(CLAUDE_SONNET);
    expect(r.fellback).toBe(false);
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('uses Haiku for a guest plan', async () => {
    let capturedModel = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedModel = JSON.parse(init.body).model;
      return new Response(
        JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 }
      );
    });
    await claudeCall(env, { max_tokens: 100, messages: [] }, { plan: 'guest' });
    expect(capturedModel).toBe(CLAUDE_HAIKU);
  });

  it('falls back to Haiku on Sonnet 429', async () => {
    let callN = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      callN++;
      const model = JSON.parse(init.body).model;
      if (callN === 1) {
        expect(model).toBe(CLAUDE_SONNET);
        return new Response('rate limit', { status: 429 });
      }
      expect(model).toBe(CLAUDE_HAIKU);
      return new Response(
        JSON.stringify({ content: [], usage: { input_tokens: 5, output_tokens: 3 } }),
        { status: 200 }
      );
    });
    const r = await claudeCall(env, { max_tokens: 100, messages: [] }, { plan: 'professional' });
    expect(r.ok).toBe(true);
    expect(r.fellback).toBe(true);
    expect(r.model_used).toBe(CLAUDE_HAIKU);
    expect(callN).toBe(2);
  });

  it('falls back on Sonnet 529 (overloaded)', async () => {
    let callN = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callN++;
      if (callN === 1) return new Response('busy', { status: 529 });
      return new Response(
        JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 }
      );
    });
    const r = await claudeCall(env, { max_tokens: 100, messages: [] }, { plan: 'enterprise' });
    expect(r.ok).toBe(true);
    expect(r.fellback).toBe(true);
  });

  it('does NOT fall back on Sonnet 500 (only 429/529/503)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const r = await claudeCall(env, { max_tokens: 100, messages: [] }, { plan: 'professional' });
    expect(r.ok).toBe(false);
    expect(r.fellback).toBe(false);
    expect(r.model_used).toBe(CLAUDE_SONNET);
  });

  it('does NOT fall back when starting from Haiku (no point)', async () => {
    let callN = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callN++;
      return new Response('rate limit', { status: 429 });
    });
    const r = await claudeCall(env, { max_tokens: 100, messages: [] }, { plan: 'guest' });
    expect(r.ok).toBe(false);
    expect(r.model_used).toBe(CLAUDE_HAIKU);
    expect(callN).toBe(1);  // single attempt
  });

  it('respects explicit model override (bypasses plan logic)', async () => {
    let capturedModel = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedModel = JSON.parse(init.body).model;
      return new Response(
        JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 }
      );
    });
    await claudeCall(env, { max_tokens: 100, messages: [] }, { plan: 'guest', model: CLAUDE_SONNET });
    expect(capturedModel).toBe(CLAUDE_SONNET);
  });

  it('respects allowFallback: false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limit', { status: 429 }));
    const r = await claudeCall(
      env,
      { max_tokens: 100, messages: [] },
      { plan: 'professional', allowFallback: false }
    );
    expect(r.ok).toBe(false);
    expect(r.fellback).toBe(false);
  });

  it('attaches estimated cost_usd on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ content: [], usage: { input_tokens: 1000, output_tokens: 1000 } }),
        { status: 200 }
      )
    );
    const r = await claudeCall(env, { max_tokens: 100, messages: [] }, { plan: 'guest' });
    expect(r.cost_usd).toBe(0.0048);  // Haiku rates
  });
});

describe('extractClaudeJson', () => {
  it('parses plain JSON from the first text block', () => {
    expect(extractClaudeJson({ content: [{ text: '{"a":1}' }] })).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(extractClaudeJson({ content: [{ text: '```json\n{"b":2}\n```' }] })).toEqual({ b: 2 });
  });

  it('returns null on invalid JSON', () => {
    expect(extractClaudeJson({ content: [{ text: 'not json' }] })).toBeNull();
  });

  it('returns null on empty / missing content', () => {
    expect(extractClaudeJson({})).toBeNull();
    expect(extractClaudeJson({ content: [] })).toBeNull();
    expect(extractClaudeJson(null)).toBeNull();
  });
});
