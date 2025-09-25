"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentLambdaStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const ec2 = require("aws-cdk-lib/aws-ec2");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const ssm = require("aws-cdk-lib/aws-ssm");
const path = require("path");
class AgentLambdaStack extends cdk.Stack {
    agentFunction;
    agentFunctionUrl;
    constructor(scope, id, props) {
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
        const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedSecurityGroup', securityGroupId);
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
exports.AgentLambdaStack = AgentLambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdlbnQtbGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYWdlbnQtbGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw2Q0FBNkM7QUFDN0MsMkNBQTJDO0FBRTNDLDZCQUE2QjtBQUU3QixNQUFhLGdCQUFpQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzdCLGFBQWEsQ0FBa0I7SUFDL0IsZ0JBQWdCLENBQXFCO0lBRXJELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIseUVBQXlFO1FBQ3pFLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDcEQsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLDRCQUE0QixDQUFDLENBQUMsQ0FBQztRQUN0RixNQUFNLGVBQWUsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO1FBQzlFLE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLHlCQUF5QixDQUFDLENBQUM7UUFDcEUsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUNsRSxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO1FBRTlELGdDQUFnQztRQUNoQyxNQUFNLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLGlCQUFp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UkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcclxuaW1wb3J0ICogYXMgc3NtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuXHJcbmV4cG9ydCBjbGFzcyBBZ2VudExhbWJkYVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBwdWJsaWMgcmVhZG9ubHkgYWdlbnRGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xyXG4gIHB1YmxpYyByZWFkb25seSBhZ2VudEZ1bmN0aW9uVXJsOiBsYW1iZGEuRnVuY3Rpb25Vcmw7XHJcblxyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIEltcG9ydCByZXNvdXJjZXMgZnJvbSBpbmZyYXN0cnVjdHVyZSBzdGFjayAoTWluaW1hbEluZnJhU3RhY2sgZXhwb3J0cylcclxuICAgIGNvbnN0IHZwY0lkID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktVnBjSWQnKTtcclxuICAgIGNvbnN0IHN1Ym5ldElkcyA9IGNkay5Gbi5zcGxpdCgnLCcsIGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVByaXZhdGVTdWJuZXRJZHMnKSk7XHJcbiAgICBjb25zdCBzZWN1cml0eUdyb3VwSWQgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1MYW1iZGFTZWN1cml0eUdyb3VwSWQnKTtcclxuICAgIGNvbnN0IHJlZGlzRW5kcG9pbnQgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1SZWRpc0VuZHBvaW50Jyk7XHJcbiAgICBjb25zdCBzM0J1Y2tldE5hbWUgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1TM0J1Y2tldE5hbWUnKTtcclxuICAgIGNvbnN0IHRhYmxlTmFtZXMgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1UYWJsZU5hbWVzJyk7XHJcblxyXG4gICAgLy8gSW1wb3J0IFZQQyBhbmQgc2VjdXJpdHkgZ3JvdXBcclxuICAgIGNvbnN0IHZwYyA9IGVjMi5WcGMuZnJvbVZwY0F0dHJpYnV0ZXModGhpcywgJ0ltcG9ydGVkVnBjJywge1xyXG4gICAgICB2cGNJZCxcclxuICAgICAgYXZhaWxhYmlsaXR5Wm9uZXM6IGNkay5Gbi5nZXRBenMoKSxcclxuICAgICAgcHJpdmF0ZVN1Ym5ldElkczogc3VibmV0SWRzLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgc2VjdXJpdHlHcm91cCA9IGVjMi5TZWN1cml0eUdyb3VwLmZyb21TZWN1cml0eUdyb3VwSWQoXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgICdJbXBvcnRlZFNlY3VyaXR5R3JvdXAnLFxyXG4gICAgICBzZWN1cml0eUdyb3VwSWRcclxuICAgICk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIFBhcmFtZXRlciBTdG9yZSBwYXJhbWV0ZXIgZm9yIExhbmdTbWl0aCBBUEkga2V5XHJcbiAgICBjb25zdCBsYW5nc21pdGhBcGlLZXlQYXJhbSA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdMYW5nU21pdGhBcGlLZXlQYXJhbScsIHtcclxuICAgICAgcGFyYW1ldGVyTmFtZTogJy9kaXNwYXRjaC1hZ2VudC9sYW5nc21pdGgvYXBpLWtleScsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnTGFuZ1NtaXRoIEFQSSBrZXkgZm9yIGFnZW50IHRyYWNpbmcgYW5kIG1vbml0b3JpbmcnLFxyXG4gICAgICBzdHJpbmdWYWx1ZTogJ3BsYWNlaG9sZGVyLWtleScsIC8vIFdpbGwgYmUgdXBkYXRlZCBtYW51YWxseSBhZnRlciBkZXBsb3ltZW50XHJcbiAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBBZ2VudCBMYW1iZGEgZnVuY3Rpb25cclxuICAgIGNvbnN0IGFnZW50TGFtYmRhRXhlY3V0aW9uUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQWdlbnRMYW1iZGFFeGVjdXRpb25Sb2xlJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICBdLFxyXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgIER5bmFtb0RCQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6RGVsZXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlNjYW4nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkJhdGNoR2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6QmF0Y2hXcml0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICAgICAgICAvLyBUYWJsZSBBUk5zIHdpbGwgYmUgcmVzb2x2ZWQgYXQgZGVwbG95IHRpbWVcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LSovaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICAvLyBJbmRpdmlkdWFsIHRhYmxlIGFjY2Vzc1xyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1Vc2Vyc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVVzZXJzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1DYWxsTG9nc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LUNhbGxMb2dzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1Db21wYW5pZXNgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1Db21wYW5pZXMvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVNlcnZpY2VCb29raW5nc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVNlcnZpY2VCb29raW5ncy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktU2VydmljZXNgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1TZXJ2aWNlcy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktVHJhbnNjcmlwdENodW5rc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVRyYW5zY3JpcHRDaHVua3MvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVRyYW5zY3JpcHRzYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktVHJhbnNjcmlwdHMvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIFMzQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICdzMzpQdXRPYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgJ3MzOkRlbGV0ZU9iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAnczM6TGlzdEJ1Y2tldCcsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOnMzOjo6dGVsZXBob255LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOnMzOjo6dGVsZXBob255LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259LypgLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9KSxcclxuICAgICAgICBCZWRyb2NrQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbCcsXHJcbiAgICAgICAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbScsXHJcbiAgICAgICAgICAgICAgICAnYmVkcm9jazpHZXRGb3VuZGF0aW9uTW9kZWwnLFxyXG4gICAgICAgICAgICAgICAgJ2JlZHJvY2s6TGlzdEZvdW5kYXRpb25Nb2RlbHMnLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259Ojpmb3VuZGF0aW9uLW1vZGVsL2FudGhyb3BpYy5jbGF1ZGUtKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259Ojpmb3VuZGF0aW9uLW1vZGVsL2FtYXpvbi50aXRhbi0qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06OmZvdW5kYXRpb24tbW9kZWwvbWV0YS5sbGFtYS0qYCxcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgUGFyYW1ldGVyU3RvcmVBY2Nlc3M6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICdzc206R2V0UGFyYW1ldGVyJyxcclxuICAgICAgICAgICAgICAgICdzc206R2V0UGFyYW1ldGVycycsXHJcbiAgICAgICAgICAgICAgICAnc3NtOkdldFBhcmFtZXRlcnNCeVBhdGgnLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpzc206JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnBhcmFtZXRlci9kaXNwYXRjaC1hZ2VudC8qYCxcclxuICAgICAgICAgICAgICAgIGxhbmdzbWl0aEFwaUtleVBhcmFtLnBhcmFtZXRlckFybixcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZ2VudCBMYW1iZGEgZnVuY3Rpb24gY29uZmlndXJhdGlvblxyXG4gICAgdGhpcy5hZ2VudEZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQWdlbnRGdW5jdGlvbicsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiAnZGlzcGF0Y2gtYWdlbnQtcmVhY3QtYWdlbnQnLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1JlYWN0IEFnZW50IGZvciBoYW5kbGluZyBnZW5lcmFsIHNlcnZpY2UgaW5xdWlyaWVzIGFuZCBib29raW5ncycsXHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxyXG4gICAgICBhcmNoaXRlY3R1cmU6IGxhbWJkYS5BcmNoaXRlY3R1cmUuQVJNXzY0LFxyXG4gICAgICBoYW5kbGVyOiAnbGFtYmRhLWhhbmRsZXIuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYWdlbnQvZGlzdCcpLCB7XHJcbiAgICAgICAgZXhjbHVkZTogW1xyXG4gICAgICAgICAgJ3NyYycsXHJcbiAgICAgICAgICAndGVzdCcsXHJcbiAgICAgICAgICAnKi50cycsXHJcbiAgICAgICAgICAnKi5tZCcsXHJcbiAgICAgICAgICAndHNjb25maWcuanNvbicsXHJcbiAgICAgICAgICAnbm9kZV9tb2R1bGVzJyxcclxuICAgICAgICBdLFxyXG4gICAgICB9KSxcclxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCwgLy8gSW5jcmVhc2VkIG1lbW9yeSBmb3IgTUwgd29ya2xvYWRzXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLCAvLyBMb25nZXIgdGltZW91dCBmb3IgYWdlbnQgcHJvY2Vzc2luZ1xyXG4gICAgICAvLyBSZW1vdmUgcmVzZXJ2ZWQgY29uY3VycmVuY3kgdG8gYXZvaWQgYWNjb3VudCBsaW1pdHMgZm9yIGRldmVsb3BtZW50XHJcbiAgICAgIHZwYyxcclxuICAgICAgdnBjU3VibmV0czoge1xyXG4gICAgICAgIHN1Ym5ldHM6IHZwYy5wcml2YXRlU3VibmV0cyxcclxuICAgICAgfSxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZWN1cml0eUdyb3VwXSxcclxuICAgICAgcm9sZTogYWdlbnRMYW1iZGFFeGVjdXRpb25Sb2xlLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcblxyXG4gICAgICAgIC8vIFJlZGlzIGNvbmZpZ3VyYXRpb25cclxuICAgICAgICBSRURJU19IT1NUOiByZWRpc0VuZHBvaW50LFxyXG4gICAgICAgIFJFRElTX1BPUlQ6ICc2Mzc5JyxcclxuICAgICAgICBSRURJU19QQVNTV09SRDogcHJvY2Vzcy5lbnYuUkVESVNfUEFTU1dPUkQgfHwgJycsXHJcbiAgICAgICAgUkVESVNfREI6ICcwJyxcclxuXHJcbiAgICAgICAgLy8gRHluYW1vREIgY29uZmlndXJhdGlvblxyXG4gICAgICAgIERZTkFNT0RCX1RBQkxFX05BTUVTOiB0YWJsZU5hbWVzLFxyXG4gICAgICAgIFVTRVJTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktVXNlcnMnLFxyXG4gICAgICAgIENBTExMT0dTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktQ2FsbExvZ3MnLFxyXG4gICAgICAgIENPTVBBTklFU19UQUJMRV9OQU1FOiAnVGVsZXBob255LUNvbXBhbmllcycsXHJcbiAgICAgICAgU0VSVklDRV9CT09LSU5HU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVNlcnZpY2VCb29raW5ncycsXHJcbiAgICAgICAgU0VSVklDRVNfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1TZXJ2aWNlcycsXHJcbiAgICAgICAgVFJBTlNDUklQVF9DSFVOS1NfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1UcmFuc2NyaXB0Q2h1bmtzJyxcclxuICAgICAgICBUUkFOU0NSSVBUU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVRyYW5zY3JpcHRzJyxcclxuXHJcbiAgICAgICAgLy8gUzMgY29uZmlndXJhdGlvblxyXG4gICAgICAgIFMzX0JVQ0tFVDogczNCdWNrZXROYW1lLFxyXG5cclxuICAgICAgICAvLyBCZWRyb2NrIGNvbmZpZ3VyYXRpb25cclxuICAgICAgICBCRURST0NLX0FXU19SRUdJT046IHRoaXMucmVnaW9uLFxyXG4gICAgICAgIFBSSU1BUllfTU9ERUw6ICdhbnRocm9waWMuY2xhdWRlLTMtNS1zb25uZXQtMjAyNDEwMjItdjI6MCcsXHJcbiAgICAgICAgRkFMTEJBQ0tfTU9ERUw6ICdhbnRocm9waWMuY2xhdWRlLTMtaGFpa3UtMjAyNDAzMDctdjE6MCcsXHJcblxyXG4gICAgICAgIC8vIExhbmdTbWl0aCBjb25maWd1cmF0aW9uIChBUEkga2V5IGZyb20gUGFyYW1ldGVyIFN0b3JlKVxyXG4gICAgICAgIExBTkdTTUlUSF9QUk9KRUNUOiAnZGlzcGF0Y2gtYWdlbnQtcmVhY3QtYWdlbnQnLFxyXG4gICAgICAgIExBTkdTTUlUSF9UUkFDSU5HOiAndHJ1ZScsXHJcbiAgICAgICAgTEFOR1NNSVRIX0FQSV9LRVlfUEFSQU06IGxhbmdzbWl0aEFwaUtleVBhcmFtLnBhcmFtZXRlck5hbWUsXHJcblxyXG4gICAgICAgIC8vIEFnZW50IGNvbmZpZ3VyYXRpb25cclxuICAgICAgICBBR0VOVF9NQVhfSVRFUkFUSU9OUzogJzEwJyxcclxuICAgICAgICBBR0VOVF9USU1FT1VUX1NFQ09ORFM6ICcyODAnLCAvLyBMZWF2ZSBidWZmZXIgZm9yIExhbWJkYSB0aW1lb3V0XHJcblxyXG4gICAgICAgIC8vIFNlcnZpY2UgVVJMc1xyXG4gICAgICAgIFBVQkxJQ19VUkw6IHByb2Nlc3MuZW52LlBVQkxJQ19VUkwgfHwgJ2h0dHBzOi8veW91ci1kb21haW4uY29tJyxcclxuICAgICAgICBBSV9TRVJWSUNFX1VSTDogcHJvY2Vzcy5lbnYuQUlfU0VSVklDRV9VUkwgfHwgJ2h0dHBzOi8veW91ci1haS1zZXJ2aWNlLmNvbScsXHJcbiAgICAgICAgRElTUEFUQ0hfU0VSVklDRV9VUkw6IHByb2Nlc3MuZW52LkRJU1BBVENIX1NFUlZJQ0VfVVJMIHx8ICdodHRwczovL3lvdXItZGlzcGF0Y2gtc2VydmljZS5jb20nLFxyXG4gICAgICB9LFxyXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgRnVuY3Rpb24gVVJMIGZvciBBZ2VudCBMYW1iZGFcclxuICAgIHRoaXMuYWdlbnRGdW5jdGlvblVybCA9IHRoaXMuYWdlbnRGdW5jdGlvbi5hZGRGdW5jdGlvblVybCh7XHJcbiAgICAgIGF1dGhUeXBlOiBsYW1iZGEuRnVuY3Rpb25VcmxBdXRoVHlwZS5OT05FLFxyXG4gICAgICBjb3JzOiB7XHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogZmFsc2UsXHJcbiAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnLFxyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nLFxyXG4gICAgICAgICAgJ1gtUmVxdWVzdC1JRCcsXHJcbiAgICAgICAgICAnWC1TZXNzaW9uLUlEJyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBbXHJcbiAgICAgICAgICBsYW1iZGEuSHR0cE1ldGhvZC5HRVQsXHJcbiAgICAgICAgICBsYW1iZGEuSHR0cE1ldGhvZC5QT1NULFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFtcclxuICAgICAgICAgICcqJywgLy8gQWxsb3cgYWxsIG9yaWdpbnMgZm9yIG5vdyAtIHJlc3RyaWN0IGluIHByb2R1Y3Rpb25cclxuICAgICAgICBdLFxyXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDbG91ZFdhdGNoIEFsYXJtcyBmb3IgbW9uaXRvcmluZ1xyXG4gICAgY29uc3QgZXJyb3JBbGFybSA9IHRoaXMuYWdlbnRGdW5jdGlvbi5tZXRyaWNFcnJvcnMoe1xyXG4gICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgfSkuY3JlYXRlQWxhcm0odGhpcywgJ0FnZW50RXJyb3JBbGFybScsIHtcclxuICAgICAgdGhyZXNob2xkOiA1LFxyXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcclxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2RrLmF3c19jbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcclxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FnZW50IExhbWJkYSBmdW5jdGlvbiBlcnJvciByYXRlIGlzIHRvbyBoaWdoJyxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGR1cmF0aW9uQWxhcm0gPSB0aGlzLmFnZW50RnVuY3Rpb24ubWV0cmljRHVyYXRpb24oe1xyXG4gICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgfSkuY3JlYXRlQWxhcm0odGhpcywgJ0FnZW50RHVyYXRpb25BbGFybScsIHtcclxuICAgICAgdGhyZXNob2xkOiAyNDAwMDAsIC8vIDQgbWludXRlcyBpbiBtaWxsaXNlY29uZHNcclxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXHJcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNkay5hd3NfY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXHJcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBZ2VudCBMYW1iZGEgZnVuY3Rpb24gZHVyYXRpb24gaXMgdG9vIGhpZ2gnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0IEZ1bmN0aW9uIFVSTCBmb3IgZXh0ZXJuYWwgYWNjZXNzXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWdlbnRGdW5jdGlvblVybCcsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuYWdlbnRGdW5jdGlvblVybC51cmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWdlbnQgRnVuY3Rpb24gVVJMIGZvciBleHRlcm5hbCBBUEkgYWNjZXNzJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtQWdlbnRGdW5jdGlvblVybCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXQgTGFtYmRhIGZ1bmN0aW9uIG5hbWUgZm9yIHJlZmVyZW5jZVxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50RnVuY3Rpb25OYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5hZ2VudEZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdBZ2VudCBMYW1iZGEgZnVuY3Rpb24gbmFtZScsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdEaXNwYXRjaEFnZW50LUFnZW50RnVuY3Rpb25OYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCBQYXJhbWV0ZXIgU3RvcmUgcGFyYW1ldGVyIG5hbWVcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMYW5nU21pdGhBcGlLZXlQYXJhbWV0ZXJOYW1lJywge1xyXG4gICAgICB2YWx1ZTogbGFuZ3NtaXRoQXBpS2V5UGFyYW0ucGFyYW1ldGVyTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdQYXJhbWV0ZXIgU3RvcmUgcGFyYW1ldGVyIG5hbWUgZm9yIExhbmdTbWl0aCBBUEkga2V5JyxcclxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtTGFuZ1NtaXRoQXBpS2V5UGFyYW0nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0IENsb3VkV2F0Y2ggTG9nIEdyb3VwIG5hbWUgZm9yIGRlYnVnZ2luZ1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50TG9nR3JvdXBOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5hZ2VudEZ1bmN0aW9uLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIExvZyBHcm91cCBmb3IgQWdlbnQgTGFtYmRhIGZ1bmN0aW9uJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtQWdlbnRMb2dHcm91cCcsXHJcbiAgICB9KTtcclxuICB9XHJcbn0iXX0=