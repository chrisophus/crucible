/**
 * Unit tests for prompts.ts mode-to-prompt mapping.
 * Verifies that each mode produces the correct prompt strings.
 */

import { describe, expect, it } from "vitest"
import {
  buildTranslateTurnContent,
  getReplSystem,
  getToEnglishSystem,
  MODE_INSTRUCTIONS,
} from "./prompts.ts"
import type { Mode } from "./types.ts"

describe("MODE_INSTRUCTIONS", () => {
  it("defines all six modes", () => {
    const modes: Mode[] = [
      "formal",
      "input",
      "narrative",
      "hybrid",
      "sketch",
      "summary",
    ]
    for (const mode of modes) {
      expect(MODE_INSTRUCTIONS).toHaveProperty(mode)
    }
  })

  it("formal mode has empty instruction", () => {
    expect(MODE_INSTRUCTIONS.formal).toBe("")
  })

  it("input mode instructs to use same style as input", () => {
    expect(MODE_INSTRUCTIONS.input).toBe(
      "in the same style and format as the input",
    )
  })

  it("narrative mode instructs as a narrative", () => {
    expect(MODE_INSTRUCTIONS.narrative).toBe("as a narrative")
  })

  it("hybrid mode instructs with narrative and tables", () => {
    expect(MODE_INSTRUCTIONS.hybrid).toBe(
      "as a narrative with supporting tables or lists for structured detail",
    )
  })

  it("sketch mode instructs as a sketch", () => {
    expect(MODE_INSTRUCTIONS.sketch).toBe("as a sketch")
  })

  it("summary mode instructs as a summary", () => {
    expect(MODE_INSTRUCTIONS.summary).toBe("as a summary")
  })
})

describe("getToEnglishSystem", () => {
  it("formal mode produces base prompt with no modifier", () => {
    const prompt = getToEnglishSystem("formal")
    expect(prompt).toBe(
      "Translate this AISP to English. Output only the translated text.",
    )
  })

  it("input mode appends input style instruction", () => {
    const prompt = getToEnglishSystem("input")
    expect(prompt).toBe(
      "Translate this AISP to English in the same style and format as the input. Output only the translated text.",
    )
  })

  it("narrative mode appends narrative instruction", () => {
    const prompt = getToEnglishSystem("narrative")
    expect(prompt).toBe(
      "Translate this AISP to English as a narrative. Output only the translated text.",
    )
  })

  it("hybrid mode appends table instruction", () => {
    const prompt = getToEnglishSystem("hybrid")
    expect(prompt).toBe(
      "Translate this AISP to English as a narrative with supporting tables or lists for structured detail. Output only the translated text.",
    )
  })

  it("sketch mode appends sketch instruction", () => {
    const prompt = getToEnglishSystem("sketch")
    expect(prompt).toBe(
      "Translate this AISP to English as a sketch. Output only the translated text.",
    )
  })

  it("summary mode appends summary instruction", () => {
    const prompt = getToEnglishSystem("summary")
    expect(prompt).toBe(
      "Translate this AISP to English as a summary. Output only the translated text.",
    )
  })

  it("all modes end with output instruction", () => {
    const modes: Mode[] = [
      "formal",
      "input",
      "narrative",
      "hybrid",
      "sketch",
      "summary",
    ]
    for (const mode of modes) {
      const prompt = getToEnglishSystem(mode)
      expect(prompt).toMatch(/Output only the translated text\.$/)
    }
  })

  it("all modes start with Translate this AISP to English", () => {
    const modes: Mode[] = [
      "formal",
      "input",
      "narrative",
      "hybrid",
      "sketch",
      "summary",
    ]
    for (const mode of modes) {
      const prompt = getToEnglishSystem(mode)
      expect(prompt).toMatch(/^Translate this AISP to English/)
    }
  })
})

describe("buildTranslateTurnContent", () => {
  it("produces base prompt when format is empty", () => {
    const content = buildTranslateTurnContent("")
    expect(content).toBe(
      "Translate the AISP to English. Output only the translated text.",
    )
  })

  it("produces base prompt when format is empty string (no space inserted)", () => {
    const content = buildTranslateTurnContent("")
    expect(content).not.toContain("  ") // no double spaces
  })

  it("appends format when provided", () => {
    const content = buildTranslateTurnContent("as a narrative")
    expect(content).toBe(
      "Translate the AISP to English as a narrative. Output only the translated text.",
    )
  })

  it("works with MODE_INSTRUCTIONS values for formal", () => {
    const format = MODE_INSTRUCTIONS.formal
    const content = buildTranslateTurnContent(format)
    expect(content).toBe(
      "Translate the AISP to English. Output only the translated text.",
    )
  })

  it("works with MODE_INSTRUCTIONS values for narrative", () => {
    const format = MODE_INSTRUCTIONS.narrative
    const content = buildTranslateTurnContent(format)
    expect(content).toBe(
      "Translate the AISP to English as a narrative. Output only the translated text.",
    )
  })

  it("works with MODE_INSTRUCTIONS values for input", () => {
    const format = MODE_INSTRUCTIONS.input
    const content = buildTranslateTurnContent(format)
    expect(content).toBe(
      "Translate the AISP to English in the same style and format as the input. Output only the translated text.",
    )
  })

  it("works with MODE_INSTRUCTIONS values for hybrid", () => {
    const format = MODE_INSTRUCTIONS.hybrid
    const content = buildTranslateTurnContent(format)
    expect(content).toBe(
      "Translate the AISP to English as a narrative with supporting tables or lists for structured detail. Output only the translated text.",
    )
  })

  it("works with MODE_INSTRUCTIONS values for sketch", () => {
    const format = MODE_INSTRUCTIONS.sketch
    const content = buildTranslateTurnContent(format)
    expect(content).toBe(
      "Translate the AISP to English as a sketch. Output only the translated text.",
    )
  })

  it("works with MODE_INSTRUCTIONS values for summary", () => {
    const format = MODE_INSTRUCTIONS.summary
    const content = buildTranslateTurnContent(format)
    expect(content).toBe(
      "Translate the AISP to English as a summary. Output only the translated text.",
    )
  })

  it("all modes end with output instruction", () => {
    const modes: Mode[] = [
      "formal",
      "input",
      "narrative",
      "hybrid",
      "sketch",
      "summary",
    ]
    for (const mode of modes) {
      const format = MODE_INSTRUCTIONS[mode]
      const content = buildTranslateTurnContent(format)
      expect(content).toMatch(/Output only the translated text\.$/)
    }
  })

  it("all modes start with Translate the AISP to English", () => {
    const modes: Mode[] = [
      "formal",
      "input",
      "narrative",
      "hybrid",
      "sketch",
      "summary",
    ]
    for (const mode of modes) {
      const format = MODE_INSTRUCTIONS[mode]
      const content = buildTranslateTurnContent(format)
      expect(content).toMatch(/^Translate the AISP to English/)
    }
  })
})

describe("getReplSystem", () => {
  it("includes base getToEnglishSystem prompt", () => {
    const system = getReplSystem("formal")
    const basePrompt = getToEnglishSystem("formal")
    expect(system).toMatch(
      new RegExp(`^${basePrompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    )
  })

  it("includes session continuity instructions", () => {
    const system = getReplSystem("formal")
    expect(system).toContain("interactive refinement session")
    expect(system).toContain("conversation history")
  })

  it("formal mode has no mode modifier in base", () => {
    const system = getReplSystem("formal")
    expect(system).toContain("Translate this AISP to English.")
    expect(system).not.toMatch(
      /Translate this AISP to English (as a|in the same|sketch|summary)/,
    )
  })

  it("narrative mode includes narrative instruction", () => {
    const system = getReplSystem("narrative")
    expect(system).toContain("as a narrative")
  })

  it("hybrid mode includes table instruction", () => {
    const system = getReplSystem("hybrid")
    expect(system).toContain("supporting tables or lists")
  })

  it("input mode includes input style instruction", () => {
    const system = getReplSystem("input")
    expect(system).toContain("in the same style and format as the input")
  })

  it("sketch mode includes sketch instruction", () => {
    const system = getReplSystem("sketch")
    expect(system).toContain("as a sketch")
  })

  it("summary mode includes summary instruction", () => {
    const system = getReplSystem("summary")
    expect(system).toContain("as a summary")
  })

  it("all modes include the session refinement paragraph", () => {
    const modes: Mode[] = [
      "formal",
      "input",
      "narrative",
      "hybrid",
      "sketch",
      "summary",
    ]
    for (const mode of modes) {
      const system = getReplSystem(mode)
      expect(system).toContain("interactive refinement session")
      expect(system).toContain("Each user message is an AISP document")
    }
  })
})

describe("mode consistency", () => {
  it("buildTranslateTurnContent produces consistent output with getToEnglishSystem for all modes", () => {
    const modes: Mode[] = [
      "formal",
      "input",
      "narrative",
      "hybrid",
      "sketch",
      "summary",
    ]
    for (const mode of modes) {
      const system = getToEnglishSystem(mode)
      const turn = buildTranslateTurnContent(MODE_INSTRUCTIONS[mode])

      // Both should contain the same mode instruction
      const modeInstruction = MODE_INSTRUCTIONS[mode]
      if (modeInstruction) {
        expect(system).toContain(modeInstruction)
        expect(turn).toContain(modeInstruction)
      } else {
        // formal mode: no modifier
        expect(system).toBe(
          "Translate this AISP to English. Output only the translated text.",
        )
        expect(turn).toBe(
          "Translate the AISP to English. Output only the translated text.",
        )
      }
    }
  })

  it("getReplSystem is a superset of getToEnglishSystem", () => {
    const modes: Mode[] = [
      "formal",
      "input",
      "narrative",
      "hybrid",
      "sketch",
      "summary",
    ]
    for (const mode of modes) {
      const system = getToEnglishSystem(mode)
      const repl = getReplSystem(mode)
      // getReplSystem should contain the base system prompt
      expect(repl).toContain(system)
    }
  })
})
