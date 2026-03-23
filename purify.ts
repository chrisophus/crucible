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
 *   --provider   anthropic | openai                        (default: anthropic)
 *   --model      main model (AISP→English)                 (default: provider default)
 *   --purify-model  cheap model (En→AISP)                  (default: haiku / gpt-4o-mini)
 *   --mode       formal | narrative | hybrid | sketch | summary  (default: narrative)
 *   --mode-file  path to a skill markdown file that specifies the mode
 *   --api-key    API key                                    (default: env var)
 *   --verbose    write AISP and scores to stderr
 *   --help
 *
 * Environment:
 *   ANTHROPIC_API_KEY  OPENAI_API_KEY
 *   PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP
 *   PURIFY_MODE_FILE   path to a skill markdown file (overridden by --mode-file)
 *
 * Output:
 *   QUALITY: <tier_symbol> <tier_name> (δ=<score>, validator_δ=<score>)
 *   ---
 *   <purified English>        — or —
 *   NEEDS_CLARIFICATION
 *   <numbered questions>
 */

import { readFileSync, writeFileSync, existsSync } from "fs"
import { createInterface } from "readline"
import AISP, { calculateSemanticDensity } from "aisp-validator"
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = "anthropic" | "openai"
type Mode = "formal" | "narrative" | "hybrid" | "sketch" | "summary"
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

const NEEDS_CLARIFICATION_BLOCK = `\
IF τ is ⊘:
  Do not translate. Output exactly:

  NEEDS_CLARIFICATION
  Before I can act on this I need answers to the following:
  1. <specific answerable question from first ;; AMBIGUOUS comment>
  2. <specific answerable question from second ambiguity>
  ...

  Keep questions specific. Binary or multiple-choice where possible.
  No open-ended questions. No more than 7 questions.`

const MODE_INSTRUCTIONS: Record<Mode, string> = {
  formal: `\
IF τ is ◊⁺⁺, ◊⁺, ◊, or ◊⁻:
  Translate to thorough, structured English markdown. No AISP notation in output.
  - Invariants → declarative statements. Negations as "never" or "must not".
  - Types → definition tables with every value listed explicitly.
  - Entities → field tables: Field | Type | Notes. Nullable fields noted.
  - Functions → per-case tables or numbered steps covering every case.
  - Constraints → grouped bullets. Negations as "never", "must not".
  - Preserve all code blocks exactly.
  - Do not add rationale not in the source.
  - No hedge words: never use "typically", "usually", "often", "generally".
  - No preamble. Start with the first section heading.`,

  narrative: `\
IF τ is ◊⁺⁺, ◊⁺, ◊, or ◊⁻:
  Translate to flowing connected prose. No AISP notation in output.
  - Write a brief prose introduction for the whole document.
  - For each section, write one or two paragraphs of plain English.
  - Use connective language: "whenever", "which means", "so that", "in other words".
  - Use tables only for compact enumerations where prose would be harder to scan.
  - Preserve all code blocks exactly.
  - Do not add rationale not in the source.
  - No hedge words: never use "typically", "usually", "often", "generally".
  - No preamble. Start with the first section heading.`,

  hybrid: `\
IF τ is ◊⁺⁺, ◊⁺, ◊, or ◊⁻:
  Translate to a mix of prose and structured markdown. No AISP notation in output.
  - Open each section with one or two plain-English sentences stating the intent.
  - Follow with a table, numbered list, or bullet list for the details.
  - Preserve all code blocks exactly.
  - Do not add rationale not in the source.
  - No hedge words: never use "typically", "usually", "often", "generally".
  - No preamble. Start with the first section heading.`,

  sketch: `\
IF τ is ◊⁺⁺, ◊⁺, ◊, or ◊⁻:
  Translate to a high-level prose sketch. No AISP notation in output.
  - Write a short overview paragraph for the whole document.
  - Render each major point as a single clear sentence.
  - Collect the key points into a bullet list.
  - Omit minor technical detail; keep the meaning intact.
  - Render code examples as plain pseudocode or a prose description.
  - Close with a one-sentence confidence statement.`,

  summary: `\
IF τ is ◊⁺⁺, ◊⁺, ◊, or ◊⁻:
  Translate to a brief plain-English executive summary. No AISP notation in output.
  - Write a short paragraph summarising what this specification does.
  - Follow with a bullet list of the key points. No tables.
  - List two or three key takeaways.
  - State overall confidence in one plain sentence.
  - No code blocks. Describe what code examples do in plain words.`,
}

const APPLY_SUGGESTION_SYSTEM = `\
You are refining a specification document based on a user suggestion.

You will be given:
  ORIGINAL: the current source specification text
  PURIFIED: the purified (formal round-trip) version that revealed ambiguities
  SUGGESTION: the user's proposed change

Produce an updated version of the ORIGINAL text that incorporates the suggestion.

Rules:
- Modify only what is necessary to address the suggestion.
- Preserve the original's style, format, and level of detail.
- Do not introduce information not implied by the suggestion.
- Address any ambiguities the suggestion is trying to resolve.
- Output ONLY the updated original text. No preamble, no explanation.`

function getToEnglishSystem(mode: Mode): string {
  return `You are translating an AISP 5.1 formal specification back to plain English.

First check the evidence block (⟦Ε⟧) for the τ tier value.

${MODE_INSTRUCTIONS[mode]}

${NEEDS_CLARIFICATION_BLOCK}

Output only the markdown or the NEEDS_CLARIFICATION block. No preamble.`
}

function getReplSystem(mode: Mode): string {
  return getToEnglishSystem(mode) + `\n\n\
You are in an interactive refinement session. \
Maintain continuity with the conversation history — when the user refines or \
extends a spec, integrate the changes and return the complete current specification. \
Each user message is an AISP document representing their intent.`
}

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
  opts: { streamTo?: NodeJS.WritableStream; thinking?: boolean } = {},
): Promise<string> {
  const { streamTo, thinking } = opts
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey })
    const params = {
      model,
      max_tokens: thinking ? 16000 : 8096,
      system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: user }],
      ...(thinking ? { thinking: { type: "enabled" as const, budget_tokens: 8000 }, betas: ["interleaved-thinking-2025-05-14"] } : {}),
    } as Parameters<typeof client.messages.create>[0]
    if (streamTo) {
      const stream = client.messages.stream(params)
      let text = ""
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          streamTo.write(event.delta.text)
          text += event.delta.text
        }
      }
      return text
    }
    const msg = await client.messages.create(params)
    const textBlock = msg.content.find((b: { type: string }) => b.type === "text") as { type: "text"; text: string } | undefined
    return textBlock?.text ?? ""
  } else {
    const client = new OpenAI({ apiKey })
    if (streamTo) {
      const stream = await client.chat.completions.create({
        model,
        max_tokens: 8096,
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user },
        ],
        stream: true,
      })
      let text = ""
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ""
        if (delta) { streamTo.write(delta); text += delta }
      }
      return text
    }
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
  streamTo?: NodeJS.WritableStream,
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
    const params = {
      model,
      max_tokens: 8096,
      system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
      messages: anthropicMsgs,
    } as Parameters<typeof client.messages.create>[0]
    if (streamTo) {
      const stream = client.messages.stream(params)
      let text = ""
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          streamTo.write(event.delta.text)
          text += event.delta.text
        }
      }
      return text
    }
    const msg = await client.messages.create(params)
    return (msg.content[0] as { text: string }).text
  } else {
    const client = new OpenAI({ apiKey })
    if (streamTo) {
      const stream = await client.chat.completions.create({
        model,
        max_tokens: 8096,
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
      })
      let text = ""
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ""
        if (delta) { streamTo.write(delta); text += delta }
      }
      return text
    }
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 8096,
      messages: [{ role: "system", content: system }, ...messages],
    })
    return resp.choices[0].message.content ?? ""
  }
}

// ── Validator tool use (Anthropic-only, Step 1) ───────────────────────────────

const VALIDATOR_TOOL = {
  name: "validate_aisp",
  description: "Validate an AISP 5.1 document and return semantic density (δ) and tier. Call after generating AISP to check quality before finalizing.",
  input_schema: {
    type: "object" as const,
    properties: {
      aisp: { type: "string", description: "The complete AISP 5.1 document to validate" },
    },
    required: ["aisp"],
  },
}

const TO_AISP_SYSTEM_WITH_TOOLS = TO_AISP_SYSTEM + `

After generating the AISP document, call validate_aisp with it to check semantic density.
If δ < 0.40, revise the document and call validate_aisp once more.
Output your final AISP as plain text when done.`

async function callLLMWithTools(
  apiKey: string,
  model: string,
  user: string,
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const msgs: Parameters<typeof client.messages.create>[0]["messages"] = [
    { role: "user", content: user },
  ]
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await client.messages.create({
      model,
      max_tokens: 8096,
      system: [{ type: "text" as const, text: TO_AISP_SYSTEM_WITH_TOOLS, cache_control: { type: "ephemeral" as const } }],
      tools: [VALIDATOR_TOOL],
      messages: msgs,
    } as Parameters<typeof client.messages.create>[0])

    if (resp.stop_reason !== "tool_use") {
      const textBlock = (resp.content as Array<{ type: string }>).find(b => b.type === "text") as { type: "text"; text: string } | undefined
      return textBlock?.text ?? ""
    }

    msgs.push({ role: "assistant", content: resp.content as Parameters<typeof client.messages.create>[0]["messages"][number]["content"] })

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = []
    for (const block of resp.content) {
      if (block.type === "tool_use" && block.name === "validate_aisp") {
        const input = block.input as { aisp: string }
        const result = await runValidator(input.aisp)
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result ?? { error: "validator unavailable" }),
        })
      }
    }
    msgs.push({ role: "user", content: toolResults as Parameters<typeof client.messages.create>[0]["messages"][number]["content"] })
  }
  throw new Error("unreachable")
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
  mode: Mode
  fromAisp?: boolean
  thinking?: boolean
  stream?: boolean
}): Promise<string> {
  const { text, provider, mainModel, purifyModel, apiKey, verbose, mode, fromAisp, thinking, stream } = opts

  let aisp: string
  if (fromAisp) {
    // Skip step 1 — input is already AISP
    aisp = text
    eprint("→ skipping purification (--from-aisp)", verbose)
  } else {
    // Step 1: English → AISP (cheap model)
    // Anthropic: use tool-use loop so the model can self-validate and revise
    eprint(`→ purifying (${purifyModel})...`, verbose)
    aisp = provider === "anthropic"
      ? await callLLMWithTools(apiKey, purifyModel, text)
      : await callLLM(provider, apiKey, purifyModel, TO_AISP_SYSTEM, text)
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

  const qualityHeader = `QUALITY: ${authoritativeTierSymbol} ${authoritativeTierName} (${deltaStr}${selfDeltaStr})`

  // Step 3: AISP → English or clarifying questions (main model)
  eprint(`→ translating back (${mainModel})...`, verbose)
  if (stream) {
    process.stdout.write(qualityHeader + "\n---\n")
    const english = await callLLM(provider, apiKey, mainModel, getToEnglishSystem(mode), aisp, { streamTo: process.stdout, thinking })
    return qualityHeader + "\n---\n" + english
  }

  const english = await callLLM(provider, apiKey, mainModel, getToEnglishSystem(mode), aisp, { thinking })

  return [qualityHeader, "---", english].join("\n")
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

const VALID_MODES: Mode[] = ["formal", "narrative", "hybrid", "sketch", "summary"]

/**
 * Parse a skill markdown file and extract the mode from it.
 *
 * Reads the mode from YAML frontmatter (`mode: <value>`) or from a
 * `## Mode` section (first non-empty line after the heading).
 *
 * Example skill file:
 *
 *   ---
 *   mode: narrative
 *   ---
 *
 *   # My Mode
 *   ...
 *
 * Or without frontmatter:
 *
 *   ## Mode
 *   sketch
 */
function parseModeFile(filePath: string): Mode {
  if (!existsSync(filePath)) {
    process.stderr.write(`error: mode file not found: ${filePath}\n`)
    process.exit(1)
  }

  const content = readFileSync(filePath, "utf8")

  // Try YAML frontmatter first: look for `mode: <value>` between --- delimiters
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/m)
  if (frontmatterMatch) {
    const modeMatch = frontmatterMatch[1].match(/^mode:\s*(\S+)/m)
    if (modeMatch) {
      const mode = modeMatch[1].toLowerCase() as Mode
      if (!VALID_MODES.includes(mode)) {
        process.stderr.write(`error: invalid mode "${mode}" in ${filePath}. Valid modes: ${VALID_MODES.join(", ")}\n`)
        process.exit(1)
      }
      return mode
    }
  }

  // Fall back to ## Mode section
  const modeSectionMatch = content.match(/^##\s+Mode\s*\r?\n([\s\S]*?)(?:^##|\Z)/m)
  if (modeSectionMatch) {
    const firstLine = modeSectionMatch[1].split(/\r?\n/).find(l => l.trim())?.trim().toLowerCase() as Mode | undefined
    if (firstLine && VALID_MODES.includes(firstLine)) {
      return firstLine
    }
  }

  process.stderr.write(`error: no valid mode found in ${filePath}. Add "mode: <value>" to frontmatter or a "## Mode" section.\n`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const positional: string[] = []
  const opts = {
    provider:     (process.env.PURIFY_PROVIDER ?? "anthropic") as Provider,
    model:        null as string | null,
    purifyModel:  null as string | null,
    apiKey:       null as string | null,
    mode:         (process.env.PURIFY_MODE ?? "narrative") as Mode,
    modeFile:     (process.env.PURIFY_MODE_FILE ?? null) as string | null,
    verbose:      false,
    fromAisp:     false,
    repl:         false,
    suggest:      false,
    thinking:     false,
    estimate:     false,
    help:         false,
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--help" || a === "-h")          { opts.help = true }
    else if (a === "--verbose")                 { opts.verbose = true }
    else if (a === "--from-aisp")               { opts.fromAisp = true }
    else if (a === "--repl")                    { opts.repl = true }
    else if (a === "--suggest")                 { opts.suggest = true }
    else if (a === "--thinking")                { opts.thinking = true }
    else if (a === "--estimate")                { opts.estimate = true }
    else if (a === "--provider")                { opts.provider = args[++i] as Provider }
    else if (a === "--model")                   { opts.model = args[++i] }
    else if (a === "--purify-model")            { opts.purifyModel = args[++i] }
    else if (a === "--mode")                    { opts.mode = args[++i] as Mode }
    else if (a === "--mode-file")               { opts.modeFile = args[++i] }
    else if (a === "--formal")                  { opts.mode = "formal" }
    else if (a === "--narrative")               { opts.mode = "narrative" }
    else if (a === "--hybrid")                  { opts.mode = "hybrid" }
    else if (a === "--sketch")                  { opts.mode = "sketch" }
    else if (a === "--summary")                 { opts.mode = "summary" }
    else if (a === "--api-key")                 { opts.apiKey = args[++i] }
    else if (!a.startsWith("--"))               { positional.push(a) }
    else {
      process.stderr.write(`error: unknown option ${a}\n`)
      process.exit(1)
    }
  }

  // Resolve mode from file if provided (mode file takes precedence over env var,
  // but explicit --mode / --formal etc. flags take precedence over mode file)
  const modeSetByFlag = argv.slice(2).some(a =>
    a === "--mode" || a === "--formal" || a === "--narrative" ||
    a === "--hybrid" || a === "--sketch" || a === "--summary"
  )
  if (opts.modeFile && !modeSetByFlag) {
    opts.mode = parseModeFile(opts.modeFile)
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
  --provider     anthropic | openai                          (default: anthropic)
  --model        main model (AISP→English)                   (default: claude-sonnet-4-6)
  --purify-model cheap model (En→AISP)                       (default: claude-haiku-4-5-20251001)
  --mode         formal|narrative|hybrid|sketch|summary      (default: narrative)
  --mode-file    path to a skill markdown file that specifies the mode
  --api-key      API key                                     (default: env var)
  --from-aisp    skip step 1 — input is already AISP
  --repl         interactive session with chat context and prompt caching
  --suggest      show purified version then suggest changes applied to the original
  --thinking     enable extended thinking for Step 3 (Anthropic Sonnet/Opus only)
  --estimate     count input tokens for Step 1 and exit without calling the main model
  --verbose      write AISP and scores to stderr
  --help

Modes:
  formal     Full precision; tables and notation throughout
  narrative  Flowing prose with symbolic anchors (default)
  hybrid     Balanced prose and notation
  sketch     High-level overview; bullet list; minimal symbols
  summary    Plain English; no notation; executive summary

Mode files:
  A skill markdown file with a "mode:" key in YAML frontmatter or a "## Mode"
  section. Example: purify --mode-file .claude/skills/sketch-mode.md

Environment:
  ANTHROPIC_API_KEY  OPENAI_API_KEY
  PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP  PURIFY_MODE
  PURIFY_MODE_FILE   path to a skill markdown file (overridden by --mode-file)

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
  mode: Mode
  fromAisp: boolean
}): Promise<void> {
  const { provider, mainModel, purifyModel, apiKey, verbose, mode, fromAisp } = opts
  const messages: ConvMessage[] = []

  const rl = createInterface({ input: process.stdin })

  process.stderr.write(
    `purify repl — empty line to submit, /exit or ctrl-c to quit\n` +
    `provider=${provider}  purify=${purifyModel}  model=${mainModel}  mode=${mode}\n\n`,
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
      // Anthropic: use tool-use loop so the model can self-validate and revise
      let aisp = input
      if (!fromAisp) {
        process.stderr.write(`→ purifying (${purifyModel})...\n`)
        aisp = provider === "anthropic"
          ? await callLLMWithTools(apiKey, purifyModel, input)
          : await callLLM(provider, apiKey, purifyModel, TO_AISP_SYSTEM, input)
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

      // Step 3: AISP → English via main model with full conversation history (streamed)
      messages.push({ role: "user", content: aisp })
      process.stderr.write(`→ translating (${mainModel})...\n`)
      process.stdout.write("\n")
      const response = await callLLMRepl(provider, apiKey, mainModel, getReplSystem(mode), messages, process.stdout)
      messages.push({ role: "assistant", content: response })

      process.stdout.write("\n\n")
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      // Roll back the user message if we never got a response
      if (messages.at(-1)?.role === "user") messages.pop()
    }

    process.stderr.write("➤ ")
  }

  process.stderr.write("\nexiting...\n")
}

async function runSuggest(opts: {
  provider: Provider
  mainModel: string
  purifyModel: string
  apiKey: string
  verbose: boolean
  mode: Mode
  fromAisp: boolean
  inputFile: string | null
  initialText: string
}): Promise<void> {
  const { provider, mainModel, purifyModel, apiKey, verbose, mode, fromAisp, inputFile } = opts
  let currentText = opts.initialText

  const rl = createInterface({ input: process.stdin })

  process.stderr.write(
    `purify suggest — show purified version and suggest changes to the original\n` +
    `provider=${provider}  purify=${purifyModel}  model=${mainModel}  mode=${mode}\n` +
    `commands: empty line to submit · /save to write file · /exit to quit\n\n`,
  )

  process.on("SIGINT", () => {
    process.stderr.write("\nexiting...\n")
    rl.close()
    process.exit(0)
  })

  async function doPurify(): Promise<string> {
    const result = await purify({
      text: currentText,
      provider, mainModel, purifyModel, apiKey, verbose, mode, fromAisp,
    })
    process.stdout.write("\n── PURIFIED VERSION ──\n" + result + "\n── END PURIFIED ──\n\n")
    return result
  }

  // Initial purify
  process.stderr.write(`→ purifying initial input...\n`)
  let purifiedResult = await doPurify()

  process.stderr.write("➤ ")

  let buffer: string[] = []

  for await (const line of rl) {
    if (line !== "") {
      buffer.push(line)
      continue
    }

    if (buffer.length === 0) {
      process.stderr.write("➤ ")
      continue
    }

    const input = buffer.join("\n").trim()
    buffer = []

    if (input === "/exit") break

    if (input === "/save") {
      if (!inputFile) {
        process.stderr.write("⊘ no input file to save to — pass a file path as the argument\n")
      } else {
        writeFileSync(inputFile, currentText, "utf8")
        process.stderr.write(`✓ saved to ${inputFile}\n`)
      }
      process.stderr.write("➤ ")
      continue
    }

    try {
      process.stderr.write(`→ applying suggestion...\n`)
      const userMsg = [
        "ORIGINAL:",
        currentText,
        "",
        "PURIFIED:",
        purifiedResult,
        "",
        "SUGGESTION:",
        input,
      ].join("\n")

      currentText = await callLLM(provider, apiKey, mainModel, APPLY_SUGGESTION_SYSTEM, userMsg)

      process.stdout.write("\n── UPDATED ORIGINAL ──\n" + currentText + "\n── END ORIGINAL ──\n\n")

      process.stderr.write(`→ re-purifying...\n`)
      purifiedResult = await doPurify()
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
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

  if (opts.repl) {
    const provider    = opts.provider
    const mainModel   = opts.model       ?? process.env.PURIFY_MODEL       ?? DEFAULT_MODELS[provider]
    const purifyModel = opts.purifyModel ?? process.env.PURIFY_MODEL_CHEAP ?? DEFAULT_CHEAP_MODELS[provider]
    const apiKey      = resolveApiKey(provider, opts.apiKey)
    await runRepl({ provider, mainModel, purifyModel, apiKey, verbose: opts.verbose, mode: opts.mode, fromAisp: opts.fromAisp })
    process.exit(0)
  }

  if (opts.suggest) {
    const text = resolveInput(positional)
    if (!text?.trim()) {
      process.stderr.write("error: --suggest requires an input file or inline text\n")
      process.exit(1)
    }
    const provider    = opts.provider
    const mainModel   = opts.model       ?? process.env.PURIFY_MODEL       ?? DEFAULT_MODELS[provider]
    const purifyModel = opts.purifyModel ?? process.env.PURIFY_MODEL_CHEAP ?? DEFAULT_CHEAP_MODELS[provider]
    const apiKey      = resolveApiKey(provider, opts.apiKey)
    const inputFile   = positional.length === 1 && existsSync(positional[0]) ? positional[0] : null
    await runSuggest({ provider, mainModel, purifyModel, apiKey, verbose: opts.verbose, mode: opts.mode, fromAisp: opts.fromAisp, inputFile, initialText: text! })
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

  if (opts.estimate) {
    if (provider !== "anthropic") {
      process.stderr.write("error: --estimate is only supported with --provider anthropic\n")
      process.exit(1)
    }
    const client = new Anthropic({ apiKey })
    const count = await client.messages.countTokens({
      model: purifyModel,
      system: TO_AISP_SYSTEM_WITH_TOOLS,
      messages: [{ role: "user", content: text! }],
    })
    process.stdout.write(
      `Step 1 input tokens (${purifyModel}): ${count.input_tokens}\n` +
      `(Step 3 tokens depend on AISP output — run without --estimate for full output)\n`,
    )
    process.exit(0)
  }

  eprint(`purify: provider=${provider} purify=${purifyModel} main=${mainModel} mode=${opts.mode}`, opts.verbose)

  try {
    await purify({
      text: text!,
      provider,
      mainModel,
      fromAisp: opts.fromAisp,
      purifyModel,
      apiKey,
      verbose: opts.verbose,
      mode: opts.mode,
      thinking: opts.thinking,
      stream: true,
    })
    process.stdout.write("\n")
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`)
    process.exit(1)
  }
}

main()
