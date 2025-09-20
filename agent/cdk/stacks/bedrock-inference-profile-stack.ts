import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class BedrockInferenceProfileStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create inference profile for Claude 3.5 Sonnet using raw CloudFormation
    const inferenceProfile = new cdk.CfnResource(this, 'Claude35SonnetInferenceProfile', {
      type: 'AWS::Bedrock::InferenceProfile',
      properties: {
        InferenceProfileName: 'claude-3-5-sonnet-dispatch-agent',
        Description: 'Inference profile for Claude 3.5 Sonnet in dispatch-agent application',
        ModelSource: {
          CopyFrom: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
        },
        Tags: [
          {
            Key: 'Application',
            Value: 'dispatch-agent'
          },
          {
            Key: 'Environment',
            Value: 'production'
          },
          {
            Key: 'Model',
            Value: 'claude-3-5-sonnet'
          }
        ]
      }
    });

    // Create inference profile for Claude 3 Haiku (fast model)
    const fastInferenceProfile = new cdk.CfnResource(this, 'Claude3HaikuInferenceProfile', {
      type: 'AWS::Bedrock::InferenceProfile',
      properties: {
        InferenceProfileName: 'claude-3-haiku-dispatch-agent',
        Description: 'Fast inference profile for Claude 3 Haiku in dispatch-agent application',
        ModelSource: {
          CopyFrom: 'anthropic.claude-3-haiku-20240307-v1:0'
        },
        Tags: [
          {
            Key: 'Application',
            Value: 'dispatch-agent'
          },
          {
            Key: 'Environment',
            Value: 'production'
          },
          {
            Key: 'Model',
            Value: 'claude-3-haiku'
          }
        ]
      }
    });

    // Output the inference profile ARNs for use in application
    new cdk.CfnOutput(this, 'PrimaryModelInferenceProfileArn', {
      value: inferenceProfile.getAtt('InferenceProfileArn').toString(),
      description: 'ARN of the Claude 3.5 Sonnet inference profile',
      exportName: 'claude-35-sonnet-inference-profile-arn'
    });

    new cdk.CfnOutput(this, 'FastModelInferenceProfileArn', {
      value: fastInferenceProfile.getAtt('InferenceProfileArn').toString(),
      description: 'ARN of the Claude 3 Haiku inference profile',
      exportName: 'claude-3-haiku-inference-profile-arn'
    });

    // Output the inference profile IDs for environment variables
    new cdk.CfnOutput(this, 'PrimaryModelId', {
      value: inferenceProfile.getAtt('InferenceProfileId').toString(),
      description: 'ID of the Claude 3.5 Sonnet inference profile',
      exportName: 'claude-35-sonnet-inference-profile-id'
    });

    new cdk.CfnOutput(this, 'FastModelId', {
      value: fastInferenceProfile.getAtt('InferenceProfileId').toString(),
      description: 'ID of the Claude 3 Haiku inference profile',
      exportName: 'claude-3-haiku-inference-profile-id'
    });
  }
}