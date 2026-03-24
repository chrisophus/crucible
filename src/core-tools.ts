/**
 * V3 session-based pipeline for purify MCP tools.
 *
 * Pipeline: Phase1(LLM) → Phase2(ExternalValidator) → Phase3(Branch)
 *           → Phase3a(LLM questions) | Phase3b(LLM refine) → Phase4(LLM translate)
 *
 * Conversation accumulates — never replaced.
 * System prompt (domain context) is cached for session lifetime.
 */

import { readFileSync } from "node:fs"
import {
  CONTRADICTION_DETECTION_SYSTEM,
  INIT_SYSTEM,
  buildAnswersTurnContent,
  buildPatchRequestContent,
  buildPatchTranslateContent,
  buildPurifyTurnContent,
  buildQuestionRequestContent,
  buildTranslateTurnContent,
  buildUpdateTurnContent,
  getSessionSystemPrompt,
} from "./prompts.ts"
import { DEFAULT_CHEAP_MODELS, DEFAULT_MODELS, callLLMRepl } from "./providers.ts"
import { createSession, getSession, saveSession } from "./sessions.ts"
import type {
  AispBlock,
  Config,
  Contradiction,
  Gap,
  PatchResult,
  PipelineValidationResult,
  Provider,
  PurifyRunResult,
  QualityTier,
  Question,
  Scores,
  Session,
  ValidatorResult,
} from "./types.ts"
import { parseEvidence, runValidator } from "./validator.ts"

// ── Tier ordering ──────────────────────────────────────────────────────────────

const TIER_ORDER: Record<QualityTier, number> = {
  "⊘": 0,
  "◊⁻": 1,
  "◊": 2,
  "◊⁺": 3,
  "◊⁺⁺": 4,
}

function tierBelow(a: QualityTier, b: QualityTier): boolean {
  return TIER_ORDER[a] < TIER_ORDER[b]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON<T>(text: string): T {
  const stripped = text.trim()
  const fenceMatch = stripped.match(/^```(?:json)?\s*\n([\s\S]+?)\n```\s*$/)
  if (fenceMatch) return JSON.parse(fenceMatch[1]) as T
  return JSON.parse(stripped) as T
}

function parsePhi(aisp: string): number {
  const m = aisp.match(/φ[≜=]\s*(\d+)/)
  return m ? Math.min(100, parseInt(m[1], 10)) : 65
}

function computeTier(delta: number, phi: number): QualityTier {
  if (delta >= 0.75 && phi >= 95) return "◊⁺⁺"
  if (delta >= 0.6 && phi >= 80) return "◊⁺"
  if (delta >= 0.4 && phi >= 65) return "◊"
  if (delta >= 0.2 && phi >= 40) return "◊⁻"
  return "⊘"
}

function computeGaps(
  validatorResult: ValidatorResult | null,
  scores: Scores,
): Gap[] {
  const gaps: Gap[] = []
  if (scores.delta < 0.4) {
    gaps.push({ location: "overall", signal: "low_delta" })
  }
  if (validatorResult && !validatorResult.valid) {
    gaps.push({ location: "document_structure", signal: "missing_block" })
  }
  return gaps
}

function formatValidationSummary(validation: PipelineValidationResult): string {
  const lines = [
    "Validation Result:",
    `- Tier: ${validation.scores.tau}`,
    `- Delta: ${validation.scores.delta.toFixed(3)}`,
    `- Phi: ${validation.scores.phi}`,
  ]
  if (validation.contradictions.length > 0) {
    lines.push("\nContradictions:")
    for (const c of validation.contradictions) {
      lines.push(`  - ${c.kind}: ${c.statement_a} | ${c.statement_b}`)
    }
  }
  if (validation.gaps.length > 0) {
    lines.push("\nGaps:")
    for (const g of validation.gaps) {
      lines.push(`  - ${g.signal} at ${g.location}`)
    }
  }
  return lines.join("\n")
}

function resolveApiKey(provider: Provider): string {
  const envVars: Record<Provider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
  }
  const key = process.env[envVars[provider]]
  if (!key) throw new Error(`${envVars[provider]} environment variable is not set`)
  return key
}

interface LLMOpts {
  apiKey?: string
  provider?: Provider
  model?: string
  cheapModel?: string
  baseUrl?: string
  openaiUser?: string
  insecure?: boolean
}

interface ResolvedOpts {
  provider: Provider
  mainModel: string
  cheapModel: string
  apiKey: string
  baseUrl?: string
  openaiUser?: string
  insecure?: boolean
}

function resolveOpts(opts: LLMOpts): ResolvedOpts {
  const provider = (
    opts.provider ??
    (process.env.PURIFY_PROVIDER as Provider | undefined) ??
    "anthropic"
  ) as Provider
  const mainModel =
    opts.model ?? process.env.PURIFY_MODEL ?? DEFAULT_MODELS[provider]
  const cheapModel =
    opts.cheapModel ??
    process.env.PURIFY_MODEL_CHEAP ??
    DEFAULT_CHEAP_MODELS[provider]
  const apiKey = opts.apiKey ?? resolveApiKey(provider)
  return {
    provider,
    mainModel,
    cheapModel,
    apiKey,
    baseUrl: opts.baseUrl,
    openaiUser: opts.openaiUser,
    insecure: opts.insecure,
  }
}

// ── Phase 2: External validator ────────────────────────────────────────────────

async function detectContradictions(
  aisp: string,
  provider: Provider,
  apiKey: string,
  model: string,
  llmOpts: { baseUrl?: string; openaiUser?: string; insecure?: boolean },
): Promise<Contradiction[]> {
  try {
    const raw = await callLLMRepl(
      provider,
      apiKey,
      model,
      CONTRADICTION_DETECTION_SYSTEM,
      [{ role: "user", content: aisp }],
      undefined,
      llmOpts,
    )
    const parsed = parseJSON<{ contradictions: Contradiction[] }>(raw)
    return parsed.contradictions ?? []
  } catch {
    return []
  }
}

async function computeValidationResult(
  aisp: string,
  provider: Provider,
  apiKey: string,
  cheapModel: string,
  llmOpts: { baseUrl?: string; openaiUser?: string; insecure?: boolean },
): Promise<PipelineValidationResult> {
  const selfReport = parseEvidence(aisp)
  const phi = parsePhi(aisp)

  const [validatorResult, contradictions] = await Promise.all([
    runValidator(aisp),
    detectContradictions(aisp, provider, apiKey, cheapModel, llmOpts),
  ])

  const delta = validatorResult?.delta ?? selfReport.delta ?? 0
  const tau = computeTier(delta, phi)
  const scores: Scores = { delta, phi, tau }
  const gaps = computeGaps(validatorResult, scores)

  return { scores, contradictions, gaps }
}

// ── Phase 1: Purify (English → AISP) ──────────────────────────────────────────

async function runPhase1(
  session: Session,
  text: string,
  resolved: ResolvedOpts,
): Promise<string> {
  const userContent = buildPurifyTurnContent(text)
  session.messages.push({ role: "user", content: userContent })

  const aisp = await callLLMRepl(
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    session.systemPrompt,
    session.messages,
    undefined,
    {
      baseUrl: resolved.baseUrl,
      openaiUser: resolved.openaiUser,
      insecure: resolved.insecure,
    },
  )

  session.messages.push({ role: "assistant", content: aisp })
  session.aisp_current = aisp
  saveSession(session)
  return aisp
}

// ── Phase 3a: Generate questions (LLM) ────────────────────────────────────────

async function generateQuestions(
  session: Session,
  validation: PipelineValidationResult,
  resolved: ResolvedOpts,
): Promise<Question[]> {
  const summary = formatValidationSummary(validation)
  const userContent = buildQuestionRequestContent(summary)
  session.messages.push({ role: "user", content: userContent })

  const raw = await callLLMRepl(
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    session.systemPrompt,
    session.messages,
    undefined,
    {
      baseUrl: resolved.baseUrl,
      openaiUser: resolved.openaiUser,
      insecure: resolved.insecure,
    },
  )

  // Parse and validate questions from the model response. Fall back to a safe
  // single optional question if parsing or validation fails.
  let questions: Question[]
  try {
    const parsed = parseJSON<unknown>(raw)

    const sanitizeQuestions = (value: unknown): Question[] | null => {
      if (!Array.isArray(value)) return null

      const allowedPriorities = new Set<string>(["MANDATORY", "OPTIONAL"])
      const result: Question[] = []

      for (const item of value) {
        if (!item || typeof item !== "object") continue

        const q: unknown = (item as any).question
        const p: unknown = (item as any).priority

        if (typeof q !== "string" || q.trim().length === 0) continue
        if (typeof p !== "string" || !allowedPriorities.has(p)) continue

        result.push({ question: q.trim(), priority: p as Question["priority"] })

        if (result.length >= 7) break
      }

      return result.length > 0 ? result : null
    }

    const validated = sanitizeQuestions(parsed)
    if (!validated) {
      throw new Error("Invalid questions payload")
    }

    questions = validated
  } catch {
    questions = [
      {
        priority: "OPTIONAL",
        question:
          "Please provide any additional information or clarifications you think are missing from your previous answer.",
      },
    ]
  }

  session.messages.push({ role: "assistant", content: raw })
  saveSession(session)
  return questions
}

// ── Phase 3b: Incorporate answers (LLM refines AISP) ──────────────────────────

async function incorporateAnswers(
  session: Session,
  answers: Array<{ question: string; answer: string }>,
  resolved: ResolvedOpts,
): Promise<string> {
  const answersContent = buildAnswersTurnContent(answers)
  const aispSnippet =
    session.aisp_current && session.aisp_current.trim().length > 0
      ? `\n\nHere is the current AISP document that you must update:\n\n${session.aisp_current}`
      : ""
  const userContent = `${answersContent}${aispSnippet}`
  session.messages.push({ role: "user", content: userContent })

  const refinedAisp = await callLLMRepl(
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    session.systemPrompt,
    session.messages,
    undefined,
    {
      baseUrl: resolved.baseUrl,
      openaiUser: resolved.openaiUser,
      insecure: resolved.insecure,
    },
  )

  session.messages.push({ role: "assistant", content: refinedAisp })
  session.aisp_current = refinedAisp
  session.round += 1
  saveSession(session)
  return refinedAisp
}

// ── Phase 3: Branch ────────────────────────────────────────────────────────────

type Phase3Result =
  | { action: "has_contradictions"; contradictions: Contradiction[] }
  | { action: "needs_clarification"; questions: Question[] }
  | { action: "proceed_to_phase4" }

async function runPhase3(
  session: Session,
  validation: PipelineValidationResult,
  resolved: ResolvedOpts,
): Promise<Phase3Result> {
  const { config } = session

  // Contradictions take priority
  if (validation.contradictions.length > 0 && config.ask_on_contradiction) {
    return { action: "has_contradictions", contradictions: validation.contradictions }
  }

  // Below threshold — check clarification mode
  if (tierBelow(validation.scores.tau, config.score_threshold)) {
    if (config.clarification_mode === "never") {
      return { action: "proceed_to_phase4" }
    }
    if (
      (config.clarification_mode === "always" ||
        config.clarification_mode === "on_low_score") &&
      session.round < config.max_clarify_rounds
    ) {
      const questions = await generateQuestions(session, validation, resolved)
      return { action: "needs_clarification", questions }
    }
  }

  // At or above threshold, or max rounds reached
  return { action: "proceed_to_phase4" }
}

// ── Phase 4: Translate (AISP → English) ───────────────────────────────────────

async function runPhase4(
  session: Session,
  format: string,
  resolved: ResolvedOpts,
  streamTo?: NodeJS.WritableStream,
): Promise<string> {
  const userContent = buildTranslateTurnContent(format)
  session.messages.push({ role: "user", content: userContent })

  const purified = await callLLMRepl(
    resolved.provider,
    resolved.apiKey,
    resolved.mainModel,
    session.systemPrompt,
    session.messages,
    streamTo,
    {
      baseUrl: resolved.baseUrl,
      openaiUser: resolved.openaiUser,
      insecure: resolved.insecure,
    },
  )

  session.messages.push({ role: "assistant", content: purified })
  saveSession(session)
  return purified
}

// ── High-level tool implementations ───────────────────────────────────────────

// purify_run — starts a session, runs Phase1→Phase3
export async function runPurifyPipeline(
  text: string,
  context: string | undefined,
  config: Config,
  opts: LLMOpts,
  fromAisp = false,
): Promise<PurifyRunResult> {
  const resolved = resolveOpts(opts)
  const systemPrompt = getSessionSystemPrompt(context)
  const session = createSession(systemPrompt, config)

  let aisp: string
  if (fromAisp) {
    // Input is already AISP — seed session directly
    session.aisp_current = text
    session.messages.push({ role: "user", content: text }, { role: "assistant", content: text })
    saveSession(session)
    aisp = text
  } else {
    aisp = await runPhase1(session, text, resolved)
  }

  const validation = await computeValidationResult(
    aisp,
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    { baseUrl: resolved.baseUrl, openaiUser: resolved.openaiUser, insecure: resolved.insecure },
  )

  const phase3 = await runPhase3(session, validation, resolved)

  if (phase3.action === "has_contradictions") {
    return {
      session_id: session.id,
      status: "has_contradictions",
      contradictions: phase3.contradictions,
      scores: validation.scores,
    }
  }

  if (phase3.action === "needs_clarification") {
    return {
      session_id: session.id,
      status: "needs_clarification",
      questions: phase3.questions,
      scores: validation.scores,
    }
  }

  return { session_id: session.id, status: "ready", scores: validation.scores }
}

// purify_clarify — submits answers, re-runs Phase2→Phase3
export async function runClarifyPipeline(
  sessionId: string,
  answers: Array<{ question: string; answer: string }>,
  opts: LLMOpts,
): Promise<PurifyRunResult> {
  const session = getSession(sessionId)
  const resolved = resolveOpts(opts)

  const refinedAisp = await incorporateAnswers(session, answers, resolved)

  const validation = await computeValidationResult(
    refinedAisp,
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    { baseUrl: resolved.baseUrl, openaiUser: resolved.openaiUser, insecure: resolved.insecure },
  )

  const phase3 = await runPhase3(session, validation, resolved)

  if (phase3.action === "has_contradictions") {
    return {
      session_id: session.id,
      status: "has_contradictions",
      contradictions: phase3.contradictions,
      scores: validation.scores,
    }
  }

  if (phase3.action === "needs_clarification") {
    return {
      session_id: session.id,
      status: "needs_clarification",
      questions: phase3.questions,
      scores: validation.scores,
    }
  }

  return { session_id: session.id, status: "ready", scores: validation.scores }
}

// purify_translate — runs Phase4, returns purified English
export async function runTranslatePipeline(
  sessionId: string,
  format: string,
  opts: LLMOpts & { streamTo?: NodeJS.WritableStream },
): Promise<{ purified: string; session_id: string }> {
  const session = getSession(sessionId)
  const resolved = resolveOpts(opts)

  const purified = await runPhase4(session, format, resolved, opts.streamTo)

  return { purified, session_id: session.id }
}

// purify_update — seeds new session from existing, appends change, re-runs
export async function runUpdatePipeline(
  sessionId: string,
  change: string,
  context: string | undefined,
  config: Config,
  opts: LLMOpts,
): Promise<PurifyRunResult> {
  const prev = getSession(sessionId)
  const resolved = resolveOpts(opts)

  // Seed new session with previous conversation
  const systemPrompt =
    context != null
      ? getSessionSystemPrompt(context)
      : prev.systemPrompt
  const newSession = createSession(systemPrompt, config)
  newSession.messages = [...prev.messages]
  saveSession(newSession)

  // Append change as new user turn and call LLM to produce updated AISP
  const updateContent = buildUpdateTurnContent(change)
  newSession.messages.push({ role: "user" as const, content: updateContent })

  const updatedAisp = await callLLMRepl(
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    newSession.systemPrompt,
    newSession.messages,
    undefined,
    { baseUrl: resolved.baseUrl, openaiUser: resolved.openaiUser, insecure: resolved.insecure },
  )

  newSession.messages.push({ role: "assistant" as const, content: updatedAisp })
  newSession.aisp_current = updatedAisp
  saveSession(newSession)

  const validation = await computeValidationResult(
    updatedAisp,
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    { baseUrl: resolved.baseUrl, openaiUser: resolved.openaiUser, insecure: resolved.insecure },
  )

  const phase3 = await runPhase3(newSession, validation, resolved)

  if (phase3.action === "has_contradictions") {
    return {
      session_id: newSession.id,
      status: "has_contradictions",
      contradictions: phase3.contradictions,
      scores: validation.scores,
    }
  }

  if (phase3.action === "needs_clarification") {
    return {
      session_id: newSession.id,
      status: "needs_clarification",
      questions: phase3.questions,
      scores: validation.scores,
    }
  }

  return { session_id: newSession.id, status: "ready", scores: validation.scores }
}

// ── purify_patch ───────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Parse `-- BLOCK: name | v=N | delta=...` markers from a patch LLM response. */
function parseAispBlocks(raw: string): AispBlock[] {
  const blocks: AispBlock[] = []
  // Split on lines starting with -- BLOCK:
  const parts = raw.split(/(?=^--\s*BLOCK:\s*)/m).filter((p) => p.trim())
  for (const part of parts) {
    const headerMatch = part.match(/^--\s*BLOCK:\s*([^|]+)\|\s*v=(\d+)\s*\|\s*delta=(.+)$/m)
    if (!headerMatch) continue
    blocks.push({
      name: headerMatch[1].trim(),
      version: parseInt(headerMatch[2], 10),
      delta: headerMatch[3].trim(),
      body: part.trim(),
    })
  }
  return blocks
}

/**
 * Splice updated blocks back into the full AISP by finding the matching
 * `-- BLOCK: name` marker and replacing from there to the next block marker.
 * Falls back to appending if the marker is not found.
 */
function spliceAispBlocks(aisp: string, blocks: AispBlock[]): string {
  let result = aisp
  for (const block of blocks) {
    const markerRe = new RegExp(`--\\s*BLOCK:\\s*${escapeRegex(block.name)}[^\\n]*\\n`, "m")
    const match = markerRe.exec(result)
    if (!match) {
      // Block marker not in AISP — append
      result = `${result}\n\n${block.body}`
    } else {
      const start = match.index
      const afterMarker = start + match[0].length
      const nextMatch = /--\s*BLOCK:/m.exec(result.slice(afterMarker))
      const end = nextMatch ? afterMarker + nextMatch.index : result.length
      result = result.slice(0, start) + block.body + "\n" + result.slice(end)
    }
  }
  return result
}

/**
 * purify_patch — section-level patch for an existing session.
 *
 * Puts the full AISP in the system prompt (prompt-cached) and sends only
 * the changed section as new tokens. Returns a section-level English snippet,
 * not the full document. Updates session.aisp_current after a successful patch.
 */
export async function runPatchPipeline(
  sessionId: string,
  section: string,
  hint: string | undefined,
  format: string,
  opts: LLMOpts & { streamTo?: NodeJS.WritableStream },
): Promise<PatchResult> {
  const session = getSession(sessionId)
  if (!session.aisp_current) {
    throw new Error("Session has no AISP — call purify_run first")
  }
  const resolved = resolveOpts(opts)
  const llmCallOpts = {
    baseUrl: resolved.baseUrl,
    openaiUser: resolved.openaiUser,
    insecure: resolved.insecure,
  }

  // Phase 1: Generate patch (cheapModel)
  // Full AISP lives in the system prompt → Anthropic caches it across calls
  const patchSystemPrompt = `${session.systemPrompt}\n\n## CURRENT AISP\n\n${session.aisp_current}`
  const patchRaw = await callLLMRepl(
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    patchSystemPrompt,
    [{ role: "user", content: buildPatchRequestContent(section, hint) }],
    undefined,
    llmCallOpts,
  )

  const blocks = parseAispBlocks(patchRaw)
  if (blocks.length === 0) {
    throw new Error(
      "No AISP blocks found in patch response — use purify_update for full rewrites",
    )
  }

  // Phase 2: Splice (no LLM)
  const updatedAisp = spliceAispBlocks(session.aisp_current, blocks)

  // Phase 3: Contradiction detection on full updated AISP
  const contradictions = await detectContradictions(
    updatedAisp,
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    llmCallOpts,
  )

  if (contradictions.length > 0) {
    return {
      session_id: session.id,
      status: "has_contradictions",
      aisp_patch: blocks,
      contradictions,
    }
  }

  // Phase 4: Translate only the patch (mainModel)
  // Updated AISP in system prompt → also cached
  const translateSystemPrompt = `${session.systemPrompt}\n\n## UPDATED AISP\n\n${updatedAisp}`
  const purifiedSection = await callLLMRepl(
    resolved.provider,
    resolved.apiKey,
    resolved.mainModel,
    translateSystemPrompt,
    [{ role: "user", content: buildPatchTranslateContent(patchRaw, format) }],
    opts.streamTo,
    llmCallOpts,
  )

  // Persist updated AISP in session for subsequent patches
  session.aisp_current = updatedAisp
  saveSession(session)

  return {
    session_id: session.id,
    status: "ready",
    aisp_patch: blocks,
    purified_section: purifiedSection,
  }
}

// ── purify_init ────────────────────────────────────────────────────────────────

export async function initContext(
  filePaths: string[],
  opts: LLMOpts,
): Promise<{ context_file: string; summary: string }> {
  const resolved = resolveOpts(opts)

  const fileContents: string[] = []
  const readErrors: string[] = []

  for (const filePath of filePaths) {
    try {
      const content = readFileSync(filePath, "utf8")
      fileContents.push(`=== FILE: ${filePath} ===\n${content}`)
    } catch (err) {
      readErrors.push(`${filePath}: ${(err as Error).message}`)
    }
  }

  if (fileContents.length === 0) {
    const errMsg =
      readErrors.length > 0
        ? `Could not read any files:\n${readErrors.join("\n")}`
        : "No files provided"
    throw new Error(errMsg)
  }

  let userContent = fileContents.join("\n\n")
  if (readErrors.length > 0) {
    userContent += `\n\nNote: The following files could not be read:\n${readErrors.join("\n")}`
  }

  const raw = await callLLMRepl(
    resolved.provider,
    resolved.apiKey,
    resolved.mainModel,
    INIT_SYSTEM,
    [{ role: "user", content: userContent }],
    undefined,
    { baseUrl: resolved.baseUrl, openaiUser: resolved.openaiUser, insecure: resolved.insecure },
  )

  try {
    return parseJSON<{ context_file: string; summary: string }>(raw)
  } catch {
    return {
      context_file: raw,
      summary: `Extracted context from ${fileContents.length} file(s): ${filePaths.join(", ")}`,
    }
  }
}
