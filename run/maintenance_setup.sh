#!/bin/bash
# Maintenance Setup Script
npm install
cd cli && go mod download
echo "Maintenance setup complete."
