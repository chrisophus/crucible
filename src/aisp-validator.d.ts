declare module "aisp-validator" {
  interface AISPModule {
    init(): Promise<void>
    validate(aisp: string): {
      valid: boolean
      tier?: string
      ambiguity?: number
    }
  }

  interface SemanticDensity {
    delta: number
    pureDensity: number
  }

  const AISP: AISPModule
  export function calculateSemanticDensity(aisp: string): SemanticDensity
  export default AISP
}
