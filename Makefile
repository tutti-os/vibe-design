PORT ?= 3000

.PHONY: dev start ensure-dev-ready ensure-node-modules install build-web test type-check

dev: ensure-dev-ready
	PORT=$(PORT) pnpm dev

start: ensure-dev-ready
	PORT=$(PORT) pnpm start

ensure-dev-ready: ensure-node-modules

ensure-node-modules:
	@if [ ! -d node_modules ] || [ ! -x web/node_modules/.bin/tailwindcss ]; then \
		echo "Installing workspace dependencies..."; \
		pnpm install; \
	fi

install:
	pnpm install

build-web: ensure-dev-ready
	pnpm build:web

test:
	pnpm test

type-check:
	pnpm type-check
