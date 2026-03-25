# Claude Development Rules

## Go Development

- After finishing Go development, always run unit tests: `go test ./...`
- Code coverage requirement: **80% minimum** — verify with `go test -coverprofile=coverage.out ./... && go tool cover -func=coverage.out`
- Run linter before committing: `golangci-lint run ./...`
- Go code lives at repo root: `cmd/purify-go/` (CLI) and `internal/` (library packages)
- Run `go vet ./...` before committing

## TypeScript Development

- Run tests: `npm test`
- Run lint and format check: `npm run check`
- Run type checking: `npm run typecheck`
- Build: `npm run build`

## General

- Always run relevant tests before considering work complete
- Do not commit files containing secrets (.env, credentials, API keys)
