#!/bin/bash
# Codex Cloud Setup Script
apt-get update && apt-get install -y tmux git
npm install
cd cli && go mod download
echo "Setup complete."
