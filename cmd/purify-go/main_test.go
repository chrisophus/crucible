package main

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chrisophus/crucible/internal/config"
	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/types"
)

func TestNewRootCmd_DefaultFlags(t *testing.T) {
	t.Parallel()

	cmd := newRootCmd()
	if cmd.Use == "" {
		t.Fatal("expected non-empty Use")
	}
	if cmd.Version != version {
		t.Errorf("expected version %q, got %q", version, cmd.Version)
	}
}

func TestNewRootCmd_VersionFlag(t *testing.T) {
	t.Parallel()

	cmd := newRootCmd()
	cmd.SetArgs([]string{"--version"})
	err := cmd.Execute()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResolveInput_FileInput(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	f := filepath.Join(tmp, "test.md")
	if err := os.WriteFile(f, []byte("hello world"), 0o600); err != nil {
		t.Fatal(err)
	}
	text, err := resolveInput(f, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if text != "hello world" {
		t.Errorf("expected %q, got %q", "hello world", text)
	}
}

func TestResolveInput_Positional(t *testing.T) {
	t.Parallel()

	text, err := resolveInput("", []string{"some", "text"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if text != "some text" {
		t.Errorf("expected %q, got %q", "some text", text)
	}
}

func TestResolveInput_MissingFile(t *testing.T) {
	t.Parallel()

	_, err := resolveInput("/nonexistent/file.md", nil)
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestParseModeFile_Frontmatter(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	f := filepath.Join(tmp, "mode.md")
	content := "---\nmode: narrative\n---\n\n# Some content"
	if err := os.WriteFile(f, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	mode, err := parseModeFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mode != string(types.ModeNarrative) {
		t.Errorf("expected %q, got %q", types.ModeNarrative, mode)
	}
}

func TestParseModeFile_Section(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	f := filepath.Join(tmp, "mode.md")
	content := "# Skill\n\n## Mode\nsketch\n\n## Other\nstuff"
	if err := os.WriteFile(f, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	mode, err := parseModeFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mode != string(types.ModeSketch) {
		t.Errorf("expected %q, got %q", types.ModeSketch, mode)
	}
}

func TestParseModeFile_InvalidMode(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	f := filepath.Join(tmp, "mode.md")
	content := "---\nmode: badmode\n---\n"
	if err := os.WriteFile(f, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := parseModeFile(f)
	if err == nil {
		t.Fatal("expected error for invalid mode")
	}
}

func TestParseModeFile_NotFound(t *testing.T) {
	t.Parallel()

	_, err := parseModeFile("/nonexistent/file.md")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestParseModeFile_NoMode(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	f := filepath.Join(tmp, "mode.md")
	content := "# Just some markdown\n\nNo mode here."
	if err := os.WriteFile(f, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := parseModeFile(f)
	if err == nil {
		t.Fatal("expected error when no mode found")
	}
}

func TestResolveShorthandModes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		setFlag  func(*cliFlags)
		expected string
	}{
		{"formal", func(f *cliFlags) { f.formal = true }, string(types.ModeFormal)},
		{"narrative", func(f *cliFlags) { f.narrative = true }, string(types.ModeNarrative)},
		{"hybrid", func(f *cliFlags) { f.hybrid = true }, string(types.ModeHybrid)},
		{"sketch", func(f *cliFlags) { f.sketch = true }, string(types.ModeSketch)},
		{"summary", func(f *cliFlags) { f.summary = true }, string(types.ModeSummary)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			f := cliFlags{mode: string(types.ModeFormal)}
			tt.setFlag(&f)
			f.resolveShorthandModes()
			if f.mode != tt.expected {
				t.Errorf("expected mode %q, got %q", tt.expected, f.mode)
			}
		})
	}
}

func TestResolveContradictionDetection(t *testing.T) {
	t.Parallel()

	got := resolveContradictionDetection(cliFlags{contradictions: true})
	if got != types.DetectAlways {
		t.Errorf("contradictions=true: expected always, got %s", got)
	}

	got = resolveContradictionDetection(cliFlags{noContradictions: true})
	if got != types.DetectNever {
		t.Errorf("noContradictions=true: expected never, got %s", got)
	}

	got = resolveContradictionDetection(cliFlags{})
	if got != types.DetectOnLowScore {
		t.Errorf("default: expected on_low_score, got %s", got)
	}
}

func TestResolveExternalValidation(t *testing.T) {
	t.Parallel()

	got := resolveExternalValidation(cliFlags{validate: true})
	if got != types.ValidateAlways {
		t.Errorf("validate=true: expected always, got %s", got)
	}

	got = resolveExternalValidation(cliFlags{noValidate: true})
	if got != types.ValidateNever {
		t.Errorf("noValidate=true: expected never, got %s", got)
	}

	got = resolveExternalValidation(cliFlags{})
	if got != types.ValidateNever {
		t.Errorf("default: expected never, got %s", got)
	}
}

func TestLoadContextFiles(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	f1 := filepath.Join(tmp, "a.md")
	f2 := filepath.Join(tmp, "b.md")
	if err := os.WriteFile(f1, []byte("content a"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f2, []byte("content b"), 0o600); err != nil {
		t.Fatal(err)
	}

	files, err := loadContextFiles([]string{f1, f2})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
	if files[0].Content != "content a" {
		t.Errorf("expected 'content a', got %q", files[0].Content)
	}
	if files[1].Content != "content b" {
		t.Errorf("expected 'content b', got %q", files[1].Content)
	}
}

func TestLoadContextFiles_Missing(t *testing.T) {
	t.Parallel()

	_, err := loadContextFiles([]string{"/nonexistent/file.md"})
	if err == nil {
		t.Fatal("expected error for missing context file")
	}
}

func TestInputFileAndPositionalConflict(t *testing.T) {
	t.Parallel()

	cmd := newRootCmd()
	cmd.SetArgs([]string{"-f", "some-file.md", "positional", "text"})
	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected error when both -f and positional args provided")
	}
}

func TestNewRootCmd_AllFlagsRegistered(t *testing.T) {
	t.Parallel()

	cmd := newRootCmd()
	expected := []string{
		"input", "output", "save-aisp", "context", "feedback",
		"provider", "model", "purify-model", "api-key", "base-url", "user", "insecure",
		"mode", "mode-file", "formal", "narrative", "hybrid", "sketch", "summary",
		"from-aisp", "thinking", "estimate", "repl", "suggest",
		"patch", "session", "hint",
		"contradictions", "no-contradictions", "validate", "no-validate",
		"verbose", "debug", "very-verbose",
	}
	for _, name := range expected {
		if cmd.Flags().Lookup(name) == nil {
			t.Errorf("missing flag: --%s", name)
		}
	}
}

func TestNewRootCmd_ShortFlags(t *testing.T) {
	t.Parallel()

	cmd := newRootCmd()
	shorts := map[string]string{
		"input":   "f",
		"output":  "o",
		"context": "c",
	}
	for long, short := range shorts {
		flag := cmd.Flags().Lookup(long)
		if flag == nil {
			t.Errorf("missing flag: --%s", long)
			continue
		}
		if flag.Shorthand != short {
			t.Errorf("flag --%s: expected shorthand %q, got %q", long, short, flag.Shorthand)
		}
	}
}

func TestPrintContradictions(t *testing.T) {
	t.Parallel()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	contradictions := []types.Contradiction{
		{Kind: "unsatisfiable_conjunction", Question: "Why A and B?"},
		{Kind: "unreachable_state", Question: "How to reach X?"},
	}
	printContradictions(contradictions)

	_ = w.Close()
	os.Stdout = old

	buf := make([]byte, 1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if !strings.Contains(output, "NEEDS_RESOLUTION") {
		t.Error("expected NEEDS_RESOLUTION header")
	}
	if !strings.Contains(output, "1. [unsatisfiable_conjunction] Why A and B?") {
		t.Error("expected first contradiction")
	}
	if !strings.Contains(output, "2. [unreachable_state] How to reach X?") {
		t.Error("expected second contradiction")
	}
}

func TestPrintVerbose_NoScores(t *testing.T) {
	t.Parallel()

	result := &types.PurifyRunResult{Scores: nil}
	printVerbose(true, result)
	printVerbose(false, result)
}

func TestPrintVerbose_NotVerbose(t *testing.T) {
	t.Parallel()

	result := &types.PurifyRunResult{
		Scores: &types.Scores{Delta: 0.5, Phi: 70, Tau: "◊"},
	}
	printVerbose(false, result)
}

func TestPrintVerbose_WithScores(t *testing.T) {
	t.Parallel()

	old := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	result := &types.PurifyRunResult{
		Scores: &types.Scores{Delta: 0.65, Phi: 85, Tau: "◊⁺"},
		AISP:   "test aisp content",
	}
	printVerbose(true, result)

	_ = w.Close()
	os.Stderr = old

	buf := make([]byte, 2048)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if !strings.Contains(output, "QUALITY:") {
		t.Error("expected QUALITY header")
	}
	if !strings.Contains(output, "gold") {
		t.Error("expected gold tier name")
	}
	if !strings.Contains(output, "test aisp content") {
		t.Error("expected AISP content")
	}
}

func TestEprint(t *testing.T) {
	t.Parallel()

	old := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	eprint("test message", true)

	_ = w.Close()
	os.Stderr = old

	buf := make([]byte, 1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if !strings.Contains(output, "test message") {
		t.Error("expected test message in stderr")
	}
}

func TestEprint_NotVerbose(t *testing.T) {
	t.Parallel()

	old := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	eprint("test message", false)

	_ = w.Close()
	os.Stderr = old

	buf := make([]byte, 1024)
	n, _ := r.Read(buf)
	if n > 0 {
		t.Error("expected no output when verbose=false")
	}
}

func TestScanLines(t *testing.T) {
	t.Parallel()

	input := "line1\nline2\nline3\n\nignored"
	scanner := bufio.NewScanner(strings.NewReader(input))
	result := scanLines(scanner)
	if result != "line1\nline2\nline3" {
		t.Errorf("expected %q, got %q", "line1\nline2\nline3", result)
	}
}

func TestScanLines_Empty(t *testing.T) {
	t.Parallel()

	input := "\n"
	scanner := bufio.NewScanner(strings.NewReader(input))
	result := scanLines(scanner)
	if result != "" {
		t.Errorf("expected empty string, got %q", result)
	}
}

func TestScanLines_EOF(t *testing.T) {
	t.Parallel()

	input := "single line"
	scanner := bufio.NewScanner(strings.NewReader(input))
	result := scanLines(scanner)
	if result != "single line" {
		t.Errorf("expected %q, got %q", "single line", result)
	}
}

func TestNewLLM_Anthropic(t *testing.T) {
	t.Parallel()

	llm := newLLM(types.ProviderAnthropic, "key", "model", "")
	if llm == nil {
		t.Fatal("expected non-nil LLM")
	}
}

func TestNewLLM_OpenAI(t *testing.T) {
	t.Parallel()

	llm := newLLM(types.ProviderOpenAI, "key", "model", "https://example.com")
	if llm == nil {
		t.Fatal("expected non-nil LLM")
	}
}

func TestNewLLM_Default(t *testing.T) {
	t.Parallel()

	llm := newLLM("unknown", "key", "model", "")
	if llm == nil {
		t.Fatal("expected non-nil LLM for unknown provider (defaults to anthropic)")
	}
}

func TestBuildDeps(t *testing.T) {
	t.Parallel()

	resolved := config.ResolvedOpts{
		Provider:   types.ProviderAnthropic,
		MainModel:  "claude-sonnet-4-6",
		CheapModel: "claude-haiku-4-5-20251001",
		APIKey:     "test-key",
	}
	deps := buildDeps(resolved)
	if deps.MainLLM == nil || deps.CheapLLM == nil || deps.Store == nil {
		t.Fatal("expected all deps to be non-nil")
	}
}

func TestRun_PatchRequiresSession(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	f := filepath.Join(tmp, "test.md")
	if err := os.WriteFile(f, []byte("some content"), 0o600); err != nil {
		t.Fatal(err)
	}

	flags := cliFlags{
		patch:     true,
		inputFile: f,
	}
	err := run(flags, nil)
	if err == nil || !strings.Contains(err.Error(), "--session") {
		t.Fatalf("expected session error, got: %v", err)
	}
}

func TestRun_PatchRequiresInput(t *testing.T) {
	t.Parallel()

	flags := cliFlags{
		patch:     true,
		sessionID: "some-id",
	}
	err := run(flags, nil)
	if err == nil || !strings.Contains(err.Error(), "--patch requires") {
		t.Fatalf("expected input error, got: %v", err)
	}
}

func TestValidModes(t *testing.T) {
	t.Parallel()

	expected := []string{"formal", "input", "narrative", "hybrid", "sketch", "summary"}
	for _, m := range expected {
		if !validModes[m] {
			t.Errorf("expected %q to be valid", m)
		}
	}
	if validModes["invalid-mode"] {
		t.Error("expected 'invalid-mode' to be invalid")
	}
}

func TestResolveModeFile_EnvVar(t *testing.T) {
	tmp := t.TempDir()
	mf := filepath.Join(tmp, "mode.md")
	if err := os.WriteFile(mf, []byte("---\nmode: hybrid\n---\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("PURIFY_MODE_FILE", mf)

	f := &cliFlags{}
	cmd := newRootCmd()
	err := f.resolveModeFile(cmd)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.mode != "hybrid" {
		t.Errorf("expected mode %q, got %q", "hybrid", f.mode)
	}
}

func TestTranslateAndPrint_Contradictions(t *testing.T) {
	t.Parallel()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	result := &types.PurifyRunResult{
		Status: types.StatusHasContradictions,
		Contradictions: []types.Contradiction{
			{Kind: "unsatisfiable_conjunction", Question: "Q1"},
		},
	}
	err := translateAndPrint(context.Background(), result, cliFlags{}, pipeline.Deps{})
	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	buf := make([]byte, 1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])
	if !strings.Contains(output, "NEEDS_RESOLUTION") {
		t.Error("expected NEEDS_RESOLUTION")
	}
}

func TestRun_EnvDefaults(t *testing.T) {
	t.Setenv("PURIFY_PROVIDER", "openai")
	t.Setenv("PURIFY_MODE", string(types.ModeSketch))
	t.Setenv("OPENAI_BASE_URL", "https://example.com")
	t.Setenv("OPENAI_USER", "testuser")
	t.Setenv("OPENAI_INSECURE", "1")

	flags := cliFlags{mode: "formal"}
	err := run(flags, []string{"test text"})
	if err == nil {
		t.Fatal("expected error (missing API key)")
	}
}

func TestResolveEnvDefaults(t *testing.T) {
	t.Setenv("PURIFY_PROVIDER", "openai")
	t.Setenv("PURIFY_MODE", string(types.ModeSketch))
	t.Setenv("OPENAI_BASE_URL", "https://api.example.com")
	t.Setenv("OPENAI_USER", "testuser")
	t.Setenv("OPENAI_INSECURE", "1")

	f := &cliFlags{mode: "formal"}
	f.resolveEnvDefaults()

	if f.providerStr != "openai" {
		t.Errorf("expected provider openai, got %q", f.providerStr)
	}
	if f.mode != string(types.ModeSketch) {
		t.Errorf("expected mode sketch, got %q", f.mode)
	}
	if f.baseURL != "https://api.example.com" {
		t.Errorf("expected baseURL, got %q", f.baseURL)
	}
	if f.openaiUser != "testuser" {
		t.Errorf("expected openaiUser testuser, got %q", f.openaiUser)
	}
	if !f.insecure {
		t.Error("expected insecure=true")
	}
}

func TestResolveEnvDefaults_NoOverwrite(t *testing.T) {
	t.Parallel()

	f := &cliFlags{
		mode:        string(types.ModeNarrative),
		providerStr: "anthropic",
		baseURL:     "https://existing.com",
		openaiUser:  "existinguser",
		insecure:    true,
	}
	f.resolveEnvDefaults()

	if f.providerStr != "anthropic" {
		t.Errorf("should not overwrite provider, got %q", f.providerStr)
	}
	if f.baseURL != "https://existing.com" {
		t.Errorf("should not overwrite baseURL, got %q", f.baseURL)
	}
	if f.openaiUser != "existinguser" {
		t.Errorf("should not overwrite openaiUser, got %q", f.openaiUser)
	}
}
