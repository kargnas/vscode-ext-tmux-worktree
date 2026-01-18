# AI Agentic Coding Environment Setup

This document guides you through setting up the development environment for AI Agents (and human coders).

## 🚀 Quick Start

### 1. Environment Setup

```bash
# Copy AI-ready env (if needed, though currently empty)
cp -n .env.ai-ready .env

# Install Node dependencies
npm install

# Install Go dependencies (for CLI)
cd cli && go mod download && cd ..
```

### 2. Services

This project does not require heavy external services like MySQL or Redis.
It relies on:
- **VS Code**: The host environment.
- **tmux**: Must be installed on the system.
- **git**: Must be installed.

### 3. Testing

```bash
# Run ESLint
npm run lint

# Compile Extension
npm run compile
```

### 4. CLI Development

The CLI is written in Go.

```bash
cd cli
go build -o twt ./main.go
./twt
```
