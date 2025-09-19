#!/bin/bash

set -e  # Exit on any error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE} $1 ${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_header "🔍 Telephony System Validation"

# Check CDK syntax
print_status "Validating CDK syntax..."
if npm run build; then
    print_success "TypeScript compilation successful"
else
    print_error "TypeScript compilation failed"
    exit 1
fi

# Create placeholder dist files for validation
print_status "Creating placeholder files for validation..."
cd ../telephony-lambdas
mkdir -p dist/voice-handler dist/gather-handler dist/status-handler
echo 'exports.handler = async () => ({ statusCode: 200, body: "placeholder" });' > dist/voice-handler/index.js
echo 'exports.handler = async () => ({ statusCode: 200, body: "placeholder" });' > dist/gather-handler/index.js
echo 'exports.handler = async () => ({ statusCode: 200, body: "placeholder" });' > dist/status-handler/index.js
cd ../infra

# Synthesize stacks
print_status "Synthesizing CDK stacks..."
if npx cdk synth --app "npx ts-node --prefer-ts-exts bin/minimal-app.ts" --quiet; then
    print_success "CDK synthesis successful"
else
    print_error "CDK synthesis failed"
    exit 1
fi

# List stacks
print_status "Available stacks:"
npx cdk list --app "npx ts-node --prefer-ts-exts bin/minimal-app.ts"

print_header "✅ Validation Completed Successfully"
print_status "Your minimal telephony system is ready for deployment!"
echo ""
print_status "To deploy, run: ./deploy-minimal.sh"
print_status "To destroy, run: ./destroy-minimal.sh"