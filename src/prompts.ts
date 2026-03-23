import type { Mode } from "./types.ts"

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

export const NEEDS_CLARIFICATION_BLOCK = `\
IF τ is ⊘:
  Do not translate. Output exactly:

  NEEDS_CLARIFICATION
  Before I can act on this I need answers to the following:
  1. <specific answerable question from first ;; AMBIGUOUS comment>
  2. <specific answerable question from second ambiguity>
  ...

  Keep questions specific. Binary or multiple-choice where possible.
  No open-ended questions. No more than 7 questions.`

export const MODE_INSTRUCTIONS: Record<Mode, string> = {
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

export function getToEnglishSystem(mode: Mode): string {
  return `Translate this AISP to English.

${MODE_INSTRUCTIONS[mode]}

${NEEDS_CLARIFICATION_BLOCK}

Output only the markdown or the NEEDS_CLARIFICATION block. No preamble.`
}

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
