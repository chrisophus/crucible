.PHONY: install build test typecheck clean

install: build
	npm install -g .

build:
	npm install
	node build.mjs

test:
	npm test

typecheck:
	npx tsc --noEmit

clean:
	rm -rf dist
