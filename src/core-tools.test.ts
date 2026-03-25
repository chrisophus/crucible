/**
 * Unit tests for core-tools.ts pipeline functions.
 * LLM and validator calls are mocked — no network required.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { runPurifyPipeline, runTranslatePipeline } from "./core-tools.ts"
import { getSession } from "./sessions.ts"
import { DEFAULT_CONFIG } from "./types.ts"

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("./providers.ts", () => ({
  DEFAULT_MODELS: {
    anthropic: "claude-sonnet-4-6",
    openai: "gpt-4o",
  },
  DEFAULT_CHEAP_MODELS: {
    anthropic: "claude-haiku-4-5-20251001",
    openai: "gpt-4o-mini",
  },
  callLLMRepl: vi.fn(),
}))

vi.mock("./validator.ts", () => ({
  runValidator: vi.fn(),
  parseEvidence: vi.fn(),
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

import { callLLMRepl } from "./providers.ts"
import { parseEvidence, runValidator } from "./validator.ts"

const mockCallLLM = vi.mocked(callLLMRepl)
const mockRunValidator = vi.mocked(runValidator)
const mockParseEvidence = vi.mocked(parseEvidence)

// A minimal AISP string with a high φ score so the pipeline reaches "ready".
const FAKE_AISP = `DOMAIN≜"test" φ≜95 δ≜0.80 τ≜◊⁺⁺\nREQ≜[R1: "The system shall respond."]\nEND`

const HIGH_VALIDATOR_RESULT = {
  valid: true,
  delta: 0.8,
  tier: "◊⁺⁺",
  ambiguity: 0.05,
  pureDensity: 0.85,
}

const LLM_OPTS = {
  provider: "anthropic" as const,
  apiKey: "sk-test-key",
}

const NEVER_CONFIG = {
  ...DEFAULT_CONFIG,
  ask_on_contradiction: false,
}

beforeEach(() => {
  vi.clearAllMocks()

  // Default: Phase1 returns AISP; contradiction detection returns empty;
  // Phase4 returns purified English.
  mockCallLLM.mockImplementation(
    async (_provider, _apiKey, _model, _system, messages, streamTo) => {
      const lastMsg = messages[messages.length - 1]
      const content = typeof lastMsg.content === "string" ? lastMsg.content : ""

      if (content.includes("contradictions") || content === FAKE_AISP) {
        // contradiction detection call
        return JSON.stringify({ contradictions: [] })
      }
      if (content.includes("Translate") || content.includes("translate")) {
        // Phase 4 translate
        const purified = "The system shall respond."
        if (streamTo) streamTo.write(purified)
        return purified
      }
      // Phase 1 or update — return AISP
      return FAKE_AISP
    },
  )

  mockRunValidator.mockResolvedValue(HIGH_VALIDATOR_RESULT)
  mockParseEvidence.mockReturnValue({
    delta: 0.8,
    tierSymbol: "◊⁺⁺",
    tierName: "platinum",
  })
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runPurifyPipeline", () => {
  it('returns status=ready when clarification_mode is "never"', async () => {
    const result = await runPurifyPipeline(
      "The system should respond quickly.",
      [],
      NEVER_CONFIG,
      LLM_OPTS,
    )

    expect(result.status).toBe("ready")
    expect(result.session_id).toBeTypeOf("string")
    expect(result.scores).toBeDefined()
  })

  it("includes scores in the result", async () => {
    const result = await runPurifyPipeline(
      "The system should respond quickly.",
      [],
      NEVER_CONFIG,
      LLM_OPTS,
    )

    expect(result.scores?.delta).toBeCloseTo(0.8)
    expect(result.scores?.tau).toBeTypeOf("string")
  })

  it("surfaces contradictions when ask_on_contradiction is true", async () => {
    const contradiction = {
      kind: "unsatisfiable_conjunction" as const,
      statement_a: "always on",
      statement_b: "never on",
      proof: "both true simultaneously",
      question: "Which is correct?",
    }

    // Override: contradiction detection returns one contradiction
    mockCallLLM.mockImplementation(async (_p, _k, _m, _sys, messages) => {
      const lastMsg = messages[messages.length - 1]
      const content = typeof lastMsg.content === "string" ? lastMsg.content : ""
      if (content.includes("Analyze the AISP document above")) {
        return JSON.stringify({ contradictions: [contradiction] })
      }
      return FAKE_AISP
    })

    const result = await runPurifyPipeline(
      "The system is always on and never on.",
      [],
      {
        ...NEVER_CONFIG,
        ask_on_contradiction: true,
        contradiction_detection: "always" as const,
      },
      LLM_OPTS,
    )

    expect(result.status).toBe("has_contradictions")
    expect(result.contradictions).toHaveLength(1)
    expect(result.contradictions?.[0].kind).toBe("unsatisfiable_conjunction")
  })

  it("skips Phase 1 when fromAisp=true", async () => {
    const callCount = mockCallLLM.mock.calls.length

    const result = await runPurifyPipeline(
      FAKE_AISP,
      [],
      NEVER_CONFIG,
      LLM_OPTS,
      true, // fromAisp
    )

    // No Phase 1 call; contradiction detection skipped (score is high, mode is on_low_score)
    const newCalls = mockCallLLM.mock.calls.length - callCount
    expect(newCalls).toBe(0)
    expect(result.status).toBe("ready")
  })
})

describe("runTranslatePipeline", () => {
  it("returns purified string", async () => {
    const run = await runPurifyPipeline(
      "The system shall respond.",
      [],
      NEVER_CONFIG,
      LLM_OPTS,
    )
    expect(run.status).toBe("ready")

    const result = await runTranslatePipeline(
      run.session_id,
      "narrative",
      LLM_OPTS,
    )

    expect(result.purified).toBeTypeOf("string")
    expect(result.purified.length).toBeGreaterThan(0)
    expect(result.session_id).toBe(run.session_id)
  })

  it("passes streamTo to callLLMRepl", async () => {
    const run = await runPurifyPipeline(
      "The system shall respond.",
      [],
      NEVER_CONFIG,
      LLM_OPTS,
    )

    const chunks: string[] = []
    const fakeStream = {
      write: (chunk: string) => {
        chunks.push(chunk)
        return true
      },
    } as unknown as NodeJS.WritableStream

    await runTranslatePipeline(run.session_id, "narrative", {
      ...LLM_OPTS,
      streamTo: fakeStream,
    })

    // Find the Phase4 call — it's the last callLLMRepl call and should have received streamTo
    const allCalls = mockCallLLM.mock.calls
    const lastCall = allCalls[allCalls.length - 1]
    expect(lastCall[5]).toBe(fakeStream) // 6th arg is streamTo
  })
})

describe("session expiry", () => {
  it("throws when session has expired", async () => {
    vi.useFakeTimers()

    const run = await runPurifyPipeline(
      "Some spec.",
      [],
      NEVER_CONFIG,
      LLM_OPTS,
    )
    const { session_id } = run

    // Advance time past 30-minute TTL
    vi.advanceTimersByTime(31 * 60 * 1000)

    expect(() => getSession(session_id)).toThrow(/not found or expired/)

    vi.useRealTimers()
  })
})
