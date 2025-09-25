#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DispatchAgentStack } from '../lib/dispatch-agent-stack';
import { TelephonyLambdasStack } from '../lib/telephony-lambdas-stack';
import { AgentLambdaStack } from '../lib/agent-lambda-stack';

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

// Agent Lambda stack - depends on infrastructure stack
const agentStack = new AgentLambdaStack(app, 'AgentLambdaStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
});

// Add dependencies to ensure infrastructure is deployed first
telephonyStack.addDependency(infraStack);
agentStack.addDependency(infraStack);