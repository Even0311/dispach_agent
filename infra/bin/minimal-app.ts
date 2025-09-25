#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MinimalInfraStack } from '../lib/minimal-infra-stack';
import { MinimalTelephonyStack } from '../lib/minimal-telephony-stack';
import { AgentLambdaStack } from '../lib/agent-lambda-stack';

const app = new cdk.App();

// Minimal Infrastructure stack - contains only essential shared resources
const infraStack = new MinimalInfraStack(app, 'TelephonyInfraStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
  description: 'Minimal infrastructure stack for telephony system (VPC, Redis, DynamoDB, S3)',
});

// Telephony Lambda stack - depends on infrastructure stack
const telephonyStack = new MinimalTelephonyStack(app, 'TelephonyLambdasStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
  description: 'Telephony Lambda functions with Function URLs for Twilio webhooks',
});

// Agent Lambda stack - depends on infrastructure stack
const agentStack = new AgentLambdaStack(app, 'AgentLambdaStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
  description: 'React Agent Lambda for handling service inquiries and bookings',
});

// Add dependencies to ensure infrastructure is deployed first
telephonyStack.addDependency(infraStack);
agentStack.addDependency(infraStack);

// Add tags for cost tracking
const tags = {
  Project: 'TelephonySystem',
  Environment: 'Development',
  CostCenter: 'AI-Telephony',
};

Object.entries(tags).forEach(([key, value]) => {
  cdk.Tags.of(infraStack).add(key, value);
  cdk.Tags.of(telephonyStack).add(key, value);
  cdk.Tags.of(agentStack).add(key, value);
});