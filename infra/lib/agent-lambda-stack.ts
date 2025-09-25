import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export class AgentLambdaStack extends cdk.Stack {
  public readonly agentFunction: lambda.Function;
  public readonly agentFunctionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import resources from infrastructure stack (MinimalInfraStack exports)
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

    // Create Parameter Store parameter for LangSmith API key
    const langsmithApiKeyParam = new ssm.StringParameter(this, 'LangSmithApiKeyParam', {
      parameterName: '/dispatch-agent/langsmith/api-key',
      description: 'LangSmith API key for agent tracing and monitoring',
      stringValue: 'placeholder-key', // Will be updated manually after deployment
      tier: ssm.ParameterTier.STANDARD,
    });

    // Create IAM role for Agent Lambda function
    const agentLambdaExecutionRole = new iam.Role(this, 'AgentLambdaExecutionRole', {
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
                's3:ListBucket',
              ],
              resources: [
                `arn:aws:s3:::telephony-storage-${this.account}-${this.region}`,
                `arn:aws:s3:::telephony-storage-${this.account}-${this.region}/*`,
              ],
            }),
          ],
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
                'bedrock:GetFoundationModel',
                'bedrock:ListFoundationModels',
              ],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-*`,
                `arn:aws:bedrock:${this.region}::foundation-model/meta.llama-*`,
              ],
            }),
          ],
        }),
        ParameterStoreAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:GetParametersByPath',
              ],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/dispatch-agent/*`,
                langsmithApiKeyParam.parameterArn,
              ],
            }),
          ],
        }),
      },
    });

    // Agent Lambda function configuration
    this.agentFunction = new lambda.Function(this, 'AgentFunction', {
      functionName: 'dispatch-agent-react-agent',
      description: 'React Agent for handling general service inquiries and bookings',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'lambda-handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../agent/dist'), {
        exclude: [
          'src',
          'test',
          '*.ts',
          '*.md',
          'tsconfig.json',
          'node_modules',
        ],
      }),
      memorySize: 1024, // Increased memory for ML workloads
      timeout: cdk.Duration.minutes(5), // Longer timeout for agent processing
      // Remove reserved concurrency to avoid account limits for development
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [securityGroup],
      role: agentLambdaExecutionRole,
      environment: {
        NODE_ENV: 'production',

        // Redis configuration
        REDIS_HOST: redisEndpoint,
        REDIS_PORT: '6379',
        REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
        REDIS_DB: '0',

        // DynamoDB configuration
        DYNAMODB_TABLE_NAMES: tableNames,
        USERS_TABLE_NAME: 'Telephony-Users',
        CALLLOGS_TABLE_NAME: 'Telephony-CallLogs',
        COMPANIES_TABLE_NAME: 'Telephony-Companies',
        SERVICE_BOOKINGS_TABLE_NAME: 'Telephony-ServiceBookings',
        SERVICES_TABLE_NAME: 'Telephony-Services',
        TRANSCRIPT_CHUNKS_TABLE_NAME: 'Telephony-TranscriptChunks',
        TRANSCRIPTS_TABLE_NAME: 'Telephony-Transcripts',

        // S3 configuration
        S3_BUCKET: s3BucketName,

        // Bedrock configuration
        BEDROCK_AWS_REGION: this.region,
        PRIMARY_MODEL: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        FALLBACK_MODEL: 'anthropic.claude-3-haiku-20240307-v1:0',

        // LangSmith configuration (API key from Parameter Store)
        LANGSMITH_PROJECT: 'dispatch-agent-react-agent',
        LANGSMITH_TRACING: 'true',
        LANGSMITH_API_KEY_PARAM: langsmithApiKeyParam.parameterName,

        // Agent configuration
        AGENT_MAX_ITERATIONS: '10',
        AGENT_TIMEOUT_SECONDS: '280', // Leave buffer for Lambda timeout

        // Service URLs
        PUBLIC_URL: process.env.PUBLIC_URL || 'https://your-domain.com',
        AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'https://your-ai-service.com',
        DISPATCH_SERVICE_URL: process.env.DISPATCH_SERVICE_URL || 'https://your-dispatch-service.com',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Add Function URL for Agent Lambda
    this.agentFunctionUrl = this.agentFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowCredentials: false,
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Request-ID',
          'X-Session-ID',
        ],
        allowedMethods: [
          lambda.HttpMethod.GET,
          lambda.HttpMethod.POST,
        ],
        allowedOrigins: [
          '*', // Allow all origins for now - restrict in production
        ],
        maxAge: cdk.Duration.minutes(5),
      },
    });

    // CloudWatch Alarms for monitoring
    const errorAlarm = this.agentFunction.metricErrors({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'AgentErrorAlarm', {
      threshold: 5,
      evaluationPeriods: 2,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Agent Lambda function error rate is too high',
    });

    const durationAlarm = this.agentFunction.metricDuration({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'AgentDurationAlarm', {
      threshold: 240000, // 4 minutes in milliseconds
      evaluationPeriods: 2,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Agent Lambda function duration is too high',
    });

    // Output Function URL for external access
    new cdk.CfnOutput(this, 'AgentFunctionUrl', {
      value: this.agentFunctionUrl.url,
      description: 'Agent Function URL for external API access',
      exportName: 'DispatchAgent-AgentFunctionUrl',
    });

    // Output Lambda function name for reference
    new cdk.CfnOutput(this, 'AgentFunctionName', {
      value: this.agentFunction.functionName,
      description: 'Agent Lambda function name',
      exportName: 'DispatchAgent-AgentFunctionName',
    });

    // Output Parameter Store parameter name
    new cdk.CfnOutput(this, 'LangSmithApiKeyParameterName', {
      value: langsmithApiKeyParam.parameterName,
      description: 'Parameter Store parameter name for LangSmith API key',
      exportName: 'DispatchAgent-LangSmithApiKeyParam',
    });

    // Output CloudWatch Log Group name for debugging
    new cdk.CfnOutput(this, 'AgentLogGroupName', {
      value: this.agentFunction.logGroup.logGroupName,
      description: 'CloudWatch Log Group for Agent Lambda function',
      exportName: 'DispatchAgent-AgentLogGroup',
    });
  }
}