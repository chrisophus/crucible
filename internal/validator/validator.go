// Package validator parses quality evidence from AISP text.
package validator

import (
	"regexp"
	"strconv"

	"github.com/chrisophus/crucible/internal/types"
)

// TierNames maps tier symbols to human-readable names.
var TierNames = map[string]string{
	"◊⁺⁺": "platinum",
	"◊⁺":  "gold",
	"◊":   "silver",
	"◊⁻":  "bronze",
	"⊘":   "invalid",
}

var (
	deltaRe = regexp.MustCompile(`δ[≜=]\s*([\d.]+)`)
	tierRe  = regexp.MustCompile(`τ[≜=]\s*(◊⁺⁺|◊⁺|◊⁻|◊|⊘)`)
	phiRe   = regexp.MustCompile(`φ[≜=]\s*(\d+)`)
)

// ParseEvidence extracts delta and tier from AISP text.
func ParseEvidence(aisp string) types.Evidence {
	delta := parseDelta(aisp)
	tierSymbol := parseTierSymbol(aisp, delta)

	tierName := TierNames[tierSymbol]
	if tierName == "" {
		tierName = "unknown"
	}

	return types.Evidence{
		Delta:      delta,
		TierSymbol: tierSymbol,
		TierName:   tierName,
	}
}

func parseDelta(aisp string) *float64 {
	m := deltaRe.FindStringSubmatch(aisp)
	if m == nil {
		return nil
	}

	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return nil
	}

	return &v
}

func parseTierSymbol(aisp string, delta *float64) string {
	if m := tierRe.FindStringSubmatch(aisp); m != nil {
		return m[1]
	}

	if delta != nil {
		return tierFromDelta(*delta)
	}

	return "⊘"
}

func tierFromDelta(d float64) string {
	switch {
	case d >= 0.75:
		return "◊⁺⁺"
	case d >= 0.6:
		return "◊⁺"
	case d >= 0.4:
		return "◊"
	case d >= 0.2:
		return "◊⁻"
	default:
		return "⊘"
	}
}

// ComputeTier determines the quality tier from delta and phi.
func ComputeTier(delta float64, phi int) types.QualityTier {
	switch {
	case delta >= 0.75 && phi >= 95:
		return types.TierPlatinum
	case delta >= 0.6 && phi >= 80:
		return types.TierGold
	case delta >= 0.4 && phi >= 65:
		return types.TierSilver
	case delta >= 0.2 && phi >= 40:
		return types.TierBronze
	default:
		return types.TierInvalid
	}
}

// ParsePhi extracts the phi completeness score from AISP text.
func ParsePhi(aisp string) int {
	m := phiRe.FindStringSubmatch(aisp)
	if m == nil {
		return 65
	}

	v, err := strconv.Atoi(m[1])
	if err != nil {
		return 65
	}

	if v > 100 {
		return 100
	}

	return v
}
