BINARY_NAME=ai-remote-agent
VERSION=1.0.0

.PHONY: build build-linux build-linux-arm64 build-windows clean

build:
	go build -ldflags "-s -w" -o bin/$(BINARY_NAME) ./cmd/agent

build-linux:
	GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o bin/$(BINARY_NAME)-linux-amd64 ./cmd/agent

build-linux-arm64:
	GOOS=linux GOARCH=arm64 go build -ldflags "-s -w" -o bin/$(BINARY_NAME)-linux-arm64 ./cmd/agent

build-windows:
	GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o bin/$(BINARY_NAME)-windows-amd64.exe ./cmd/agent

build-all: build-linux build-linux-arm64 build-windows

clean:
	rm -rf bin/
