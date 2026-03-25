.PHONY: install build test typecheck clean
.PHONY: go-build go-test go-lint go-cover go-clean

# ── Node.js targets ──────────────────────────────────────────────────────────

install: build
	npm install -g .

build:
	npm install
	node build.mjs

test:
	npm test

typecheck:
	npx tsc --noEmit

clean: go-clean
	rm -rf dist

# ── Go targets ───────────────────────────────────────────────────────────────

GO_CMD = ./cmd/purify-go
GO_COVER_THRESHOLD = 80

go-build:
	go build -o dist/purify-go $(GO_CMD)

go-test:
	go test -race ./...

go-lint:
	golangci-lint run ./...

go-cover:
	@go test -coverprofile=coverage.out ./internal/...
	@go tool cover -func=coverage.out | tail -1
	@COVERAGE=$$(go tool cover -func=coverage.out | tail -1 | awk '{print $$3}' | tr -d '%'); \
	THRESHOLD=$(GO_COVER_THRESHOLD); \
	if [ $$(echo "$$COVERAGE < $$THRESHOLD" | bc -l) -eq 1 ]; then \
		echo "FAIL: coverage $$COVERAGE% is below threshold $$THRESHOLD%"; \
		exit 1; \
	else \
		echo "OK: coverage $$COVERAGE% meets threshold $$THRESHOLD%"; \
	fi

go-clean:
	rm -f dist/purify-go coverage.out
