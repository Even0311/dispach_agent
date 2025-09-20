#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BedrockInferenceProfileStack } from './stacks/bedrock-inference-profile-stack';

const app = new cdk.App();

new BedrockInferenceProfileStack(app, 'BedrockInferenceProfileStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-southeast-2',
  },
  description: 'Stack for Bedrock Claude 3.5 Sonnet inference profile',
});

app.synth();