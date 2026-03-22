𝔸1.0.purify-tool@2026-03-22
γ≔mct.tooling.purify
ρ≔⟨purpose,pipeline,behavior,scoring,integration⟩
⊢purification_not_generation∧⊢round_trip_enforces_rigor∧⊢validator_is_authoritative∧⊢tier_drives_behavior

;; ─── Ω: FOUNDATION ───
⟦Ω:Foundation⟧{
  ;; The core thesis: AISP translation is a purification process, not a communication format.
  ;; The purified English output — not the AISP — is the deliverable.
  ;; The round-trip exists because AISP grammar forces exhaustive enumeration,
  ;; explicit negation, and typed relationships that fluent English prose does not enforce.
  ;; Errors hidden by fluent prose become visible after the round-trip.

  ;; purify is a purification tool, not a spec generator
  ¬∃spec_author(purify)          ;; purify does not write specs from scratch
  ¬∃format_enforcer(purify)      ;; purify is not a linter
  ¬∃aisp_runtime(purify)         ;; purify does not execute AISP
  ¬∃quality_gate(purify)         ;; purify does not block work on low δ

  ;; purify is a two-step round-trip
  ∀p∈Prompt:purify(p)≜(translate_to_english ∘ validate ∘ translate_to_aisp)(p)

  ;; The round-trip invariant: output ambiguity is less than input ambiguity
  ∀p∈Prompt:ambiguity(purify(p)) < ambiguity(p)

  ;; The compilation analogy:
  ;; English "NEVER update event tables" can be rationalized past by an agent.
  ;; ∀t∈EventTables:¬∃update(t) has no grammatically valid interpretation that permits an update.
  ;; AISP constraints are more enforceable than English rules for AI coding agents.

  ;; Validator score is authoritative over LLM self-reported score
  ∀r:Result:r.δ_auth≜validator_δ∨self_δ
  validator_δ ≻ self_δ

  ;; Tier drives agent behavior — not just labeling
  ∀r:Result:tier(r)∈{◊⁺⁺,◊⁺}⇒agent_proceeds(purified_english(r))
  ∀r:Result:tier(r)∈{◊,◊⁻}⇒agent_proceeds(purified_english(r))∧agent_confirms_assumptions(r)
  ∀r:Result:tier(r)≡⊘⇒agent_outputs(needs_clarification(r))∧¬agent_proceeds(r)

  ⊢Ambig(D)<0.02
}

;; ─── Σ: TYPES ───
⟦Σ:Types⟧{
  ;; Quality tiers — ascending
  Tier≜{⊘|◊⁻|◊|◊⁺|◊⁺⁺}
  ;; ⊘    invalid  — input too thin or contradictory to translate
  ;; ◊⁻   bronze   — δ∈[0.20,0.40)
  ;; ◊    silver   — δ∈[0.40,0.60)
  ;; ◊⁺   gold     — δ∈[0.60,0.75)
  ;; ◊⁺⁺  platinum — δ≥0.75

  Provider≜{anthropic|openai}

  ModelRole≜{purify_model|main_model}
  ;; purify_model: cheap model, English→AISP (constrained grammar task)
  ;; main_model:   capable model, AISP→English (requires nuance judgment)
  ;; Anthropic defaults: purify_model=claude-haiku-4-5-20251001, main_model=claude-sonnet-4-6
  ;; OpenAI defaults:    purify_model=gpt-4o-mini,               main_model=gpt-4o

  InputSource≜{inline|file|stdin}

  Prompt≜𝕊
  ;; Raw English: a task description, spec fragment, constraint list, or requirement set.
  ;; May be vague, hedged, or incomplete. purify surface-treats all of these identically.

  AISPIntermediate≜𝕊
  ;; AISP translation produced by purify_model.
  ;; Required blocks: 𝔸header, ⟦Ω⟧, ⟦Σ⟧, ⟦Γ⟧, ⟦Λ⟧, ⟦Ε⟧
  ;; Optional block: ⟦Χ⟧
  ;; Not surfaced to the user unless --verbose.

  ValidationResult≜⟨
    valid:𝔹,
    delta:ℝ,             ;; semantic density δ = (blockScore×0.4)+(bindingScore×0.6)
    tier:Tier,
    ambiguity:ℝ,         ;; from aisp-validator WASM kernel
    pure_density:ℝ       ;; |AISP_symbols| ÷ |non_ws_tokens|
  ⟩

  EvidenceBlock≜⟨
    delta_self:ℝ,        ;; LLM self-reported δ from ⟦Ε⟧
    tier_self:Tier       ;; LLM self-reported τ
  ⟩

  Result≜⟨
    tier:Tier,
    delta_auth:ℝ,        ;; authoritative δ — validator preferred, self fallback
    delta_self:ℝ?,       ;; included for divergence detection
    output:Output
  ⟩

  Output≜PurifiedEnglish∨NeedsClarification

  PurifiedEnglish≜𝕊
  ;; Clean markdown. No hedge words. No preamble.
  ;; Invariants → declarative statements. ¬X → "must not" or "never".
  ;; Enumerations fully listed. No "etc." No implied values.
  ;; Code blocks preserved verbatim. No rationale added beyond AISP source.

  NeedsClarification≜⟨
    questions:𝕊[1..7]
    ;; Specific, answerable questions derived from ;; AMBIGUOUS comments in AISP.
    ;; Binary or multiple-choice preferred. No open-ended questions.
  ⟩
}

;; ─── Γ: RULES ───
⟦Γ:Rules⟧{
  ;; ── Translation rules (purify_model: English→AISP) ──

  ;; Every constraint becomes a universal quantifier or explicit negation
  ∀c∈Constraint:english(c)⇒aisp(c)∈{∀expr|∃expr|¬expr|⇒expr}

  ;; Every enumeration is fully spelled out — no implied values
  ∀e∈Enumeration:aisp(e)⇒∀v∈values(e):listed(v)∧¬∃implied(e)

  ;; Relationships are typed
  ∀rel∈Relationship:aisp(rel)⇒typed(source(rel))∧typed(target(rel))

  ;; Conditionals use implication not prose
  ∀cond∈Conditional:aisp(cond)≜X⇒Y∧¬prose(cond)

  ;; Negations use ¬ and ≠ explicitly — not implied by omission
  ∀neg∈Negation:aisp(neg)∈{¬|≠|∉}

  ;; Nullable fields marked with ? suffix
  ∀f∈Field:nullable(f)⇒aisp_name(f)≜name(f)+"?"

  ;; Unresolvable ambiguities marked, not silently resolved
  ∀a∈Ambiguity:¬resolvable(a)⇒emit(";; AMBIGUOUS: "+description(a))

  ;; ── Scoring rules ──

  ;; Validator score takes precedence when available
  ∀r:Result:validation_succeeded(r)⇒r.delta_auth≜r.validation.delta
  ∀r:Result:¬validation_succeeded(r)⇒r.delta_auth≜r.evidence.delta_self

  ;; Divergence between validator δ and self-reported δ is surfaced not hidden
  ∀r:Result:|r.delta_auth - r.evidence.delta_self| > 0.1⇒divergence_visible(r)

  ;; ── Tier-to-behavior rules ──

  ;; ◊⁺⁺ and ◊⁺: proceed silently with purified English
  ∀r:Result:tier(r)∈{◊⁺⁺,◊⁺}⇒
    output(r)≡purified_english∧
    ¬agent_confirms_assumptions(r)

  ;; ◊ and ◊⁻: proceed but agent must confirm assumptions before file changes
  ∀r:Result:tier(r)∈{◊,◊⁻}⇒
    output(r)≡purified_english∧
    agent_confirms_assumptions(r)≡⊤

  ;; ⊘: no translation produced — clarification required before proceeding
  ∀r:Result:tier(r)≡⊘⇒
    output(r)≡needs_clarification∧
    ¬agent_proceeds(r)

  ;; ── Translation rules (main_model: AISP→English) ──

  ;; Translation is lossless — no rationale added, no content dropped
  ∀aisp:AISPIntermediate:english(translate(aisp))≡semantic_content(aisp)

  ;; Hedge words are prohibited in output
  ∀w∈HedgeWords:¬∃w∈output(purify)
  HedgeWords≜{typically|usually|often|generally|might|may|could|probably}

  ;; Code blocks preserved verbatim
  ∀cb∈CodeBlock:aisp(cb)≡output(cb)

  ;; ── Pipeline rules ──

  ;; The two models serve different roles — cheap for grammar, capable for nuance
  ∀step:Step1:model(step)≡purify_model∧direction(step)≡English→AISP
  ∀step:Step2:model(step)≡main_model∧direction(step)≡AISP→English

  ;; AISP intermediate is never surfaced by default
  ∀run:Run:¬verbose(run)⇒¬output(aisp_intermediate(run))
  ∀run:Run:verbose(run)⇒output(aisp_intermediate(run))≡stderr
}

;; ─── Λ: FUNCTIONS ───
⟦Λ:Functions⟧{
  ;; ── Top-level pipeline ──

  purify≜λp:Prompt.
    let aisp   = step1_to_aisp(p)
    let vr     = try(validate(aisp))           ;; aisp-validator WASM; may fail
    let ev     = parse_evidence(aisp)          ;; parse ⟦Ε⟧ block
    let δ_auth = vr?.delta ∨ ev.delta_self
    let tier   = tier_from_delta(δ_auth)
    let output = step2_to_english(aisp, tier)
    Result{tier, delta_auth:δ_auth, delta_self:ev.delta_self, output}

  ;; ── Step 1: English → AISP ──

  step1_to_aisp≜λp:Prompt.
    let guide  = load_guide(script_dir)        ;; optional — prepended if found
    let system = guide? ∘ TO_AISP_SYSTEM : TO_AISP_SYSTEM
    llm_call(purify_model, system, p):AISPIntermediate

  ;; ── Validation ──

  validate≜λaisp:AISPIntermediate.
    await(AISP.init())                         ;; loads WASM kernel — required before validate()
    AISP.validate(aisp):ValidationResult
  ;; calculateSemanticDensity() available standalone without init()

  ;; ── Step 2: AISP → English or Clarification ──

  step2_to_english≜λ(aisp:AISPIntermediate, tier:Tier).
    llm_call(main_model, TO_ENGLISH_SYSTEM, aisp):Output
  ;; TO_ENGLISH_SYSTEM branches on tier from ⟦Ε⟧:
  ;;   tier∈{◊⁺⁺,◊⁺,◊,◊⁻} → produce PurifiedEnglish
  ;;   tier≡⊘               → produce NeedsClarification from ;; AMBIGUOUS comments

  ;; ── Evidence parsing ──

  parse_evidence≜λaisp:AISPIntermediate.
    delta_self ≔ match(aisp, /δ[≜=]\s*([\d.]+)/)
    tier_self  ≔ match(aisp, /τ[≜=]\s*(◊⁺⁺|◊⁺|◊⁻|◊|⊘)/)
    EvidenceBlock{delta_self, tier_self}

  ;; ── Delta to tier ──

  tier_from_delta≜λδ:ℝ.
    δ≥0.75 → ◊⁺⁺
    δ≥0.60 → ◊⁺
    δ≥0.40 → ◊
    δ≥0.20 → ◊⁻
    δ<0.20 → ⊘

  ;; ── Output formatting ──

  format_result≜λr:Result.
    "QUALITY: "+tier_symbol(r.tier)+" "+tier_name(r.tier)+
    " (δ="+r.delta_auth+", self_δ="+r.delta_self+")"+
    "\n---\n"+r.output

  ;; ── Input resolution ──

  resolve_input≜λargs:Args.
    args.positional∧is_file(args.positional[0]) → read_file(args.positional[0])
    args.positional                              → join(args.positional)
    ¬stdin.isTTY                                → read_stdin()
    ∅                                           → print_help()∧exit(0)

  ;; ── AI_GUIDE.md resolution ──

  load_guide≜λscript_dir:Path.
    candidates≜[
      env("AISP_GUIDE"),
      script_dir+"/AI_GUIDE.md",
      home()+"/.config/aisp/AI_GUIDE.md"
    ]
    first(candidates, file_exists):𝕊?
  ;; If found: prepended to TO_AISP_SYSTEM for Step 1.
  ;; If absent: purify proceeds with built-in symbol reference — not a failure.
}

;; ─── Χ: ERRORS AND GOTCHAS ───
⟦Χ:Errors⟧{
  ;; Validator initialization
  ε_wasm≜⟨
    AISP.validate()∧¬AISP.init(),
    symptom→TypeError:"Cannot read properties of undefined (reading '_instance')",
    fix→await AISP.init() before first AISP.validate() call
  ⟩

  ;; ESM-only package
  ε_cjs≜⟨
    require("aisp-validator")∧package.type≢"module",
    symptom→"Cannot find module aisp-validator/src/index.cjs",
    fix→set package.json type:"module"; use tsx runner
  ⟩

  ;; aisp-converter full tier quality score is hardcoded
  ε_converter≜⟨
    aisp-converter.full_tier always emits δ≜0.82∧τ≜◊⁺⁺,
    meaning→not a real quality measurement,
    fix→¬use aisp-converter for quality assessment; use aisp-validator
  ⟩

  ;; Score divergence
  ε_diverge≜⟨
    |delta_auth - delta_self| > 0.15,
    meaning→LLM over-reported quality; validator is authoritative,
    action→surface both scores; do not suppress
  ⟩

  ;; Missing AI_GUIDE.md
  ε_no_guide≜⟨
    ¬file_exists(AI_GUIDE.md),
    impact→lower translation fidelity possible; not a failure,
    fix→curl -sL https://raw.githubusercontent.com/bar181/aisp-open-core/main/AI_GUIDE.md
  ⟩
}

;; ─── Ε: EVIDENCE ───
⟦Ε⟧⟨
δ≜0.74
φ≜97
τ≜◊⁺
⊢purification:∀p∈Prompt:ambiguity(purify(p)) < ambiguity(p)
⊢round_trip:purify≜(translate_to_english∘validate∘translate_to_aisp)
⊢not_generator:¬∃spec_author(purify)
⊢validator_authority:validation_succeeded(r)⇒r.delta_auth≜r.validation.delta
⊢tier_drives_behavior:tier(r)≡⊘⇒¬agent_proceeds(r)
⊢model_split:step1.model≡purify_model∧step2.model≡main_model
⊢wasm_init:AISP.validate()⇒precondition(AISP.init())
⊢guide_optional:¬file_exists(AI_GUIDE.md)⇒purify_proceeds∧¬purify_fails
⊢hedge_free:∀w∈HedgeWords:¬∃w∈output(purify)
⊢divergence_visible:|delta_auth-delta_self|>0.1⇒both_scores_in_header
⟩
