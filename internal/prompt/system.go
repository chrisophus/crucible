package prompt

// ToAISPSystem is the system prompt for English→AISP translation.
var ToAISPSystem = AISPSpec + "\n\nTranslate the following to AISP. Output only the AISP document."

// ModeInstructions maps output modes to translation instructions.
var ModeInstructions = map[string]string{
	"formal":    "",
	"input":     "matching the style and format of the PRIMARY_SPECIFICATION block",
	"narrative": "as a narrative",
	"hybrid":    "as a narrative with supporting tables or lists for structured detail",
	"sketch":    "as a sketch",
	"summary":   "as a summary",
}

// ContradictionDetectionSystem is the prompt for contradiction analysis.
const ContradictionDetectionSystem = `Analyze the AISP document for logical contradictions. Check for:
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

// InitSystem is the system prompt for context extraction.
const InitSystem = `Extract domain context from the provided project files to create a purify.context.md file.

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
}`

// ClarifySystem is the prompt for refining AISP with clarification answers.
const ClarifySystem = `You are refining an AISP document based on answers to clarifying questions.
Incorporate the answers to improve the AISP's precision and completeness.
Update only the parts of the AISP affected by the answers.
Output the complete updated AISP document only, no preamble.`
