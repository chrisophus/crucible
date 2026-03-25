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
  buildPatchRequestContent,
  buildPatchTranslateContent,
  buildPurifyTurnContent,
  buildTranslateTurnContent,
  buildUpdateTurnContent,
  CONTRADICTION_DETECTION_SYSTEM,
  getSessionSystemPrompt,
  INIT_SYSTEM,
} from "./prompts.ts"
import {
  callLLMRepl,
  DEFAULT_CHEAP_MODELS,
  DEFAULT_MODELS,
} from "./providers.ts"
import { createSession, getSession, saveSession } from "./sessions.ts"
import type {
  AispBlock,
  Config,
  ContextFile,
  Contradiction,
  ConvMessage,
  Gap,
  PatchResult,
  PipelineValidationResult,
  Provider,
  PurifyRunResult,
  QualityTier,
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

/** Strip markdown code fences that models sometimes wrap AISP output in. */
function stripFences(raw: string): string {
  return raw.replace(/^```[^\n]*\n([\s\S]*?)```/gm, "$1").trim()
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

function resolveApiKey(provider: Provider): string {
  const envVars: Record<Provider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
  }
  const key = process.env[envVars[provider]]
  if (!key)
    throw new Error(`${envVars[provider]} environment variable is not set`)
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
  debug?: boolean
  veryVerbose?: boolean
}

interface ResolvedOpts {
  provider: Provider
  mainModel: string
  cheapModel: string
  apiKey: string
  baseUrl?: string
  openaiUser?: string
  insecure?: boolean
  debug?: boolean
  veryVerbose?: boolean
}

function resolveOpts(opts: LLMOpts): ResolvedOpts {
  const provider = (opts.provider ??
    (process.env.PURIFY_PROVIDER as Provider | undefined) ??
    "anthropic") as Provider
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
    debug: opts.debug,
    veryVerbose: opts.veryVerbose,
  }
}

// ── Phase 2: External validator ────────────────────────────────────────────────

async function detectContradictions(
  session: Session,
  provider: Provider,
  apiKey: string,
  model: string,
  llmOpts: {
    baseUrl?: string
    openaiUser?: string
    insecure?: boolean
    debug?: boolean
    veryVerbose?: boolean
  },
): Promise<Contradiction[]> {
  try {
    const messages: ConvMessage[] = [
      ...session.messages,
      {
        role: "user",
        content:
          "Analyze the AISP document above for logical contradictions. " +
          CONTRADICTION_DETECTION_SYSTEM,
      },
    ]
    const raw = await callLLMRepl(
      provider,
      apiKey,
      model,
      session.systemPrompt,
      messages,
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
  session: Session,
  provider: Provider,
  apiKey: string,
  cheapModel: string,
  llmOpts: {
    baseUrl?: string
    openaiUser?: string
    insecure?: boolean
    debug?: boolean
    veryVerbose?: boolean
  },
  contradictionDetection: import("./types.ts").ContradictionDetection = "on_low_score",
  externalValidation: import("./types.ts").ExternalValidation = "never",
  scoreThreshold: import("./types.ts").QualityTier = "◊",
): Promise<PipelineValidationResult> {
  const aisp = session.aisp_current ?? ""
  const selfReport = parseEvidence(aisp)
  const phi = parsePhi(aisp)

  // External validator: gate on configured mode using self-reported score for "on_low_score".
  const selfDelta = selfReport.delta ?? 0
  const selfTau = computeTier(selfDelta, phi)
  const shouldRunValidator =
    externalValidation === "always" ||
    (externalValidation === "on_low_score" &&
      tierBelow(selfTau, scoreThreshold))

  const validatorResult = shouldRunValidator ? await runValidator(aisp) : null
  const delta = validatorResult?.delta ?? selfDelta
  const tau = validatorResult ? computeTier(delta, phi) : selfTau
  const scores: Scores = { delta, phi, tau }
  const gaps = computeGaps(validatorResult, scores)

  // Contradiction detection is an LLM call — gate it on the configured mode.
  let contradictions: Contradiction[] = []
  if (contradictionDetection === "always") {
    contradictions = await detectContradictions(
      session,
      provider,
      apiKey,
      cheapModel,
      llmOpts,
    )
  } else if (contradictionDetection === "on_low_score") {
    if (tierBelow(tau, scoreThreshold)) {
      contradictions = await detectContradictions(
        session,
        provider,
        apiKey,
        cheapModel,
        llmOpts,
      )
    }
  }
  // "never" → contradictions stays []

  return { scores, contradictions, gaps }
}

// ── Context tracking ─────────────────────────────────────────────────────────

/**
 * Add context files to an existing session for use in subsequent turns.
 * Context is stored on the session and merged into the next user turn,
 * rather than injected as a synthetic conversation pair.
 */
export function addContextToSession(
  sessionId: string,
  files: ContextFile[],
): void {
  if (!files.length) return
  const session = getSession(sessionId)
  session.contextFiles = [...(session.contextFiles ?? []), ...files]
  saveSession(session)
}

// ── Phase 1: Purify (English → AISP) ──────────────────────────────────────────

async function runPhase1(
  session: Session,
  text: string,
  resolved: ResolvedOpts,
  contextFiles?: ContextFile[],
): Promise<string> {
  const userContent = buildPurifyTurnContent(text, contextFiles)
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
      debug: resolved.debug,
      veryVerbose: resolved.veryVerbose,
    },
  )

  const cleanAisp = stripFences(aisp)
  session.messages.push({ role: "assistant", content: cleanAisp })
  session.aisp_current = cleanAisp
  saveSession(session)
  return cleanAisp
}

// ── Phase 3: Contradiction check ──────────────────────────────────────────────

function checkContradictions(
  validation: PipelineValidationResult,
  config: Config,
): Contradiction[] | null {
  if (validation.contradictions.length > 0 && config.ask_on_contradiction) {
    return validation.contradictions
  }
  return null
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
      debug: resolved.debug,
      veryVerbose: resolved.veryVerbose,
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
  contextFiles: ContextFile[],
  config: Config,
  opts: LLMOpts,
  fromAisp = false,
): Promise<PurifyRunResult> {
  const resolved = resolveOpts(opts)
  const session = createSession(getSessionSystemPrompt(), config)
  if (contextFiles.length > 0) {
    session.contextFiles = contextFiles
  }

  if (fromAisp) {
    // Input is already AISP — seed session directly
    session.aisp_current = text
    session.messages.push(
      {
        role: "user",
        content: buildPurifyTurnContent(
          text,
          contextFiles.length > 0 ? contextFiles : undefined,
        ),
      },
      { role: "assistant", content: text },
    )
    saveSession(session)
  } else {
    await runPhase1(
      session,
      text,
      resolved,
      contextFiles.length > 0 ? contextFiles : undefined,
    )
  }

  const validation = await computeValidationResult(
    session,
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    {
      baseUrl: resolved.baseUrl,
      openaiUser: resolved.openaiUser,
      insecure: resolved.insecure,
      debug: resolved.debug,
      veryVerbose: resolved.veryVerbose,
    },
    session.config.contradiction_detection,
    session.config.external_validation,
    session.config.score_threshold,
  )

  const contradictions = checkContradictions(validation, session.config)
  if (contradictions) {
    return {
      session_id: session.id,
      status: "has_contradictions",
      aisp: session.aisp_current,
      contradictions,
      scores: validation.scores,
    }
  }

  return {
    session_id: session.id,
    status: "ready",
    aisp: session.aisp_current,
    scores: validation.scores,
  }
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
  config: Config,
  opts: LLMOpts,
): Promise<PurifyRunResult> {
  const prev = getSession(sessionId)
  const resolved = resolveOpts(opts)

  // Seed new session with previous conversation (context already lives in prev.messages)
  const newSession = createSession(prev.systemPrompt, config)
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
    {
      baseUrl: resolved.baseUrl,
      openaiUser: resolved.openaiUser,
      insecure: resolved.insecure,
      debug: resolved.debug,
      veryVerbose: resolved.veryVerbose,
    },
  )

  const cleanUpdatedAisp = stripFences(updatedAisp)
  newSession.messages.push({
    role: "assistant" as const,
    content: cleanUpdatedAisp,
  })
  newSession.aisp_current = cleanUpdatedAisp
  saveSession(newSession)

  const validation = await computeValidationResult(
    newSession,
    resolved.provider,
    resolved.apiKey,
    resolved.cheapModel,
    {
      baseUrl: resolved.baseUrl,
      openaiUser: resolved.openaiUser,
      insecure: resolved.insecure,
      debug: resolved.debug,
      veryVerbose: resolved.veryVerbose,
    },
    newSession.config.contradiction_detection,
    newSession.config.external_validation,
    newSession.config.score_threshold,
  )

  const contradictions = checkContradictions(validation, newSession.config)
  if (contradictions) {
    return {
      session_id: newSession.id,
      status: "has_contradictions",
      aisp: newSession.aisp_current,
      contradictions,
      scores: validation.scores,
    }
  }

  return {
    session_id: newSession.id,
    status: "ready",
    aisp: newSession.aisp_current,
    scores: validation.scores,
  }
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
    const headerMatch = part.match(
      /^--\s*BLOCK:\s*([^|]+)\|\s*v=(\d+)\s*\|\s*delta=(.+)$/m,
    )
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
    const markerRe = new RegExp(
      `--\\s*BLOCK:\\s*${escapeRegex(block.name)}[^\\n]*\\n`,
      "m",
    )
    const match = markerRe.exec(result)
    if (!match) {
      // Block marker not in AISP — append
      result = `${result}\n\n${block.body}`
    } else {
      const start = match.index
      const afterMarker = start + match[0].length
      const nextMatch = /--\s*BLOCK:/m.exec(result.slice(afterMarker))
      const end = nextMatch ? afterMarker + nextMatch.index : result.length
      result = `${result.slice(0, start) + block.body}\n${result.slice(end)}`
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
    debug: resolved.debug,
    veryVerbose: resolved.veryVerbose,
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

  // Phase 3: Contradiction detection on full updated AISP.
  // Build a temporary session snapshot with the updated AISP so
  // detectContradictions can reference it from conversation history.
  const patchSession: Session = {
    ...session,
    messages: [
      ...session.messages,
      { role: "assistant", content: updatedAisp },
    ],
    aisp_current: updatedAisp,
  }
  const contradictions = await detectContradictions(
    patchSession,
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
    {
      baseUrl: resolved.baseUrl,
      openaiUser: resolved.openaiUser,
      insecure: resolved.insecure,
      debug: resolved.debug,
      veryVerbose: resolved.veryVerbose,
    },
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
