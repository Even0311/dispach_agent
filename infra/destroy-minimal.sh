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

# Start destruction
print_header "🧹 Telephony System Resource Cleanup"

# Warning
print_warning "⚠️  This will PERMANENTLY DELETE all telephony system resources!"
print_warning "⚠️  Including DynamoDB data, S3 files, and Lambda functions!"
echo ""

# Get AWS account info
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "Unknown")
AWS_REGION="ap-southeast-2"
print_status "Target Account: $AWS_ACCOUNT, Region: $AWS_REGION"
echo ""

# List what will be destroyed
print_status "📋 Resources to be destroyed:"
echo "  🗄️  DynamoDB Tables: 7 tables (all data will be lost)"
echo "  📦 S3 Bucket: telephony-storage bucket (all files will be lost)"
echo "  🔧 Redis Cluster: ElastiCache instance"
echo "  ⚡ Lambda Functions: 3 telephony handlers"
echo "  🌐 VPC: Network infrastructure"
echo "  🔐 IAM Roles: Lambda execution roles"
echo ""

# Double confirmation
print_error "🚨 LAST WARNING: This action cannot be undone!"
read -p "Type 'DELETE' to confirm permanent destruction: " -r
echo ""
if [[ ! $REPLY == "DELETE" ]]; then
    print_success "Destruction cancelled. Resources are safe."
    exit 0
fi

# Additional confirmation
read -p "Are you absolutely sure? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_success "Destruction cancelled. Resources are safe."
    exit 0
fi

print_header "🔥 Beginning Resource Destruction"

# Empty S3 bucket first (CDK can't delete non-empty buckets)
print_status "🗑️  Emptying S3 bucket..."
S3_BUCKET_NAME="telephony-storage-$AWS_ACCOUNT-$AWS_REGION"

if aws s3api head-bucket --bucket "$S3_BUCKET_NAME" 2>/dev/null; then
    print_status "Found S3 bucket: $S3_BUCKET_NAME"
    print_status "Deleting all objects..."
    aws s3 rm "s3://$S3_BUCKET_NAME" --recursive --region $AWS_REGION || true
    print_success "S3 bucket emptied"
else
    print_status "S3 bucket not found or already deleted"
fi

# Destroy Lambda stack first (reverse order)
print_header "📱 Destroying Lambda Stack"
print_status "Destroying TelephonyLambdasStack..."

if npx cdk destroy TelephonyLambdasStack \
    --app "npx ts-node --prefer-ts-exts bin/minimal-app.ts" \
    --force; then
    print_success "Lambda stack destroyed successfully"
else
    print_warning "Lambda stack destruction had issues (may have been already deleted)"
fi

# Destroy infrastructure stack
print_header "🏗️ Destroying Infrastructure Stack"
print_status "Destroying TelephonyInfraStack..."
print_warning "This may take 5-10 minutes..."

if npx cdk destroy TelephonyInfraStack \
    --app "npx ts-node --prefer-ts-exts bin/minimal-app.ts" \
    --force; then
    print_success "Infrastructure stack destroyed successfully"
else
    print_warning "Infrastructure stack destruction had issues"
fi

# Clean up output files
print_status "🧹 Cleaning up output files..."
rm -f infra-outputs.json telephony-outputs.json

# Final verification
print_header "🔍 Verifying Destruction"
print_status "Checking for remaining stacks..."

REMAINING_STACKS=$(aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
    --region $AWS_REGION \
    --query 'StackSummaries[?contains(StackName, `Telephony`)].StackName' \
    --output text || echo "")

if [ -z "$REMAINING_STACKS" ]; then
    print_success "✅ All stacks destroyed successfully"
else
    print_warning "⚠️  Some stacks may still exist: $REMAINING_STACKS"
    print_status "You may need to check AWS Console for manual cleanup"
fi

print_header "🎉 Cleanup Completed"
print_success "All telephony system resources have been destroyed"
print_status "💰 Billing should stop immediately for all resources"
print_warning "📝 Note: Some AWS resources may have a small delay in billing termination"

echo ""
print_status "🚀 To redeploy the system, simply run:"
echo "  ./deploy-minimal.sh"