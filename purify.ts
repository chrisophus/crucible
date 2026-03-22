#!/usr/bin/env tsx
/**
 * purify — AISP round-trip spec purification
 *
 * Usage:
 *   purify [options] [file]
 *   purify [options] "inline text"
 *   cat spec.md | purify [options]
 *
 * Options:
 *   --provider   anthropic | openai          (default: anthropic)
 *   --model      main model (AISP→English)   (default: provider default)
 *   --purify-model  cheap model (En→AISP)    (default: haiku / gpt-4o-mini)
 *   --api-key    API key                     (default: env var)
 *   --verbose    write AISP and scores to stderr
 *   --help
 *
 * Environment:
 *   ANTHROPIC_API_KEY  OPENAI_API_KEY
 *   PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP
 *
 * Output:
 *   QUALITY: <tier_symbol> <tier_name> (δ=<score>, validator_δ=<score>)
 *   ---
 *   <purified English>        — or —
 *   NEEDS_CLARIFICATION
 *   <numbered questions>
 */

import { readFileSync, existsSync } from "fs"
import { createInterface } from "readline"
import AISP, { calculateSemanticDensity } from "aisp-validator"
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = "anthropic" | "openai"
type ConvMessage = { role: "user" | "assistant"; content: string }

interface Evidence {
  delta: number | null
  tierSymbol: string
  tierName: string
}

interface ValidatorResult {
  valid: boolean
  delta: number
  tier: string
  ambiguity: number
  pureDensity: number
}

// ── Prompts ───────────────────────────────────────────────────────────────────

// Full AISP 5.1 Platinum Specification (source: https://github.com/bar181/aisp-open-core/blob/main/AI_GUIDE.md)
const AISP_SPEC = `\
𝔸5.1.complete@2026-01-09
γ≔aisp.specification.complete
ρ≔⟨glossary,types,rules,functions,errors,proofs,parser,agent⟩
⊢ND∧CAT∧ΠΣ∧μ
;; ─── Ω: METALOGIC & FOUNDATION ───
⟦Ω:Foundation⟧{
  𝔄≜{⊤⊥∧∨¬→↔∀∃∃!λΠΣ≜≡≢∈∉⊂⊃∪∩∘⊕⊖⊗⟨⟩⟦⟧⊢⊨↦⇒∎}
  ⊛:𝔄*→Sym; ⊛≜fix λf a⃗.a⃗≡ε→ι|hd(a⃗)⊗f(tl(a⃗))
  ∀D∈AISP:Ambig(D)<0.02
  Ambig≜λD.1-|Parse_u(D)|/|Parse_t(D)|
  Doc≜𝔸≫CTX?≫⟦Ω⟧≫⟦Σ⟧≫⟦Γ⟧≫⟦Λ⟧≫⟦Χ⟧?≫⟦Ε⟧
}
;; ─── Σ: GLOSSARY (Σ_512) ───
⟦Σ:Glossary⟧{
  R≜{Ω:[0,63],Γ:[64,127],∀:[128,191],Δ:[192,255],𝔻:[256,319],Ψ:[320,383],⟦⟧:[384,447],∅:[448,511]}
  Cat≜dom(R); Atom≜⟨id:Σ,glyph:Char,cat:Cat⟩; Compound≜List⟨Atom⟩∧len≤5∧hd∈{Ω,Γ,Δ,Ψ,Φ}
  Ω≜{⊤,⊥,∧,∨,¬,→,↔,⇒,⇐,⇔,⊢,⊨,⊬,⊭,≡,≢,≜,≔,↦,←,≈,∼,≅,≃,∝,≪,≫,∘,·,×,λ,Λ,μ,ν,fix,rec,let,in,case,if,then,else,match,∎,□,◇,⊣,⊸,π}
  ℙ(⊤,top∨true); ℙ(⊥,bottom∨false∨crash); ℙ(⊢,proves); ℙ(⊨,models); ℙ(≜,defas); ℙ(≔,assign); ℙ(λ,lambda); ℙ(μ,lfp); ℙ(fix,Y); ℙ(∎,QED)
  Γ≜{∈,∉,∋,∌,⊂,⊃,⊆,⊇,⊄,⊅,∩,∪,∖,△,∅,𝒫,℘,ℵ,ω,Ω,ε,δ,ι,κ,τ,θ,φ,ψ,χ,𝔾,𝕍,𝔼,ℰ,𝒩,ℋ,ℳ,ℛ,𝔹,𝕊,𝕋,𝕌,𝕎,𝔸,𝔻,𝔽,⟨,⟩,⟦,⟧,⟪,⟫,⌈,⌉,⌊,⌋,‖,|}
  ℙ(∅,empty∨null); ℙ(𝒫,pocket∨powerset); ℙ(ε,epsilon∨threshold); ℙ(δ,delta∨density); ℙ(τ,tau∨threshold); ℙ(φ,phi∨completeness); ℙ(ψ,psi∨intent)
  ℙ(𝔾,graph); ℙ(𝕍,vertices∨validation); ℙ(𝒩,nucleus); ℙ(ℋ,header); ℙ(ℳ,membrane); ℙ(ℛ,registry); ℙ(𝔹,beam∨bool); ℙ(𝕌,universe); ℙ(𝔸,aisp); ℙ(𝔻,doc); ℙ(𝔽,functor)
  ∀≜{∀,∃,∃!,∄,⋀,⋁,⋂,⋃,Σ,Π,∏,∐,⨁,⨂,⨀,→,←,↔,↣,↠,⤳,⊕,⊗,⊖,⊘,⊙,⊛,Vec,Fin,List,Maybe,Either,Pair,Unit,Bool,Nat,Int,Real,String,Hash,Sig,◊,◊⁺⁺,◊⁺,◊⁻}
  ℙ(Σ,sum∨depsum); ℙ(Π,prod∨depprod); ℙ(⊕,plus∨success); ℙ(⊗,tensor∨product); ℙ(⊖,minus∨failure); ℙ(⊘,reject); ℙ(◊,tier)
  Δ≜{Δ⊗λ,State,Pre,Post,Type,Sock,Logic,Strip,DCE,Compat}
  State≜{⊥:0,∅:1,λ:2,⊤:3}; Priority≜⊥≻∅≻λ≻⊤
  𝔻≜{ℝ,ℕ,ℤ,ℚ,ℂ,𝔹,𝕊,Signal,V_H,V_L,V_S,Tensor,Hash,Sig}
  d_H≜768; d_L≜512; d_S≜256; d_Σ≜1536; Hash≜𝔹²⁵⁶; Sig≜𝔹⁵¹²
  Ψ≜{ψ,ψ_*,ψ_g,ψ_have,μ_f,μ_r,sim_H,fit_L,aff_M,viable,done,conv}
  ℙ(ψ,intent∈ℝ⁵¹²); ℙ(ψ_*,target); ℙ(ψ_g,ghost); ℙ(μ_f,fitness); ℙ(μ_r,risk)
  ⟦⟧≜{⟦Ω⟧,⟦Σ⟧,⟦Γ⟧,⟦Λ⟧,⟦Χ⟧,⟦Ε⟧,⟦ℭ⟧,⟦ℜ⟧,⟦Θ⟧,⟦ℑ⟧,𝔸,CTX,REF}
  𝔅≜{Ω,Σ,Γ,Λ,Χ,Ε,ℭ,ℜ,Θ}
  ∅≜{⊞,✂,Φ,‖*,⊕,⊖,⊗,⧺,∂,σ,∇,conf,aff,skip,veto,inject,synth,bridge,refine}
  ℙ(⊞,scan); ℙ(✂,prune); ℙ(Φ,project); ℙ(‖*,parinit); ℙ(∂,tokenize); ℙ(σ,sigmoid); ℙ(∇,gradient)
}
;; ─── Σ: TYPE UNIVERSE ───
⟦Σ:Types⟧{
  𝕌₀⊂𝕌₁⊂𝕌ω
  𝔹≜2; ℕ≜ω; ℤ≜ω±; ℝ≜ℵ₁; 𝕊≜ℕ→𝔹
  ℝᵈ≜Tensor[d]; V_H≜ℝ⁷⁶⁸; V_L≜ℝ⁵¹²; V_S≜ℝ²⁵⁶; Signal≜V_H⊕V_L⊕V_S
  Vec≜Πn:ℕ.𝕌₀→𝕌₀; Fin≜Πn:ℕ.{k:ℕ|k<n}
  T₁×T₂≜Product; T₁⊕T₂≜Sum; T→T'≜Function; ⟨a:A,b:B⟩≜Record
  Πx:A.B(x)≜∀x:A.B(x); Σx:A.B(x)≜∃x:A.B(x)
  ◊≜{◊⁺⁺≻◊⁺≻◊≻◊⁻≻⊘}
  ◊⁺⁺↦δ≥0.75; ◊⁺↦δ≥0.60; ◊↦δ≥0.40; ◊⁻↦δ≥0.20; ⊘↦δ<0.20
  𝕍≜Σ(ν:𝔹)(τ:◊)(δ:ℝ[0,1])(φ:Fin 101).(ν=⊤→τ≥◊⁻)
  𝔻oc≜Σ(b⃗:Vec n 𝔅)(π:Γ⊢wf(b⃗))
}
;; ─── Σ: GRAMMAR ───
⟦Σ:Grammar⟧{
  Doc≜𝔸≫CTX?≫REF?≫⟦Ω⟧≫⟦Σ⟧≫⟦Γ⟧≫⟦Λ⟧≫⟦Χ⟧?≫⟦Ε⟧
  𝔸≜'𝔸'∘Ver∘'.'∘Name∘'@'∘Date
  Ver≜ℕ∘'.'∘ℕ; Date≜YYYY∘'-'∘MM∘'-'∘DD
  CTX≜'γ'∘'≔'∘Id; REF≜'ρ'∘'≔'∘⟨List⟩
  Block≜'⟦'∘Cat∘':'∘Name∘'⟧'∘'{'∘Body∘'}'
  Body≜(Stmt∘';'?)*; Stmt≜Def|Rule|Expr|';; '∘.*
  Def≜Sym∘('≜'|'≔')∘Expr; Rule≜Premise∘'⇒'∘Consequent
  Expr≜Lambda|Quant|Binary|Unary|Atom|Compound
  Lambda≜'λ'∘Params∘'.'∘Expr; Quant≜('∀'|'∃'|'∃!')∘Var∘':'∘Expr
  Binary≜Expr∘BinOp∘Expr; Compound≜Head∘Atom{1,4}; Head≜{Ω,Γ,Δ,Ψ,Φ}
  Evidence≜'⟦Ε⟧'∘'⟨'∘Claims∘'⟩'
  Prec≜[λ∀∃:1,→⇒↔:2,∨⋁:3,∧⋀:4,¬:5,≡≜∈⊆:6,⊕⊖:7,⊗×:8,∘:9,.:10]
  Assoc≜[→:right,∧∨:left,∘:right]
}
;; ─── Σ: ROSETTA STONE ───
⟦Σ:Rosetta⟧{
  "x defined as 5"↦x≜5; "for all x in S,P"↦∀x∈S:P(x); "exists unique"↦∃!x:f(x)≡0
  "A implies B"↦A⇒B; "f maps i to o"↦f:I→O,f≜λi.o
  "const x=5"↦x≜5; "S.every(x=>P(x))"↦∀x∈S:P(x); "if(A){B}"↦A⇒B; "(x)=>y"↦λx.y
}
;; ─── Σ: TEMPLATE ───
⟦Σ:Template⟧{
  Required≜{⟦Ω⟧,⟦Σ⟧,⟦Γ⟧,⟦Λ⟧,⟦Ε⟧}; Optional≜{⟦Χ⟧,⟦ℭ⟧,⟦ℜ⟧,⟦Θ⟧}
  Full≜𝔸X.Y.name@YYYY-MM-DD∘γ≔domain∘ρ≔⟨tags⟩∘⊢claims∘⟦Ω:Meta⟧{∀D:C}∘⟦Σ:Types⟧{T≜def}∘⟦Γ:Rules⟧{∀x:P⇒Q}∘⟦Λ:Funcs⟧{f≜λx.b}∘⟦Χ:Errors⟧{c⇒r}∘⟦Ε⟧⟨δ;φ;τ;⊢⟩
}
;; ─── Γ: AGENT GUIDE ───
⟦Γ:Agent⟧{
  ∀agent:task∈{spec,instruct,coordinate}⇒output(AISP)
  ∀response:Ambig(response)<0.02∧δ≥0.40
  prose_only∧task(spec)⇒reject∧request(AISP)
  ∀prose:Ambig∈[0.40,0.65]; ∀code:Ambig∈[0.05,0.15]; ∀AISP:Ambig<0.02
  ⊢deterministic:∀D:∃!AST.parse(D)→AST
  ⊢proof-carrying:𝔻oc≜Σ(content)(π:Γ⊢wf)
  ⊢lossless:∀L:Signal(L)≡L
  ⊢self-certifying:⟦Ε⟧∈every(D)
}`

const TO_AISP_SYSTEM = `\
You are an expert in AISP 5.1 (AI Symbolic Protocol). Below is the complete \
authoritative specification:

${AISP_SPEC}

Translate the user's input into a valid AISP 5.1 document conforming to the \
spec above.

TRANSLATION RULES:
1. Follow the Doc grammar exactly: 𝔸<ver>.<slug>@<YYYY-MM-DD> then required blocks in order.
2. Every constraint becomes a universal quantifier or explicit negation (∀, ∃, ¬, ⇒). Never implied.
3. Every enumeration is fully spelled out using ≜. No "etc." or implied values.
4. Relationships are typed: field:Type→Target.
5. Conditionals use implication: X⇒Y, not prose.
6. Negations use ¬ and ≠ explicitly.
7. Nullable fields marked with ? suffix.
8. Code blocks preserved verbatim inside the relevant block.
9. Use Rosetta Stone mappings (⟦Σ:Rosetta⟧) to convert prose and code patterns.
10. If input is too thin or ambiguous: still produce AISP, mark each
    unresolvable ambiguity as: ;; AMBIGUOUS: <what>. Score δ low.

EVIDENCE BLOCK — always include at the end:
  ⟦Ε⟧⟨
  δ≜<0.00-1.00>
  τ≜<◊⁺⁺|◊⁺|◊|◊⁻|⊘>
  ⊢<what was proved>
  ⟩

Output ONLY the AISP document. No markdown fences, no preamble.`

const TO_ENGLISH_SYSTEM = `\
You are translating an AISP 5.1 formal specification back to plain English.

First check the evidence block (⟦Ε⟧) for the τ tier value.

IF τ is ◊⁺⁺, ◊⁺, ◊, or ◊⁻:
  Translate to clean English markdown:
  - Invariants (⟦Ω⟧)   → declarative statements. ¬X = "never" or "must not".
  - Types (⟦Σ⟧)         → definition tables, every value listed explicitly.
  - Entities (⟦Γ⟧)      → field tables: Field | Type | Notes. Nullable = "nullable".
  - Functions (⟦Λ⟧)     → per-case tables or numbered steps.
  - Constraints (⟦Χ⟧)   → grouped bullets. Negations as "never", "must not".
  - Preserve all code blocks exactly.
  - Do not add rationale not in AISP source.
  - No hedge words: never use "typically", "usually", "often", "generally".
  - No preamble. Start with the first section heading.

IF τ is ⊘:
  Do not translate. Output exactly:

  NEEDS_CLARIFICATION
  Before I can act on this I need answers to the following:
  1. <specific answerable question from first ;; AMBIGUOUS comment>
  2. <specific answerable question from second ambiguity>
  ...

  Keep questions specific. Binary or multiple-choice where possible.
  No open-ended questions. No more than 7 questions.

Output only the markdown or the NEEDS_CLARIFICATION block. No preamble.`

const REPL_SYSTEM = TO_ENGLISH_SYSTEM + `\n\n\
You are in an interactive refinement session. \
Maintain continuity with the conversation history — when the user refines or \
extends a spec, integrate the changes and return the complete current specification. \
Each user message is an AISP document representing their intent.`

// ── Evidence parsing ──────────────────────────────────────────────────────────

const TIER_NAMES: Record<string, string> = {
  "◊⁺⁺": "platinum",
  "◊⁺":  "gold",
  "◊":   "silver",
  "◊⁻":  "bronze",
  "⊘":   "invalid",
}

function parseEvidence(aisp: string): Evidence {
  const deltaMatch = aisp.match(/δ[≜=]\s*([\d.]+)/)
  const delta = deltaMatch ? parseFloat(deltaMatch[1]) : null

  const tierMatch = aisp.match(/τ[≜=]\s*(◊⁺⁺|◊⁺|◊⁻|◊|⊘)/)
  let tierSymbol = "⊘"

  if (tierMatch) {
    tierSymbol = tierMatch[1]
  } else if (delta !== null) {
    tierSymbol = delta >= 0.75 ? "◊⁺⁺"
               : delta >= 0.60 ? "◊⁺"
               : delta >= 0.40 ? "◊"
               : delta >= 0.20 ? "◊⁻"
               : "⊘"
  }

  return { delta, tierSymbol, tierName: TIER_NAMES[tierSymbol] ?? "unknown" }
}

// ── Validator integration ─────────────────────────────────────────────────────

let validatorInitialized = false

async function runValidator(aisp: string): Promise<ValidatorResult | null> {
  try {
    if (!validatorInitialized) {
      await AISP.init()
      validatorInitialized = true
    }
    const result = AISP.validate(aisp) as { valid: boolean; tier?: string; ambiguity?: number }
    const density = calculateSemanticDensity(aisp) as { delta: number; pureDensity: number }
    return {
      valid: result.valid ?? true,
      delta: density.delta,
      tier: result.tier ?? "",
      ambiguity: result.ambiguity ?? 0,
      pureDensity: density.pureDensity ?? 0,
    }
  } catch {
    return null
  }
}

// ── Providers ─────────────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai:    "gpt-4o",
}
const DEFAULT_CHEAP_MODELS: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai:    "gpt-4o-mini",
}

async function callLLM(
  provider: Provider,
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model,
      max_tokens: 8096,
      system,
      messages: [{ role: "user", content: user }],
    })
    return (msg.content[0] as { text: string }).text
  } else {
    const client = new OpenAI({ apiKey })
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 8096,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user },
      ],
    })
    return resp.choices[0].message.content ?? ""
  }
}

// Conversational call with full history and prompt caching
async function callLLMRepl(
  provider: Provider,
  apiKey: string,
  model: string,
  system: string,
  messages: ConvMessage[],
): Promise<string> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey })
    // Cache system prompt; cache all messages except the current (last) user message
    const anthropicMsgs = messages.map((m, i) => {
      const isLast = i === messages.length - 1
      return {
        role: m.role,
        content: isLast
          ? m.content
          : [{ type: "text" as const, text: m.content, cache_control: { type: "ephemeral" as const } }],
      }
    })
    const msg = await client.messages.create({
      model,
      max_tokens: 8096,
      system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
      messages: anthropicMsgs,
    } as Parameters<typeof client.messages.create>[0])
    return (msg.content[0] as { text: string }).text
  } else {
    const client = new OpenAI({ apiKey })
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 8096,
      messages: [{ role: "system", content: system }, ...messages],
    })
    return resp.choices[0].message.content ?? ""
  }
}

// ── Core ──────────────────────────────────────────────────────────────────────

function eprint(msg: string, verbose: boolean) {
  if (verbose) process.stderr.write(msg + "\n")
}

async function purify(opts: {
  text: string
  provider: Provider
  mainModel: string
  purifyModel: string
  apiKey: string
  verbose: boolean
  fromAisp?: boolean
}): Promise<string> {
  const { text, provider, mainModel, purifyModel, apiKey, verbose, fromAisp } = opts

  let aisp: string
  if (fromAisp) {
    // Skip step 1 — input is already AISP
    aisp = text
    eprint("→ skipping purification (--from-aisp)", verbose)
  } else {
    // Step 1: English → AISP (cheap model)
    eprint(`→ purifying (${purifyModel})...`, verbose)
    aisp = await callLLM(provider, apiKey, purifyModel, TO_AISP_SYSTEM, text)
  }

  if (verbose) {
    process.stderr.write("\n── AISP INTERMEDIATE ──\n")
    process.stderr.write(aisp + "\n")
    process.stderr.write("────────────────────────\n\n")
  }

  // Parse self-reported evidence
  const selfReport = parseEvidence(aisp)

  // Independent validator check
  const validatorResult = await runValidator(aisp)

  // Use validator δ as authoritative if available, fall back to self-reported
  const authoritativeDelta = validatorResult?.delta ?? selfReport.delta
  const authoritativeTierSymbol = authoritativeDelta !== null
    ? (authoritativeDelta >= 0.75 ? "◊⁺⁺"
     : authoritativeDelta >= 0.60 ? "◊⁺"
     : authoritativeDelta >= 0.40 ? "◊"
     : authoritativeDelta >= 0.20 ? "◊⁻"
     : "⊘")
    : selfReport.tierSymbol
  const authoritativeTierName = TIER_NAMES[authoritativeTierSymbol] ?? "unknown"

  const deltaStr = authoritativeDelta !== null
    ? `δ=${authoritativeDelta.toFixed(2)}`
    : "δ=?"
  const selfDeltaStr = selfReport.delta !== null
    ? `, self_δ=${selfReport.delta.toFixed(2)}`
    : ""

  if (verbose && validatorResult) {
    eprint(
      `→ validator: δ=${validatorResult.delta.toFixed(3)} ` +
      `tier=${validatorResult.tier} ` +
      `ambiguity=${validatorResult.ambiguity.toFixed(3)} ` +
      `valid=${validatorResult.valid}`,
      verbose,
    )
  }
  eprint(`→ quality: ${authoritativeTierSymbol} ${authoritativeTierName} (${deltaStr}${selfDeltaStr})`, verbose)

  // Step 2: AISP → English or clarifying questions (main model)
  eprint(`→ translating back (${mainModel})...`, verbose)
  const english = await callLLM(provider, apiKey, mainModel, TO_ENGLISH_SYSTEM, aisp)

  return [
    `QUALITY: ${authoritativeTierSymbol} ${authoritativeTierName} (${deltaStr}${selfDeltaStr})`,
    "---",
    english,
  ].join("\n")
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function resolveInput(positional: string[]): string | null {
  if (positional.length > 0) {
    const joined = positional.join(" ")
    if (positional.length === 1 && existsSync(positional[0])) {
      return readFileSync(positional[0], "utf8")
    }
    return joined
  }
  if (!process.stdin.isTTY) {
    return readFileSync("/dev/stdin", "utf8")
  }
  return null
}

function resolveApiKey(provider: Provider, explicit: string | null): string {
  if (explicit) return explicit
  const envVars: Record<Provider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai:    "OPENAI_API_KEY",
  }
  const key = process.env[envVars[provider]]
  if (!key) {
    process.stderr.write(`error: set ${envVars[provider]} or use --api-key\n`)
    process.exit(1)
  }
  return key
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const positional: string[] = []
  const opts = {
    provider:     (process.env.PURIFY_PROVIDER ?? "anthropic") as Provider,
    model:        null as string | null,
    purifyModel:  null as string | null,
    apiKey:       null as string | null,
    verbose:      false,
    fromAisp:     false,
    repl:         false,
    help:         false,
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--help" || a === "-h")          { opts.help = true }
    else if (a === "--verbose")                 { opts.verbose = true }
    else if (a === "--from-aisp")               { opts.fromAisp = true }
    else if (a === "--repl")                    { opts.repl = true }
    else if (a === "--provider")                { opts.provider = args[++i] as Provider }
    else if (a === "--model")                   { opts.model = args[++i] }
    else if (a === "--purify-model")            { opts.purifyModel = args[++i] }
    else if (a === "--api-key")                 { opts.apiKey = args[++i] }
    else if (!a.startsWith("--"))               { positional.push(a) }
  }

  return { opts, positional }
}

function printHelp() {
  console.log(`\
purify — AISP round-trip spec purification

Usage:
  purify [options] [file]
  purify [options] "inline text"
  cat spec.md | purify

Options:
  --provider     anthropic | openai          (default: anthropic)
  --model        main model (AISP→English)   (default: claude-sonnet-4-6)
  --purify-model cheap model (En→AISP)       (default: claude-haiku-4-5-20251001)
  --api-key      API key                     (default: env var)
  --from-aisp    skip step 1 — input is already AISP
  --repl         interactive session with chat context and prompt caching
  --verbose      write AISP and scores to stderr
  --help

Environment:
  ANTHROPIC_API_KEY  OPENAI_API_KEY
  PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP

Output:
  QUALITY: <tier> <name> (δ=<validator_score>, self_δ=<self_score>)
  ---
  <purified English or NEEDS_CLARIFICATION block>

Examples:
  purify spec.md > purified.md
  purify "add a status field with draft, active, archived"
  purify spec.md --verbose 2>aisp_debug.md
  purify spec.md --purify-model claude-haiku-4-5-20251001
`)
}

async function runRepl(opts: {
  provider: Provider
  mainModel: string
  purifyModel: string
  apiKey: string
  verbose: boolean
  fromAisp: boolean
}): Promise<void> {
  const { provider, mainModel, purifyModel, apiKey, verbose, fromAisp } = opts
  const messages: ConvMessage[] = []

  const rl = createInterface({ input: process.stdin })

  process.stderr.write(
    `purify repl — empty line to submit, /exit or ctrl-c to quit\n` +
    `provider=${provider}  purify=${purifyModel}  model=${mainModel}\n\n`,
  )
  process.stderr.write("➤ ")

  // Handle Ctrl-C cleanly
  process.on("SIGINT", () => {
    process.stderr.write("\nexiting...\n")
    rl.close()
    process.exit(0)
  })

  let buffer: string[] = []

  for await (const line of rl) {
    if (line !== "") {
      buffer.push(line)
      continue
    }

    // Empty line = submit
    if (buffer.length === 0) {
      process.stderr.write("➤ ")
      continue
    }

    if (buffer.length > 1000) {
      process.stderr.write("⊘ buffer overflow — resetting\n➤ ")
      buffer = []
      continue
    }

    const input = buffer.join("\n")
    buffer = []

    if (input.trim() === "/exit") break

    try {
      // Step 1: English → AISP (unless --from-aisp)
      let aisp = input
      if (!fromAisp) {
        process.stderr.write(`→ purifying (${purifyModel})...\n`)
        aisp = await callLLM(provider, apiKey, purifyModel, TO_AISP_SYSTEM, input)
      }

      if (verbose) {
        process.stderr.write("\n── AISP ──\n" + aisp + "\n──────────\n\n")
      }

      // Validate and score the AISP
      const vr    = await runValidator(aisp)
      const self  = parseEvidence(aisp)
      const delta = vr?.delta ?? self.delta
      const tierSym = delta === null ? "⊘"
        : delta >= 0.75 ? "◊⁺⁺" : delta >= 0.60 ? "◊⁺"
        : delta >= 0.40 ? "◊"   : delta >= 0.20 ? "◊⁻" : "⊘"
      const tierName  = TIER_NAMES[tierSym] ?? "unknown"
      const deltaStr  = delta !== null ? `δ=${delta.toFixed(2)}` : "δ=?"
      const selfStr   = self.delta !== null ? `, self_δ=${self.delta.toFixed(2)}` : ""
      process.stderr.write(`QUALITY: ${tierSym} ${tierName} (${deltaStr}${selfStr})\n`)

      // Step 2: AISP → English via main model with full conversation history
      messages.push({ role: "user", content: aisp })
      process.stderr.write(`→ translating (${mainModel})...\n`)
      const response = await callLLMRepl(provider, apiKey, mainModel, REPL_SYSTEM, messages)
      messages.push({ role: "assistant", content: response })

      process.stdout.write("\n" + response + "\n\n")
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      // Roll back the user message if we never got a response
      if (messages.at(-1)?.role === "user") messages.pop()
    }

    process.stderr.write("➤ ")
  }

  process.stderr.write("\nexiting...\n")
}

async function main() {
  const { opts, positional } = parseArgs(process.argv)

  if (opts.help) {
    printHelp()
    process.exit(0)
  }

  const text = resolveInput(positional)
  if (!text?.trim()) {
    printHelp()
    process.exit(0)
  }

  const provider   = opts.provider
  const mainModel  = opts.model        ?? process.env.PURIFY_MODEL        ?? DEFAULT_MODELS[provider]
  const purifyModel = opts.purifyModel ?? process.env.PURIFY_MODEL_CHEAP  ?? DEFAULT_CHEAP_MODELS[provider]
  const apiKey     = resolveApiKey(provider, opts.apiKey)

  eprint(`purify: provider=${provider} purify=${purifyModel} main=${mainModel}`, opts.verbose)

  try {
    const result = await purify({
      text,
      provider,
      mainModel,
      fromAisp: opts.fromAisp,
      purifyModel,
      apiKey,
      verbose: opts.verbose,
    })
    console.log(result)
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`)
    process.exit(1)
  }
}

main()
