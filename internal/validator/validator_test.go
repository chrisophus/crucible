package validator_test

import (
	"testing"

	"github.com/chrisophus/crucible/internal/types"
	"github.com/chrisophus/crucible/internal/validator"
)

func TestParseEvidence(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		input      string
		wantDelta  *float64
		wantSymbol string
		wantName   string
	}{
		{
			name:       "platinum with explicit tier",
			input:      `δ≜0.80 τ≜◊⁺⁺`,
			wantDelta:  float64Ptr(0.80),
			wantSymbol: "◊⁺⁺",
			wantName:   "platinum",
		},
		{
			name:       "gold from delta only",
			input:      `δ≜0.65`,
			wantDelta:  float64Ptr(0.65),
			wantSymbol: "◊⁺",
			wantName:   "gold",
		},
		{
			name:       "silver from delta",
			input:      `δ=0.45`,
			wantDelta:  float64Ptr(0.45),
			wantSymbol: "◊",
			wantName:   "silver",
		},
		{
			name:       "bronze from delta",
			input:      `δ≜0.25`,
			wantDelta:  float64Ptr(0.25),
			wantSymbol: "◊⁻",
			wantName:   "bronze",
		},
		{
			name:       "invalid from low delta",
			input:      `δ≜0.10`,
			wantDelta:  float64Ptr(0.10),
			wantSymbol: "⊘",
			wantName:   "invalid",
		},
		{
			name:       "no delta or tier",
			input:      `some random text`,
			wantDelta:  nil,
			wantSymbol: "⊘",
			wantName:   "invalid",
		},
		{
			name:       "explicit tier overrides delta",
			input:      `δ≜0.10 τ≜◊⁺`,
			wantDelta:  float64Ptr(0.10),
			wantSymbol: "◊⁺",
			wantName:   "gold",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			ev := validator.ParseEvidence(tt.input)
			assertDelta(t, ev.Delta, tt.wantDelta)

			if ev.TierSymbol != tt.wantSymbol {
				t.Errorf("TierSymbol = %q, want %q", ev.TierSymbol, tt.wantSymbol)
			}

			if ev.TierName != tt.wantName {
				t.Errorf("TierName = %q, want %q", ev.TierName, tt.wantName)
			}
		})
	}
}

func TestComputeTier(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		delta float64
		phi   int
		want  types.QualityTier
	}{
		{"platinum", 0.80, 96, types.TierPlatinum},
		{"gold", 0.65, 85, types.TierGold},
		{"silver", 0.45, 70, types.TierSilver},
		{"bronze", 0.25, 45, types.TierBronze},
		{"invalid low delta", 0.10, 10, types.TierInvalid},
		{"high delta low phi", 0.80, 50, types.TierBronze},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := validator.ComputeTier(tt.delta, tt.phi)
			if got != tt.want {
				t.Errorf("ComputeTier(%v, %d) = %q, want %q", tt.delta, tt.phi, got, tt.want)
			}
		})
	}
}

func TestParsePhi(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  int
	}{
		{"explicit phi", `φ≜95`, 95},
		{"phi with equals", `φ=80`, 80},
		{"no phi defaults to 65", `no phi here`, 65},
		{"phi over 100 capped", `φ≜150`, 100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := validator.ParsePhi(tt.input)
			if got != tt.want {
				t.Errorf("ParsePhi(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestTierNames(t *testing.T) {
	t.Parallel()

	expected := map[string]string{
		"◊⁺⁺": "platinum",
		"◊⁺":  "gold",
		"◊":   "silver",
		"◊⁻":  "bronze",
		"⊘":   "invalid",
	}

	for sym, name := range expected {
		if validator.TierNames[sym] != name {
			t.Errorf("TierNames[%q] = %q, want %q", sym, validator.TierNames[sym], name)
		}
	}
}

func float64Ptr(v float64) *float64 { return &v }

func assertDelta(t *testing.T, got, want *float64) {
	t.Helper()

	if got == nil && want == nil {
		return
	}

	if (got == nil) != (want == nil) {
		t.Errorf("delta: got %v, want %v", got, want)
		return
	}

	diff := *got - *want
	if diff < -0.001 || diff > 0.001 {
		t.Errorf("delta = %f, want %f", *got, *want)
	}
}
