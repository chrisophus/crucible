package types_test

import (
	"testing"

	"github.com/chrisophus/crucible/internal/types"
)

func TestDefaultConfig(t *testing.T) {
	t.Parallel()

	cfg := types.DefaultConfig()

	if cfg.ContradictionDetection != types.DetectOnLowScore {
		t.Errorf("ContradictionDetection = %q, want %q",
			cfg.ContradictionDetection, types.DetectOnLowScore)
	}

	if cfg.ExternalValidation != types.ValidateNever {
		t.Errorf("ExternalValidation = %q, want %q",
			cfg.ExternalValidation, types.ValidateNever)
	}

	if cfg.ScoreThreshold != types.TierSilver {
		t.Errorf("ScoreThreshold = %q, want %q", cfg.ScoreThreshold, types.TierSilver)
	}

	if !cfg.AskOnContradiction {
		t.Error("AskOnContradiction should be true")
	}
}

func TestTierOrder(t *testing.T) {
	t.Parallel()

	if types.TierOrder[types.TierInvalid] >= types.TierOrder[types.TierBronze] {
		t.Error("invalid should be below bronze")
	}

	if types.TierOrder[types.TierBronze] >= types.TierOrder[types.TierSilver] {
		t.Error("bronze should be below silver")
	}

	if types.TierOrder[types.TierSilver] >= types.TierOrder[types.TierGold] {
		t.Error("silver should be below gold")
	}

	if types.TierOrder[types.TierGold] >= types.TierOrder[types.TierPlatinum] {
		t.Error("gold should be below platinum")
	}
}
