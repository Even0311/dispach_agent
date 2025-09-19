#!/bin/bash

set -e  # Exit on any error

echo "🚀 Starting CDK deployment..."

# Build telephony lambdas first
echo "📦 Building telephony Lambda functions..."
cd ../telephony-lambdas
npm run build
npm run package

# Go back to infrastructure directory
cd ../infra

echo "🔍 Checking CDK diff..."
npx cdk diff

echo ""
read -p "Do you want to proceed with deployment? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🏗️  Deploying infrastructure stack..."
    npx cdk deploy DispatchAgentStack --require-approval never

    echo "📱 Deploying telephony lambdas stack..."
    npx cdk deploy TelephonyLambdasStack --require-approval never

    echo "✅ Deployment completed successfully!"
    echo ""
    echo "📋 Function URLs:"
    npx cdk list --json | jq -r '.[] | select(.name == "TelephonyLambdasStack") | .outputs | to_entries[] | select(.key | contains("Url")) | "\(.key): \(.value)"'

    echo ""
    echo "🔧 Next steps:"
    echo "1. Copy the Function URLs above"
    echo "2. Configure Twilio webhooks with these URLs"
    echo "3. Test with a phone call"
else
    echo "❌ Deployment cancelled"
    exit 0
fi