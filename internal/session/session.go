// Package session provides in-memory session storage with TTL expiry.
package session

import (
	"errors"
	"sync"
	"time"

	"github.com/chrisophus/crucible/internal/types"
	"github.com/google/uuid"
)

// InactivityTTL is the duration after which idle sessions expire.
const InactivityTTL = 30 * time.Minute

// ErrNotFound is returned when a session is not found or expired.
var ErrNotFound = errors.New("session not found or expired")

type entry struct {
	session    *types.Session
	lastActive time.Time
}

// Store manages session state with thread-safe access.
type Store struct {
	mu      sync.RWMutex
	entries map[string]*entry
	nowFunc func() time.Time
}

// NewStore creates a new session store.
func NewStore() *Store {
	return &Store{
		entries: make(map[string]*entry),
		nowFunc: time.Now,
	}
}

// SetNowFunc overrides the time source (for testing).
func (s *Store) SetNowFunc(fn func() time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.nowFunc = fn
}

// Create initializes a new session and stores it.
func (s *Store) Create(systemPrompt string, cfg types.Config) *types.Session {
	s.cleanExpired()

	sess := &types.Session{
		ID:           uuid.New().String(),
		SystemPrompt: systemPrompt,
		Messages:     []types.ConvMessage{},
		Config:       cfg,
	}

	s.mu.Lock()
	s.entries[sess.ID] = &entry{
		session:    sess,
		lastActive: s.nowFunc(),
	}
	s.mu.Unlock()

	return sess
}

// Get retrieves a session by ID, refreshing its TTL.
func (s *Store) Get(id string) (*types.Session, error) {
	s.cleanExpired()

	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.entries[id]
	if !ok {
		return nil, ErrNotFound
	}

	e.lastActive = s.nowFunc()

	return e.session, nil
}

// Save persists updates to a session.
func (s *Store) Save(sess *types.Session) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if e, ok := s.entries[sess.ID]; ok {
		e.session = sess
		e.lastActive = s.nowFunc()
	}
}

func (s *Store) cleanExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.nowFunc()

	for id, e := range s.entries {
		if now.Sub(e.lastActive) > InactivityTTL {
			delete(s.entries, id)
		}
	}
}
