#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DispatchAgentStack } from '../lib/dispatch-agent-stack';
import { TelephonyLambdasStack } from '../lib/telephony-lambdas-stack';
import { BedrockInferenceProfileStack } from '../lib/bedrock-inference-profile-stack';

const app = new cdk.App();

// Infrastructure stack - contains shared resources
const infraStack = new DispatchAgentStack(app, 'DispatchAgentStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
});

// Telephony Lambda stack - depends on infrastructure stack
const telephonyStack = new TelephonyLambdasStack(app, 'TelephonyLambdasStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
});

// Bedrock inference profile stack - can be deployed independently
const bedrockStack = new BedrockInferenceProfileStack(app, 'BedrockInferenceProfileStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
});

// Add dependency to ensure infrastructure is deployed first
telephonyStack.addDependency(infraStack);