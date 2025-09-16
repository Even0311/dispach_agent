#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DispatchAgentStack } from '../lib/dispatch-agent-stack';

const app = new cdk.App();
new DispatchAgentStack(app, 'DispatchAgentStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
});