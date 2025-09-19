import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class MinimalTelephonyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Lambda Layer for shared dependencies
    const dependenciesLayer = new lambda.LayerVersion(this, 'TelephonyDependenciesLayer', {
      layerVersionName: 'telephony-dependencies-v2',
      description: 'Shared dependencies for telephony Lambda functions (Twilio, AWS SDK, etc.)',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda-layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
    });

    // Import resources from minimal infrastructure stack
    const vpcId = cdk.Fn.importValue('Telephony-VpcId');
    const subnetIds = cdk.Fn.split(',', cdk.Fn.importValue('Telephony-PrivateSubnetIds'));
    const securityGroupId = cdk.Fn.importValue('Telephony-LambdaSecurityGroupId');
    const redisEndpoint = cdk.Fn.importValue('Telephony-RedisEndpoint');
    const s3BucketName = cdk.Fn.importValue('Telephony-S3BucketName');
    const tableNames = cdk.Fn.importValue('Telephony-TableNames');

    // Import VPC and security group
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'ImportedVpc', {
      vpcId,
      availabilityZones: cdk.Fn.getAzs(),
      privateSubnetIds: subnetIds,
    });

    const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ImportedSecurityGroup',
      securityGroupId
    );

    // Create IAM role for Lambda functions
    const lambdaExecutionRole = new iam.Role(this, 'TelephonyLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
                'dynamodb:BatchGetItem',
                'dynamodb:BatchWriteItem',
              ],
              resources: [
                // All Telephony tables and their indexes
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-*/index/*`,
              ],
            }),
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                `arn:aws:s3:::telephony-storage-${this.account}-${this.region}`,
                `arn:aws:s3:::telephony-storage-${this.account}-${this.region}/*`,
              ],
            }),
          ],
        }),
      },
    });

    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      // Remove reserved concurrency to avoid account limits
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [securityGroup],
      role: lambdaExecutionRole,
      layers: [dependenciesLayer], // Add the shared dependencies layer
      environment: {
        NODE_ENV: 'production',
        REDIS_HOST: redisEndpoint,
        REDIS_PORT: '6379',
        S3_BUCKET: s3BucketName,
        // DynamoDB table names - will be parsed from JSON at runtime
        DYNAMODB_TABLE_NAMES: tableNames,
        // External service URLs (to be configured later)
        AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'https://your-ai-service.com',
        DISPATCH_SERVICE_URL: process.env.DISPATCH_SERVICE_URL || 'https://your-dispatch-service.com',
      },
      logRetention: logs.RetentionDays.ONE_WEEK, // Reduced for cost optimization
    };

    // Voice Handler Lambda
    const voiceHandler = new lambda.Function(this, 'VoiceHandler', {
      ...commonLambdaProps,
      functionName: 'telephony-voice-handler',
      description: 'Handles Twilio voice webhook calls - v3 with Layer',
      handler: 'voice-handler/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../telephony-lambdas/dist')),
    });

    // Add Function URL for Voice Handler
    const voiceFunctionUrl = voiceHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowCredentials: false,
        allowedHeaders: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedOrigins: ['*'],
        maxAge: cdk.Duration.minutes(5),
      },
    });

    // Gather Handler Lambda
    const gatherHandler = new lambda.Function(this, 'GatherHandler', {
      ...commonLambdaProps,
      functionName: 'telephony-gather-handler',
      description: 'Handles Twilio gather webhook calls',
      handler: 'gather-handler/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../telephony-lambdas/dist')),
    });

    // Add Function URL for Gather Handler
    const gatherFunctionUrl = gatherHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowCredentials: false,
        allowedHeaders: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedOrigins: ['*'],
        maxAge: cdk.Duration.minutes(5),
      },
    });

    // Status Handler Lambda
    const statusHandler = new lambda.Function(this, 'StatusHandler', {
      ...commonLambdaProps,
      functionName: 'telephony-status-handler',
      description: 'Handles Twilio status callback calls',
      handler: 'status-handler/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../telephony-lambdas/dist')),
    });

    // Add Function URL for Status Handler
    const statusFunctionUrl = statusHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowCredentials: false,
        allowedHeaders: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedOrigins: ['*'],
        maxAge: cdk.Duration.minutes(5),
      },
    });

    // CloudWatch Alarms for basic monitoring
    const functions = [voiceHandler, gatherHandler, statusHandler];
    functions.forEach((func, index) => {
      const functionName = ['Voice', 'Gather', 'Status'][index];

      new cdk.aws_cloudwatch.Alarm(this, `${functionName}ErrorAlarm`, {
        alarmDescription: `${functionName} Handler error rate too high`,
        metric: func.metricErrors({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 3,
        evaluationPeriods: 2,
      });
    });

    // Output Function URLs for Twilio configuration
    new cdk.CfnOutput(this, 'VoiceHandlerUrl', {
      value: voiceFunctionUrl.url,
      description: 'Voice Handler Function URL for Twilio Voice webhook',
    });

    new cdk.CfnOutput(this, 'GatherHandlerUrl', {
      value: gatherFunctionUrl.url,
      description: 'Gather Handler Function URL for Twilio Gather webhook',
    });

    new cdk.CfnOutput(this, 'StatusHandlerUrl', {
      value: statusFunctionUrl.url,
      description: 'Status Handler Function URL for Twilio Status callback',
    });

    // Output for easy reference
    new cdk.CfnOutput(this, 'TwilioWebhookConfiguration', {
      value: JSON.stringify({
        voiceUrl: voiceFunctionUrl.url,
        gatherUrl: gatherFunctionUrl.url,
        statusCallbackUrl: statusFunctionUrl.url,
      }),
      description: 'All webhook URLs for Twilio configuration',
    });

    // Output Lambda function names for monitoring
    new cdk.CfnOutput(this, 'DeployedFunctions', {
      value: JSON.stringify({
        voiceHandler: voiceHandler.functionName,
        gatherHandler: gatherHandler.functionName,
        statusHandler: statusHandler.functionName,
      }),
      description: 'Deployed Lambda function names',
    });
  }
}