/**
 * Core implementations for the new purify MCP tools:
 * purify_reflect, purify_translate, purify_clarify, purify_update, purify_init
 */

import { readFileSync } from "node:fs"
import {
  CLARIFICATION_EXTRACTION_SYSTEM,
  CLARIFY_SYSTEM,
  CONTRADICTION_DETECTION_SYSTEM,
  INIT_SYSTEM,
  REFLECT_SYSTEM,
  TRANSLATE_FIDELITY_SYSTEM,
  UPDATE_SYSTEM,
} from "./prompts.ts"
import { callLLM, callLLMWithTools, DEFAULT_CHEAP_MODELS, DEFAULT_MODELS } from "./providers.ts"
import type {
  Clarification,
  Contradiction,
  Provider,
  QualityTier,
  ReflectionResult,
  Scores,
  TranslationResult,
  UpdateResult,
} from "./types.ts"
import { parseEvidence, runValidator } from "./validator.ts"

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON<T>(text: string): T {
  const stripped = text.trim()
  // Strip markdown code fences if present
  const fenceMatch = stripped.match(/^```(?:json)?\s*\n([\s\S]+?)\n```\s*$/)
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]) as T
  }
  return JSON.parse(stripped) as T
}

function parsePhi(aisp: string): number {
  const phiMatch = aisp.match(/φ[≜=]\s*(\d+)/)
  return phiMatch ? Math.min(100, parseInt(phiMatch[1], 10)) : 65
}

function computeTier(delta: number, phi: number): QualityTier {
  if (delta >= 0.75 && phi >= 95) return "◊⁺⁺"
  if (delta >= 0.6 && phi >= 80) return "◊⁺"
  if (delta >= 0.4 && phi >= 65) return "◊"
  if (delta >= 0.2 && phi >= 40) return "◊⁻"
  return "⊘"
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
  provider?: Provider
  model?: string
  cheapModel?: string
  baseUrl?: string
  openaiUser?: string
  insecure?: boolean
}

function resolveOpts(opts: LLMOpts): {
  provider: Provider
  mainModel: string
  cheapModel: string
  apiKey: string
  baseUrl?: string
  openaiUser?: string
  insecure?: boolean
} {
  const provider = (opts.provider ?? (process.env.PURIFY_PROVIDER as Provider | undefined) ?? "anthropic") as Provider
  const mainModel = opts.model ?? process.env.PURIFY_MODEL ?? DEFAULT_MODELS[provider]
  const cheapModel = opts.cheapModel ?? process.env.PURIFY_MODEL_CHEAP ?? DEFAULT_CHEAP_MODELS[provider]
  const apiKey = resolveApiKey(provider)
  return { provider, mainModel, cheapModel, apiKey, baseUrl: opts.baseUrl, openaiUser: opts.openaiUser, insecure: opts.insecure }
}

async function detectContradictions(
  aisp: string,
  provider: Provider,
  apiKey: string,
  model: string,
  llmOpts: { baseUrl?: string; openaiUser?: string; insecure?: boolean },
): Promise<Contradiction[]> {
  try {
    const raw = await callLLM(provider, apiKey, model, CONTRADICTION_DETECTION_SYSTEM, aisp, llmOpts)
    const parsed = parseJSON<{ contradictions: Contradiction[] }>(raw)
    return parsed.contradictions ?? []
  } catch {
    return []
  }
}

async function extractClarifications(
  aisp: string,
  provider: Provider,
  apiKey: string,
  model: string,
  llmOpts: { baseUrl?: string; openaiUser?: string; insecure?: boolean },
): Promise<Clarification[]> {
  try {
    const raw = await callLLM(provider, apiKey, model, CLARIFICATION_EXTRACTION_SYSTEM, aisp, llmOpts)
    const parsed = parseJSON<{ clarifications: Clarification[] }>(raw)
    return parsed.clarifications ?? []
  } catch {
    return []
  }
}

async function computeScores(aisp: string): Promise<Scores> {
  const validatorResult = await runValidator(aisp)
  const selfReport = parseEvidence(aisp)
  const delta = validatorResult?.delta ?? selfReport.delta ?? 0
  const phi = parsePhi(aisp)
  const tau = computeTier(delta, phi)
  return { delta, phi, tau }
}

// ── purify_reflect ─────────────────────────────────────────────────────────────

export async function reflectText(
  text: string,
  context: string | undefined,
  opts: LLMOpts,
): Promise<ReflectionResult> {
  const { provider, mainModel, apiKey, baseUrl, openaiUser, insecure } = resolveOpts(opts)
  const userContent = context ? `CONTEXT:\n${context}\n\nTEXT:\n${text}` : text
  const raw = await callLLM(provider, apiKey, mainModel, REFLECT_SYSTEM, userContent, {
    baseUrl,
    openaiUser,
    insecure,
  })
  return parseJSON<ReflectionResult>(raw)
}

// ── purify_translate ───────────────────────────────────────────────────────────

export async function translateText(
  text: string,
  context: string | undefined,
  interpretation: string | undefined,
  opts: LLMOpts,
): Promise<TranslationResult> {
  const { provider, mainModel, cheapModel, apiKey, baseUrl, openaiUser, insecure } = resolveOpts(opts)
  const llmOpts = { baseUrl, openaiUser, insecure }

  // Build the English input for AISP generation
  let aispInput = text
  if (interpretation) {
    aispInput = `AUTHOR INTERPRETATION (corrected):\n${interpretation}\n\nORIGINAL TEXT:\n${text}`
  }
  if (context) {
    aispInput = `DOMAIN CONTEXT:\n${context}\n\n${aispInput}`
  }

  // Step 1: English → AISP
  let aisp: string
  if (provider === "anthropic") {
    aisp = await callLLMWithTools(apiKey, cheapModel, aispInput)
  } else {
    const { TO_AISP_SYSTEM } = await import("./prompts.ts")
    aisp = await callLLM(provider, apiKey, cheapModel, TO_AISP_SYSTEM, aispInput, llmOpts)
  }

  // Step 2: Compute scores
  const scores = await computeScores(aisp)

  // Step 3: Contradiction detection
  const contradictions = await detectContradictions(aisp, provider, apiKey, mainModel, llmOpts)

  // Step 4: Block purified output if contradictions exist
  if (contradictions.length > 0) {
    const clarifications = await extractClarifications(aisp, provider, apiKey, mainModel, llmOpts)
    return { aisp, purified: null, scores, contradictions, clarifications }
  }

  // Step 5: Extract clarifications
  const clarifications = await extractClarifications(aisp, provider, apiKey, mainModel, llmOpts)

  // Step 6: If score is too low (⊘), skip purified output
  if (scores.tau === "⊘") {
    return { aisp, purified: null, scores, contradictions, clarifications }
  }

  // Step 7: AISP → Purified English
  const purified = await callLLM(provider, apiKey, mainModel, TRANSLATE_FIDELITY_SYSTEM, aisp, llmOpts)

  return { aisp, purified, scores, contradictions, clarifications }
}

// ── purify_clarify ─────────────────────────────────────────────────────────────

export async function clarifyTranslation(
  aisp: string,
  context: string | undefined,
  answers: Array<{ question: string; answer: string }>,
  opts: LLMOpts,
): Promise<TranslationResult> {
  const { provider, mainModel, apiKey, baseUrl, openaiUser, insecure } = resolveOpts(opts)
  const llmOpts = { baseUrl, openaiUser, insecure }

  const answersBlock = answers.map((a, i) => `Q${i + 1}: ${a.question}\nA${i + 1}: ${a.answer}`).join("\n\n")
  const userContent = [
    context ? `DOMAIN CONTEXT:\n${context}` : "",
    `AISP:\n${aisp}`,
    `ANSWERS TO CLARIFYING QUESTIONS:\n${answersBlock}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  // Refine AISP with answers
  const updatedAisp = await callLLM(provider, apiKey, mainModel, CLARIFY_SYSTEM, userContent, llmOpts)

  const scores = await computeScores(updatedAisp)
  const contradictions = await detectContradictions(updatedAisp, provider, apiKey, mainModel, llmOpts)

  if (contradictions.length > 0) {
    const clarifications = await extractClarifications(updatedAisp, provider, apiKey, mainModel, llmOpts)
    return { aisp: updatedAisp, purified: null, scores, contradictions, clarifications }
  }

  const clarifications = await extractClarifications(updatedAisp, provider, apiKey, mainModel, llmOpts)

  if (scores.tau === "⊘") {
    return { aisp: updatedAisp, purified: null, scores, contradictions, clarifications }
  }

  const purified = await callLLM(provider, apiKey, mainModel, TRANSLATE_FIDELITY_SYSTEM, updatedAisp, llmOpts)

  return { aisp: updatedAisp, purified, scores, contradictions, clarifications }
}

// ── purify_update ──────────────────────────────────────────────────────────────

export async function updatePurified(
  existingPurified: string,
  existingAisp: string,
  change: string,
  context: string | undefined,
  opts: LLMOpts,
): Promise<UpdateResult> {
  const { provider, mainModel, apiKey, baseUrl, openaiUser, insecure } = resolveOpts(opts)
  const llmOpts = { baseUrl, openaiUser, insecure }

  const userContent = [
    context ? `DOMAIN CONTEXT:\n${context}` : "",
    `EXISTING_PURIFIED:\n${existingPurified}`,
    `EXISTING_AISP:\n${existingAisp}`,
    `CHANGE:\n${change}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  const raw = await callLLM(provider, apiKey, mainModel, UPDATE_SYSTEM, userContent, llmOpts)

  let parsed: { purified: string; aisp: string; diff: UpdateResult["diff"] }
  try {
    parsed = parseJSON(raw)
  } catch {
    // Fallback: treat entire response as updated purified text
    parsed = { purified: raw, aisp: existingAisp, diff: [] }
  }

  const updatedAisp = parsed.aisp ?? existingAisp
  const scores = await computeScores(updatedAisp)
  const contradictions = await detectContradictions(updatedAisp, provider, apiKey, mainModel, llmOpts)

  return {
    purified: parsed.purified,
    aisp: updatedAisp,
    scores,
    diff: parsed.diff ?? [],
    contradictions,
  }
}

// ── purify_init ────────────────────────────────────────────────────────────────

export async function initContext(
  filePaths: string[],
  opts: LLMOpts,
): Promise<{ context_file: string; summary: string }> {
  const { provider, mainModel, apiKey, baseUrl, openaiUser, insecure } = resolveOpts(opts)

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
    const errMsg = readErrors.length > 0 ? `Could not read any files:\n${readErrors.join("\n")}` : "No files provided"
    throw new Error(errMsg)
  }

  let userContent = fileContents.join("\n\n")
  if (readErrors.length > 0) {
    userContent += `\n\nNote: The following files could not be read:\n${readErrors.join("\n")}`
  }

  const raw = await callLLM(provider, apiKey, mainModel, INIT_SYSTEM, userContent, {
    baseUrl,
    openaiUser,
    insecure,
  })

  try {
    return parseJSON<{ context_file: string; summary: string }>(raw)
  } catch {
    return {
      context_file: raw,
      summary: `Extracted context from ${fileContents.length} file(s): ${filePaths.join(", ")}`,
    }
  }
}
