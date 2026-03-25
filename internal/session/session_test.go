package session_test

import (
	"testing"
	"time"

	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
)

func TestCreateAndGet(t *testing.T) {
	t.Parallel()

	store := session.NewStore()
	cfg := types.DefaultConfig()
	sess := store.Create("system prompt", cfg)

	if sess.ID == "" {
		t.Fatal("session ID should not be empty")
	}

	if sess.SystemPrompt != "system prompt" {
		t.Errorf("SystemPrompt = %q, want %q", sess.SystemPrompt, "system prompt")
	}

	got, err := store.Get(sess.ID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}

	if got.ID != sess.ID {
		t.Errorf("got ID = %q, want %q", got.ID, sess.ID)
	}
}

func TestGetNotFound(t *testing.T) {
	t.Parallel()

	store := session.NewStore()

	_, err := store.Get("nonexistent-id")
	if err == nil {
		t.Fatal("expected error for nonexistent session")
	}
}

func TestSessionExpiry(t *testing.T) {
	t.Parallel()

	store := session.NewStore()
	now := time.Now()

	store.SetNowFunc(func() time.Time { return now })

	cfg := types.DefaultConfig()
	sess := store.Create("prompt", cfg)

	// Advance past TTL
	expired := now.Add(session.InactivityTTL + time.Minute)
	store.SetNowFunc(func() time.Time { return expired })

	_, err := store.Get(sess.ID)
	if err == nil {
		t.Fatal("expected error for expired session")
	}
}

func TestSaveUpdatesSession(t *testing.T) {
	t.Parallel()

	store := session.NewStore()
	cfg := types.DefaultConfig()
	sess := store.Create("prompt", cfg)

	sess.AISPCurrent = "updated AISP"
	store.Save(sess)

	got, err := store.Get(sess.ID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}

	if got.AISPCurrent != "updated AISP" {
		t.Errorf("AISPCurrent = %q, want %q", got.AISPCurrent, "updated AISP")
	}
}

func TestGetRefreshesTTL(t *testing.T) {
	t.Parallel()

	store := session.NewStore()
	now := time.Now()

	store.SetNowFunc(func() time.Time { return now })

	cfg := types.DefaultConfig()
	sess := store.Create("prompt", cfg)

	// Advance to just before expiry
	almostExpired := now.Add(session.InactivityTTL - time.Minute)
	store.SetNowFunc(func() time.Time { return almostExpired })

	// Access refreshes TTL
	_, err := store.Get(sess.ID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}

	// Advance another 29 minutes (within new TTL window)
	afterRefresh := almostExpired.Add(29 * time.Minute)
	store.SetNowFunc(func() time.Time { return afterRefresh })

	_, err = store.Get(sess.ID)
	if err != nil {
		t.Fatal("session should still be valid after TTL refresh")
	}
}
