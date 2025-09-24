#!/bin/bash

# Deployment script for Electrician React Agent
# This script builds, tests, and deploys the agent to AWS Lambda

set -e  # Exit on any error

echo "🔧 Deploying Electrician React Agent..."

# Check required environment variables
if [ -z "$LANGSMITH_API_KEY" ]; then
    echo "⚠️  Warning: LANGSMITH_API_KEY not set. Tracing will be disabled."
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🏗️  Building TypeScript..."
npm run build

if [ ! -d "dist" ]; then
    echo "❌ Build failed: dist directory not found"
    exit 1
fi

# Run tests (if they exist)
if [ -f "dist/test-agent.js" ]; then
    echo "🧪 Running tests..."
    node dist/test-agent.js
fi

# Create deployment package
echo "📦 Creating deployment package..."
cp package.json dist/
cd dist
npm install --production --silent

# Create zip file
echo "🗜️  Creating Lambda deployment package..."
zip -r ../react-agent-lambda.zip . > /dev/null

cd ..

echo "✅ Deployment package created: react-agent-lambda.zip"
echo "📁 Size: $(du -h react-agent-lambda.zip | cut -f1)"

# Deploy using CDK (if in the root project)
if [ -f "../../cdk.json" ] || [ -f "../../../cdk.json" ]; then
    echo "🚀 Deploying to AWS using CDK..."

    # Find the CDK directory
    CDK_DIR=""
    if [ -f "../../cdk.json" ]; then
        CDK_DIR="../.."
    elif [ -f "../../../cdk.json" ]; then
        CDK_DIR="../../.."
    fi

    if [ -n "$CDK_DIR" ]; then
        cd $CDK_DIR
        npx cdk deploy ReactAgentStack --require-approval never
        cd - > /dev/null

        echo "✅ Deployment completed successfully!"
        echo "🌐 Check AWS Console for API Gateway URL"
    fi
else
    echo "ℹ️  CDK not found. Use the zip file to deploy manually:"
    echo "   AWS Lambda Console → Create/Update Function → Upload react-agent-lambda.zip"
fi

echo ""
echo "🎉 Deployment process completed!"
echo ""
echo "Next steps:"
echo "1. Set environment variables in Lambda console:"
echo "   - LANGSMITH_API_KEY (optional)"
echo "   - LANGSMITH_PROJECT (optional)"
echo "2. Test the API endpoint"
echo "3. Monitor CloudWatch logs for any issues"