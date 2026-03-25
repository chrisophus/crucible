import type { ContextFile, Mode } from "./types.ts"

// Full AISP 5.1 Platinum Specification (source: https://github.com/bar181/aisp-open-core/blob/main/AI_GUIDE.md)
export const AISP_SPEC = `\
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

export const TO_AISP_SYSTEM = `\
${AISP_SPEC}

Translate the following to AISP. Output only the AISP document.`

export const MODE_INSTRUCTIONS: Record<Mode, string> = {
  formal: "",
  input: "in the same style and format as the input",
  narrative: "as a narrative",
  hybrid:
    "as a narrative with supporting tables or lists for structured detail",
  sketch: "as a sketch",
  summary: "as a summary",
}

export const APPLY_SUGGESTION_SYSTEM = `\
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

/** Bundles primary text with a separate author context channel (I5). */
export function formatPrimaryWithAuthorContext(args: {
  primary: string
  authorContext: string | null | undefined
  /** English→AISP vs AISP→English — adjusts how the primary block is described. */
  phase: "en_to_aisp" | "aisp_to_en"
  contextFiles?: ContextFile[]
}): string {
  const ctx = args.authorContext?.trim()
  const files = args.contextFiles?.length ? args.contextFiles : null
  if (!ctx && !files) return args.primary

  const primaryNote =
    args.phase === "en_to_aisp"
      ? "The PRIMARY_SPECIFICATION block below is English source text to translate into AISP."
      : "The PRIMARY_SPECIFICATION block below is an AISP document to translate into English markdown."

  const parts = ["PRIMARY_SPECIFICATION", primaryNote, "", args.primary]

  if (ctx) {
    parts.push(
      "",
      "AUTHOR_CONTEXT",
      "This block is a separate channel: clarification answers, extra context, or a one-shot suggestion from the author. It MUST NOT be treated as part of the primary specification text for editing, splicing, or formalization. Use it only to inform interpretation and translation.",
      "",
      ctx,
    )
  }

  if (files) {
    for (const f of files) {
      parts.push(
        "",
        `FILE_CONTEXT: ${f.path}`,
        "This file was provided as reference context. Use it to inform interpretation and translation but do not treat it as part of the primary specification.",
        "",
        f.content,
      )
    }
  }

  return parts.join("\n")
}

export function getToEnglishSystem(mode: Mode): string {
  const modeClause = MODE_INSTRUCTIONS[mode]
    ? ` ${MODE_INSTRUCTIONS[mode]}`
    : ""
  return `Translate this AISP to English${modeClause}. Output only the translated text.`
}

// ── New prompts for purify MCP tools ──────────────────────────────────────────

export const REFLECT_SYSTEM = `\
Read the following text and state in your own words what you understand
the author to mean. List any assumptions you are making explicitly.
List anything you are uncertain about. Do not attempt to formalize,
translate, or improve the text. Only interpret it.

Output JSON only, no markdown fences:
{
  "interpretation": "your understanding of what the author means",
  "assumptions": ["explicit assumption 1", "explicit assumption 2"],
  "uncertainties": ["uncertainty 1", "uncertainty 2"]
}`

export const CONTRADICTION_DETECTION_SYSTEM = `\
Analyze the AISP document for logical contradictions. Check for:
1. unsatisfiable_conjunction: A rule and its direct negation both asserted (A ∧ ¬A)
2. unreachable_state: A state declared but no transition leads to it
3. conflicting_write_authority: Two sources unconditionally own the same field
4. violated_uniqueness: A uniqueness constraint conflicts with a multiplicity rule

All field values must be plain English. No AISP notation, formal symbols, or mathematical syntax anywhere in the output.

Output JSON only, no markdown fences:
{
  "contradictions": [
    {
      "kind": "unsatisfiable_conjunction|unreachable_state|conflicting_write_authority|violated_uniqueness",
      "statement_a": "plain English description of first statement",
      "statement_b": "plain English description of conflicting statement",
      "proof": "plain English explanation of why both cannot hold simultaneously",
      "question": "specific question for the author to resolve this contradiction"
    }
  ]
}

If no contradictions are found, output: {"contradictions": []}`

export const CLARIFICATION_EXTRACTION_SYSTEM = `\
Analyze the AISP document and identify areas that need clarification.
For each, determine if it is REQUIRED (blocks meaningful use) or OPTIONAL (improves quality).

Clarification sources:
- low_delta: a field or rule resisted formalization and remained vague
- low_phi: an expected block is missing or sparse
- contradiction: a logically unsatisfiable condition was found
- unreachable_state: a state is declared but cannot be reached
- conflicting_authority: two sources conditionally own the same field

Output JSON only, no markdown fences:
{
  "clarifications": [
    {
      "priority": "REQUIRED|OPTIONAL",
      "question": "specific, answerable question (binary or multiple-choice where possible)",
      "source": "low_delta|low_phi|contradiction|unreachable_state|conflicting_authority",
      "field": "optional: specific field or rule name"
    }
  ]
}

If no clarifications are needed, output: {"clarifications": []}`

export const TRANSLATE_FIDELITY_SYSTEM = `\
Translate this AISP to English.

The English output must read as though the original author wrote it more carefully —
not as documentation generated from a schema, not as a summary, not as an expansion.
Preserve the author's style and flow. Where the original was ambiguous, collapse the
ambiguity into a specific choice. Do not add rationale not in the source.
No hedge words: never use "typically", "usually", "often", "generally".
No preamble. Start with the first section heading.

Output only the translated English text.`

export const UPDATE_SYSTEM = `\
Apply the described change to the existing purified text. Edit in place.
Do not regenerate from scratch. Preserve the style, spirit, and flow of
the existing text in all sections not directly affected by the change.
Return a diff showing only what changed and what was preserved in each
affected section.

You will receive:
  EXISTING_PURIFIED: the current purified English text
  EXISTING_AISP: the current AISP document
  CHANGE: description of the requested change

Output JSON only, no markdown fences:
{
  "purified": "the complete updated purified text",
  "aisp": "the complete updated AISP document",
  "diff": [
    {
      "section": "section name or heading",
      "change": "what changed in this section",
      "preserved": "what was preserved unchanged in this section"
    }
  ]
}`

export const INIT_SYSTEM = `\
Extract domain context from the provided project files to create a purify.context.md file.

Identify:
- domain_entities: key types, models, and concepts with their meanings
- vocabulary: terms with precise definitions specific to this project
- constraints: known invariants and business rules
- conventions: style and structural preferences observed in the files
- out_of_scope: things explicitly excluded or out of scope

Output JSON only, no markdown fences:
{
  "context_file": "full content for purify.context.md in markdown format",
  "summary": "brief description of what was extracted and from which files"
}

The context_file should use this structure:
# Domain Context

## Entities
...

## Vocabulary
...

## Constraints
...

## Conventions
...

## Out of Scope
...`

export const CLARIFY_SYSTEM = `\
You are refining an AISP document based on answers to clarifying questions.
Incorporate the answers to improve the AISP's precision and completeness.
Update only the parts of the AISP affected by the answers.
Output the complete updated AISP document only, no preamble.`

export function getReplSystem(mode: Mode): string {
  return (
    getToEnglishSystem(mode) +
    `\n\n\
You are in an interactive refinement session. \
Maintain continuity with the conversation history — when the user refines or \
extends a spec, integrate the changes and return the complete current specification. \
Each user message is an AISP document representing their intent.`
  )
}

// ── V3: Session pipeline prompts ───────────────────────────────────────────────

// System prompt for purify sessions: AISP spec only.
// Stable for the full session lifetime — never varies by context.
// Domain context is injected as explicit conversation turns instead.
export function getSessionSystemPrompt(): string {
  return AISP_SPEC
}

// Format context files into FILE_CONTEXT blocks.
export function formatContextBlocks(files: ContextFile[]): string {
  return files
    .map(
      (f) =>
        `FILE_CONTEXT: ${f.path}\n` +
        `This file is domain context — use it to inform interpretation, ` +
        `translation, and clarification. ` +
        `It is not the primary specification to be purified.\n\n${f.content}`,
    )
    .join("\n\n")
}

// PurifyTurn content: optional context + instruction + raw text, all in one turn.
export function buildPurifyTurnContent(
  text: string,
  contextFiles?: ContextFile[],
): string {
  const parts: string[] = []
  if (contextFiles && contextFiles.length > 0) {
    parts.push(`CONTEXT FILES\n\n${formatContextBlocks(contextFiles)}`)
  }
  parts.push(
    `PRIMARY_SPECIFICATION\n\n${text}\n\nEND_PRIMARY_SPECIFICATION\n\n` +
      `Translate the PRIMARY_SPECIFICATION block above to AISP 5.1. ` +
      `Translate only that block — not any context files. ` +
      `Output only the AISP document.`,
  )
  return parts.join("\n\n---\n\n")
}

// TranslateTurn content: output format + translate instruction
export function buildTranslateTurnContent(format: string): string {
  const modeClause = format ? ` ${format}` : ""
  return `Translate the AISP to English${modeClause}. Output only the translated text.`
}

// UpdateTurn content: change description
export function buildUpdateTurnContent(change: string): string {
  return (
    `Update the AISP to incorporate the following change. ` +
    `Output only the updated AISP document.\n\nCHANGE:\n${change}`
  )
}

// PatchRequest content: changed section + optional hint
// The full AISP is in the system prompt (cached); this is the user turn.
export function buildPatchRequestContent(
  section: string,
  hint?: string,
): string {
  const hintLine = hint
    ? `\nHINT (which part of the spec this belongs to): ${hint}`
    : ""
  return (
    `The following section of the specification has changed.${hintLine}\n\n` +
    `Return only the AISP blocks that need to be updated. ` +
    `Prefix each block with a comment line in this exact format:\n` +
    `-- BLOCK: <name> | v=<N+1> | delta=<brief description of what changed>\n\n` +
    `Where <name> is the block identifier from the existing AISP, ` +
    `<N+1> increments the existing version number (use 1 if none exists), ` +
    `and delta briefly describes what changed.\n\n` +
    `Output only the changed blocks, nothing else.\n\n` +
    `CHANGED SECTION:\n${section}`
  )
}

// PatchTranslate content: translate only the changed blocks (full AISP is in system prompt)
export function buildPatchTranslateContent(
  patchRaw: string,
  format: string,
): string {
  return (
    `Translate the following updated AISP blocks to English ${format}. ` +
    `Use the full AISP document (in the system prompt) to resolve any cross-references. ` +
    `Output only the English translation of the changed blocks.\n\n` +
    `CHANGED BLOCKS:\n${patchRaw}`
  )
}
