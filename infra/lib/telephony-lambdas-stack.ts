import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class TelephonyLambdasStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import resources from infrastructure stack
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
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRoleV2', {
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
              ],
              resources: [
                // Table ARNs will be resolved at deploy time
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-*/index/*`,
                // Individual table access
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-Users`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-Users/index/*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-CallLogs`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-CallLogs/index/*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-Companies`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-Companies/index/*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-ServiceBookings`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-ServiceBookings/index/*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-Services`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-Services/index/*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-TranscriptChunks`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-TranscriptChunks/index/*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-Transcripts`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/Telephony-Transcripts/index/*`,
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
      reservedConcurrentExecutions: 10,
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [securityGroup],
      role: lambdaExecutionRole,
      environment: {
        NODE_ENV: 'production',
        REDIS_HOST: redisEndpoint,
        REDIS_PORT: '6379',
        S3_BUCKET: s3BucketName,
        // DynamoDB table names - will be parsed from JSON at runtime
        DYNAMODB_TABLE_NAMES: tableNames,
        // Individual table names
        USERS_TABLE_NAME: 'Telephony-Users',
        CALLLOGS_TABLE_NAME: 'Telephony-CallLogs',
        COMPANIES_TABLE_NAME: 'Telephony-Companies',
        SERVICE_BOOKINGS_TABLE_NAME: 'Telephony-ServiceBookings',
        SERVICES_TABLE_NAME: 'Telephony-Services',
        TRANSCRIPT_CHUNKS_TABLE_NAME: 'Telephony-TranscriptChunks',
        TRANSCRIPTS_TABLE_NAME: 'Telephony-Transcripts',
        // Redis configuration
        REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
        REDIS_DB: '0',
        // Other configuration
        PUBLIC_URL: process.env.PUBLIC_URL || 'https://your-domain.com',
        // External service URLs (to be configured)
        AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'https://your-ai-service.com',
        DISPATCH_SERVICE_URL: process.env.DISPATCH_SERVICE_URL || 'https://your-dispatch-service.com',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    };

    // Gather Handler Lambda (create first to get URL)
    const gatherHandler = new lambda.Function(this, 'GatherHandler', {
      ...commonLambdaProps,
      functionName: 'telephony-gather-handler',
      description: 'Handles Twilio gather webhook calls',
      handler: 'dist/gather-handler/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../telephony-lambdas'), {
        exclude: ['src', 'test', '.git', 'README.md', 'tsconfig.json'],
      }),
    });

    // Add Function URL for Gather Handler
    const gatherFunctionUrl = gatherHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowCredentials: false,
        allowedHeaders: ['Content-Type'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedOrigins: [
          'https://webhooks.twilio.com',
          'https://*.twilio.com',
        ],
        maxAge: cdk.Duration.minutes(5),
      },
    });

    // Voice Handler Lambda (create with Gather Handler URL)
    const voiceHandler = new lambda.Function(this, 'VoiceHandler', {
      runtime: commonLambdaProps.runtime,
      architecture: commonLambdaProps.architecture,
      memorySize: commonLambdaProps.memorySize,
      timeout: commonLambdaProps.timeout,
      reservedConcurrentExecutions: commonLambdaProps.reservedConcurrentExecutions,
      vpc: commonLambdaProps.vpc,
      vpcSubnets: commonLambdaProps.vpcSubnets,
      securityGroups: commonLambdaProps.securityGroups,
      role: commonLambdaProps.role,
      logRetention: commonLambdaProps.logRetention,
      functionName: 'telephony-voice-handler',
      description: 'Handles Twilio voice webhook calls',
      handler: 'dist/voice-handler/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../telephony-lambdas'), {
        exclude: ['src', 'test', '.git', 'README.md', 'tsconfig.json'],
      }),
      environment: {
        ...commonLambdaProps.environment,
        GATHER_HANDLER_URL: gatherFunctionUrl.url,
      },
    });

    // Add Function URL for Voice Handler
    const voiceFunctionUrl = voiceHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowCredentials: false,
        allowedHeaders: ['Content-Type'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedOrigins: [
          'https://webhooks.twilio.com',
          'https://*.twilio.com',
        ],
        maxAge: cdk.Duration.minutes(5),
      },
    });

    // Status Handler Lambda
    const statusHandler = new lambda.Function(this, 'StatusHandler', {
      ...commonLambdaProps,
      functionName: 'telephony-status-handler',
      description: 'Handles Twilio status callback calls',
      handler: 'dist/status-handler/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../telephony-lambdas'), {
        exclude: ['src', 'test', '.git', 'README.md', 'tsconfig.json'],
      }),
    });

    // Add Function URL for Status Handler
    const statusFunctionUrl = statusHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowCredentials: false,
        allowedHeaders: ['Content-Type'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedOrigins: [
          'https://webhooks.twilio.com',
          'https://*.twilio.com',
        ],
        maxAge: cdk.Duration.minutes(5),
      },
    });

    // CloudWatch Alarms for monitoring
    const errorAlarmProps = {
      threshold: 5,
      evaluationPeriods: 2,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    };

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

    // Output Lambda function names for reference
    new cdk.CfnOutput(this, 'VoiceHandlerFunctionName', {
      value: voiceHandler.functionName,
      description: 'Voice Handler Lambda function name',
    });

    new cdk.CfnOutput(this, 'GatherHandlerFunctionName', {
      value: gatherHandler.functionName,
      description: 'Gather Handler Lambda function name',
    });

    new cdk.CfnOutput(this, 'StatusHandlerFunctionName', {
      value: statusHandler.functionName,
      description: 'Status Handler Lambda function name',
    });
  }
}