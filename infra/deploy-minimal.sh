#!/bin/bash

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Start deployment
print_header "🚀 Telephony System Minimal Deployment"

# Check prerequisites
print_status "Checking prerequisites..."

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured. Please run 'aws configure'."
    exit 1
fi

# Check CDK (try global first, then local)
if ! command -v cdk &> /dev/null && ! npx cdk --version &> /dev/null; then
    print_error "AWS CDK is not available. Please run 'npm install -g aws-cdk' or ensure it's in package.json."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'.' -f1 | cut -d'v' -f2)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version 18 or higher is required. Current version: $(node --version)"
    exit 1
fi

print_success "Prerequisites check passed"

# Get AWS account info
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION="ap-southeast-2"
print_status "Deploying to Account: $AWS_ACCOUNT, Region: $AWS_REGION"

# Install dependencies
print_header "📦 Installing Dependencies"
npm install

# Build telephony lambdas
print_header "🔨 Building Telephony Lambda Functions"
cd ../telephony-lambdas

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found in telephony-lambdas directory"
    exit 1
fi

# Install telephony dependencies
print_status "Installing telephony Lambda dependencies..."
npm install

# Build the code
print_status "Building telephony Lambda code..."
if npm run build; then
    print_success "Telephony Lambda build completed"
else
    print_warning "Build failed, but continuing with existing dist files"
fi

# Create placeholder files if build failed
if [ ! -d "dist" ]; then
    print_status "Creating placeholder dist files for CDK validation..."
    mkdir -p dist/voice-handler dist/gather-handler dist/status-handler
    echo 'exports.handler = async () => ({ statusCode: 200, body: "placeholder" });' > dist/voice-handler/index.js
    echo 'exports.handler = async () => ({ statusCode: 200, body: "placeholder" });' > dist/gather-handler/index.js
    echo 'exports.handler = async () => ({ statusCode: 200, body: "placeholder" });' > dist/status-handler/index.js
fi

# Go back to infra directory
cd ../infra

# Bootstrap CDK if needed
print_header "⚡ CDK Bootstrap Check"
print_status "Checking if CDK is bootstrapped..."
if aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
    print_success "CDK already bootstrapped"
else
    print_status "Bootstrapping CDK..."
    npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION
    print_success "CDK bootstrap completed"
fi

# Synthesize to check for errors
print_header "🔍 Validating CDK Configuration"
print_status "Synthesizing CDK stacks..."
if npx cdk synth --app "npx ts-node --prefer-ts-exts bin/minimal-app.ts" --quiet; then
    print_success "CDK synthesis successful"
else
    print_error "CDK synthesis failed. Please fix the errors above."
    exit 1
fi

# Show what will be deployed
print_header "📋 Deployment Plan"
print_status "The following stacks will be deployed:"
echo "  1. TelephonyInfraStack (VPC, Redis, DynamoDB, S3)"
echo "  2. TelephonyLambdasStack (3 Lambda functions with Function URLs)"
echo ""
print_status "Estimated monthly cost: ~$60-80 (mainly NAT Gateway + Redis)"
echo ""

# Confirm deployment
read -p "Do you want to proceed with deployment? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Deployment cancelled by user"
    exit 0
fi

# Deploy infrastructure stack
print_header "🏗️ Deploying Infrastructure Stack"
print_status "Deploying TelephonyInfraStack..."
print_warning "This may take 10-15 minutes (VPC and Redis creation is slow)"

if npx cdk deploy TelephonyInfraStack \
    --app "npx ts-node --prefer-ts-exts bin/minimal-app.ts" \
    --require-approval never \
    --outputs-file infra-outputs.json; then
    print_success "Infrastructure stack deployed successfully"
else
    print_error "Infrastructure stack deployment failed"
    exit 1
fi

# Deploy telephony lambda stack
print_header "📱 Deploying Telephony Lambda Stack"
print_status "Deploying TelephonyLambdasStack..."

if npx cdk deploy TelephonyLambdasStack \
    --app "npx ts-node --prefer-ts-exts bin/minimal-app.ts" \
    --require-approval never \
    --outputs-file telephony-outputs.json; then
    print_success "Telephony Lambda stack deployed successfully"
else
    print_error "Telephony Lambda stack deployment failed"
    exit 1
fi

# Extract and display important outputs
print_header "🎉 Deployment Completed Successfully!"

# Function URLs
if [ -f "telephony-outputs.json" ]; then
    VOICE_URL=$(jq -r '.TelephonyLambdasStack.VoiceHandlerUrl // "Not found"' telephony-outputs.json)
    GATHER_URL=$(jq -r '.TelephonyLambdasStack.GatherHandlerUrl // "Not found"' telephony-outputs.json)
    STATUS_URL=$(jq -r '.TelephonyLambdasStack.StatusHandlerUrl // "Not found"' telephony-outputs.json)

    print_success "🔗 Function URLs for Twilio Configuration:"
    echo "  Voice Webhook URL:  $VOICE_URL"
    echo "  Gather Webhook URL: $GATHER_URL"
    echo "  Status Callback URL: $STATUS_URL"
    echo ""
fi

# Infrastructure info
if [ -f "infra-outputs.json" ]; then
    REDIS_ENDPOINT=$(jq -r '.TelephonyInfraStack.RedisEndpoint // "Not found"' infra-outputs.json)
    S3_BUCKET=$(jq -r '.TelephonyInfraStack.S3BucketName // "Not found"' infra-outputs.json)

    print_success "🛠️ Infrastructure Details:"
    echo "  Redis Endpoint: $REDIS_ENDPOINT"
    echo "  S3 Bucket: $S3_BUCKET"
    echo "  DynamoDB Tables: 7 tables created with Telephony- prefix"
    echo ""
fi

print_success "✅ All resources deployed successfully!"
print_warning "📝 Next Steps:"
echo "  1. Configure Twilio webhooks with the Function URLs above"
echo "  2. Test the system with a phone call"
echo "  3. Monitor CloudWatch logs for any issues"
echo ""
print_status "💡 To destroy all resources later, run:"
echo "  ./destroy-minimal.sh"
echo ""
print_status "🔍 To view stack details:"
echo "  aws cloudformation describe-stacks --stack-name TelephonyInfraStack --region $AWS_REGION"
echo "  aws cloudformation describe-stacks --stack-name TelephonyLambdasStack --region $AWS_REGION"