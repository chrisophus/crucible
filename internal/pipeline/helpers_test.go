package pipeline

import (
	"testing"

	"github.com/chrisophus/crucible/internal/types"
)

func TestStripFences(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "no fences",
			input: "plain text",
			want:  "plain text",
		},
		{
			name:  "with fences",
			input: "```\ncontent here\n```",
			want:  "content here",
		},
		{
			name:  "with language tag",
			input: "```json\n{\"key\": \"val\"}\n```",
			want:  "{\"key\": \"val\"}",
		},
		{
			name:  "leading whitespace",
			input: "  \n```\ncontent\n```\n  ",
			want:  "content",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := stripFences(tt.input)
			if got != tt.want {
				t.Errorf("stripFences(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestTierBelow(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		a, b types.QualityTier
		want bool
	}{
		{"invalid below silver", types.TierInvalid, types.TierSilver, true},
		{"platinum not below gold", types.TierPlatinum, types.TierGold, false},
		{"same tier", types.TierSilver, types.TierSilver, false},
		{"bronze below gold", types.TierBronze, types.TierGold, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := tierBelow(tt.a, tt.b)
			if got != tt.want {
				t.Errorf("tierBelow(%q, %q) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestParseJSON(t *testing.T) {
	t.Parallel()

	t.Run("plain JSON", func(t *testing.T) {
		t.Parallel()

		type result struct {
			Key string `json:"key"`
		}

		got, err := parseJSON[result](`{"key": "value"}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if got.Key != "value" {
			t.Errorf("Key = %q, want %q", got.Key, "value")
		}
	})

	t.Run("fenced JSON", func(t *testing.T) {
		t.Parallel()

		type result struct {
			Key string `json:"key"`
		}

		got, err := parseJSON[result]("```json\n{\"key\": \"fenced\"}\n```")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if got.Key != "fenced" {
			t.Errorf("Key = %q, want %q", got.Key, "fenced")
		}
	})

	t.Run("invalid JSON", func(t *testing.T) {
		t.Parallel()

		type result struct {
			Key string `json:"key"`
		}

		_, err := parseJSON[result]("not json")
		if err == nil {
			t.Error("expected error for invalid JSON")
		}
	})
}

func TestComputeGaps(t *testing.T) {
	t.Parallel()

	t.Run("low delta", func(t *testing.T) {
		t.Parallel()

		scores := types.Scores{Delta: 0.3, Phi: 80, Tau: types.TierBronze}
		gaps := computeGaps(nil, scores)

		if len(gaps) != 1 || gaps[0].Signal != types.GapLowDelta {
			t.Errorf("expected low_delta gap, got %v", gaps)
		}
	})

	t.Run("invalid validator result", func(t *testing.T) {
		t.Parallel()

		scores := types.Scores{Delta: 0.3, Phi: 80, Tau: types.TierBronze}
		vr := &types.ValidatorResult{Valid: false}
		gaps := computeGaps(vr, scores)

		if len(gaps) != 2 {
			t.Errorf("expected 2 gaps, got %d", len(gaps))
		}
	})

	t.Run("no gaps", func(t *testing.T) {
		t.Parallel()

		scores := types.Scores{Delta: 0.8, Phi: 95, Tau: types.TierPlatinum}
		gaps := computeGaps(nil, scores)

		if len(gaps) != 0 {
			t.Errorf("expected no gaps, got %d", len(gaps))
		}
	})
}

func TestComputeScoresFromAISP(t *testing.T) {
	t.Parallel()

	t.Run("full AISP", func(t *testing.T) {
		t.Parallel()

		aisp := `DOMAIN≜"test" φ≜95 δ≜0.80 τ≜◊⁺⁺`
		scores := computeScoresFromAISP(aisp)

		if scores.Delta < 0.79 || scores.Delta > 0.81 {
			t.Errorf("Delta = %f, want ~0.80", scores.Delta)
		}

		if scores.Phi != 95 {
			t.Errorf("Phi = %d, want 95", scores.Phi)
		}
	})

	t.Run("no evidence", func(t *testing.T) {
		t.Parallel()

		scores := computeScoresFromAISP("no evidence here")

		if scores.Delta != 0 {
			t.Errorf("Delta = %f, want 0", scores.Delta)
		}
	})
}
