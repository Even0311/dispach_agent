# 📞 Minimal Telephony System Deployment Guide

## 🎯 Overview

你现在有了一个**最小化的telephony系统**，只包含DynamoDB + 3个Lambda函数 + 必需的基础设施，专门为你的智能电话助手需求设计。

## 📦 What's Included

### Infrastructure Stack (TelephonyInfraStack)
- ✅ **VPC** (2 AZ, Public/Private-App/Private-DB subnets)
- ✅ **Redis ElastiCache** (cache.t3.micro for development)
- ✅ **7 DynamoDB Tables** with GSI indexes
- ✅ **S3 Bucket** for call recordings and data
- ✅ **VPC Gateway Endpoints** (cost optimization)
- ✅ **Security Groups** (Lambda + Redis access control)

### Application Stack (TelephonyLambdasStack)
- ✅ **voice-handler** Lambda with Function URL
- ✅ **gather-handler** Lambda with Function URL
- ✅ **status-handler** Lambda with Function URL
- ✅ **IAM Roles** with precise permissions
- ✅ **CloudWatch Alarms** for monitoring

## 🚀 Quick Start

### 1. Prerequisites Check
```bash
# Ensure you have:
- AWS CLI configured (aws configure)
- Node.js 18+ installed
- CDK available (npm install -g aws-cdk or locally)
```

### 2. One-Click Deployment
```bash
cd infra
./deploy-minimal.sh
```

That's it! The script will:
- ✅ Validate prerequisites
- ✅ Build telephony Lambda code
- ✅ Deploy infrastructure stack (~10-15 minutes)
- ✅ Deploy Lambda functions (~3-5 minutes)
- ✅ Output all Function URLs for Twilio

### 3. One-Click Cleanup
```bash
cd infra
./destroy-minimal.sh
```

## 📋 File Structure

```
infra/
├── lib/
│   ├── minimal-infra-stack.ts      # Infrastructure only
│   └── minimal-telephony-stack.ts  # Lambda functions only
├── bin/
│   └── minimal-app.ts              # CDK app entry point
├── deploy-minimal.sh               # 🚀 One-click deployment
├── destroy-minimal.sh              # 🧹 One-click cleanup
└── validate-minimal.sh             # ✅ Validation script
```

## 🔧 Configuration Details

### Lambda Functions
- **Runtime**: Node.js 20.x on ARM64 (Graviton2)
- **Memory**: 256 MB (optimized for cost)
- **Timeout**: 30 seconds
- **Concurrency**: 5 reserved (cost-controlled)
- **VPC**: Private subnets with Redis access

### DynamoDB Tables (All with PAY_PER_REQUEST)
1. `Telephony-Users` + TwilioPhoneNumberIndex
2. `Telephony-Companies` + UserIdIndex
3. `Telephony-Services` + UserIdIndex
4. `Telephony-CallLogs` + CallSidIndex + UserIdIndex
5. `Telephony-Transcripts` + CallSidIndex
6. `Telephony-TranscriptChunks` + TranscriptIdIndex
7. `Telephony-ServiceBookings` + CallSidIndex + UserIdIndex

### Environment Variables (Auto-configured)
```bash
NODE_ENV=production
REDIS_HOST=<auto-from-stack>
REDIS_PORT=6379
S3_BUCKET=<auto-from-stack>
DYNAMODB_TABLE_NAMES=<JSON-with-all-table-names>
```

## 🔗 Twilio Configuration

After deployment, configure these webhook URLs in Twilio:

```javascript
// Output from deployment
Voice Webhook URL:  https://xxx.lambda-url.ap-southeast-2.on.aws/
Gather Webhook URL: https://xxx.lambda-url.ap-southeast-2.on.aws/
Status Callback URL: https://xxx.lambda-url.ap-southeast-2.on.aws/
```

## 💰 Cost Estimation (Sydney Region)

### Monthly Costs (USD)
```
Infrastructure:
- VPC: Free
- NAT Gateway: $45
- Redis t3.micro: $15
- DynamoDB (on-demand): $5-15 (usage dependent)
- S3 storage: $1-5

Lambda Functions:
- 3 functions: $5-20 (usage dependent)
- VPC ENI: $3

Total: ~$69-103/month
```

### Cost Optimization Features
- ✅ 2 AZ instead of 3 (reduce NAT costs)
- ✅ VPC Gateway Endpoints (no DynamoDB/S3 NAT charges)
- ✅ ARM64 Lambda (20% cheaper than x86)
- ✅ t3.micro Redis (smallest instance)
- ✅ PAY_PER_REQUEST DynamoDB (no idle costs)

## 📊 Monitoring

### CloudWatch Alarms (Auto-configured)
- Lambda error rate > 3 errors in 10 minutes
- Function-specific monitoring for all 3 handlers

### Manual Monitoring
```bash
# Check Lambda logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/telephony"

# Check DynamoDB tables
aws dynamodb list-tables --region ap-southeast-2

# Check Redis status
aws elasticache describe-replication-groups --region ap-southeast-2
```

## 🛠️ Development Workflow

### Code Changes
```bash
# 1. Update Lambda code in telephony-lambdas/
# 2. Build and redeploy just the Lambda stack
cd telephony-lambdas && npm run build
cd ../infra
npx cdk deploy TelephonyLambdasStack --app "npx ts-node bin/minimal-app.ts"
```

### Infrastructure Changes
```bash
# Modify minimal-infra-stack.ts or minimal-telephony-stack.ts
cd infra
npx cdk diff --app "npx ts-node bin/minimal-app.ts"
npx cdk deploy --app "npx ts-node bin/minimal-app.ts"
```

## 🔍 Troubleshooting

### Common Issues

1. **CDK Bootstrap Required**
   ```bash
   npx cdk bootstrap aws://YOUR_ACCOUNT/ap-southeast-2
   ```

2. **Lambda Build Fails**
   - Placeholder files are created automatically
   - Fix TypeScript errors in telephony-lambdas/
   - Redeploy Lambda stack only

3. **Redis Connection Issues**
   - Lambdas are in correct VPC private subnets
   - Security groups allow Lambda → Redis access
   - No password required (VPC internal access)

4. **DynamoDB Access Issues**
   - IAM roles have all necessary permissions
   - Table names are auto-injected via environment variables

### Debug Commands
```bash
# Validate configuration
./validate-minimal.sh

# Check stack status
aws cloudformation describe-stacks --stack-name TelephonyInfraStack
aws cloudformation describe-stacks --stack-name TelephonyLambdasStack

# Test Lambda functions
aws lambda invoke --function-name telephony-voice-handler test-output.json
```

## 🎯 Next Steps

1. **Deploy**: `./deploy-minimal.sh`
2. **Configure Twilio**: Use the Function URLs from deployment output
3. **Test**: Make a test call to your Twilio number
4. **Monitor**: Check CloudWatch logs for any issues
5. **Iterate**: Modify Lambda code and redeploy as needed

## 🆚 Comparison with Full Architecture

| Feature | Minimal Deployment | Full Architecture |
|---------|-------------------|-------------------|
| **Lambda Functions** | 3 (telephony only) | 4 (+ AssistLambda) |
| **API Gateway** | ❌ (Function URLs) | ✅ (RESTful API) |
| **ECS Fargate** | ❌ (simplified) | ✅ (MCP Server) |
| **Load Balancer** | ❌ | ✅ (Internal ALB) |
| **Monthly Cost** | ~$69-103 | ~$130-200 |
| **Complexity** | Low | High |
| **Deployment Time** | 15-20 min | 25-30 min |

**Perfect for**: Development, MVP, cost-conscious deployments
**Upgrade path**: Can easily add ECS/ALB later by deploying full architecture

---

**🎉 You now have a production-ready, cost-optimized telephony system!**

For questions or issues, check the troubleshooting section or review the deployment logs.