.PHONY: build test dev
build:
	npm --prefix web ci
	npm --prefix web run build
	go build -buildvcs=false -o bin/remoter ./cmd/remoter
test:
	go test -race ./...
	npm --prefix web test
	npm --prefix web run build
dev:
	go run -buildvcs=false ./cmd/remoter
