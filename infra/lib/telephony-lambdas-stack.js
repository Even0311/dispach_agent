"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelephonyLambdasStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const ec2 = require("aws-cdk-lib/aws-ec2");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const path = require("path");
class TelephonyLambdasStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedSecurityGroup', securityGroupId);
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
        // Voice Handler Lambda
        const voiceHandler = new lambda.Function(this, 'VoiceHandler', {
            ...commonLambdaProps,
            functionName: 'telephony-voice-handler',
            description: 'Handles Twilio voice webhook calls',
            handler: 'dist/voice-handler/index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../telephony-lambdas'), {
                exclude: ['src', 'test', '.git', 'README.md', 'tsconfig.json'],
            }),
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
        // Gather Handler Lambda
        const gatherHandler = new lambda.Function(this, 'GatherHandler', {
            ...commonLambdaProps,
            functionName: 'dispatch-agent-gather-handler',
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
        // Status Handler Lambda
        const statusHandler = new lambda.Function(this, 'StatusHandler', {
            ...commonLambdaProps,
            functionName: 'dispatch-agent-status-handler',
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
exports.TelephonyLambdasStack = TelephonyLambdasStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVsZXBob255LWxhbWJkYXMtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ0ZWxlcGhvbnktbGFtYmRhcy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBRTdDLDZCQUE2QjtBQUU3QixNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ2xELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsNkNBQTZDO1FBQzdDLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDcEQsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLDRCQUE0QixDQUFDLENBQUMsQ0FBQztRQUN0RixNQUFNLGVBQWUsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO1FBQzlFLE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLHlCQUF5QixDQUFDLENBQUM7UUFDcEUsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUNsRSxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO1FBRTlELGdDQUFnQztRQUNoQyxNQUFNLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDekQsS0FBSztZ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U0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsaUJBQWlCLENBQUMsR0FBRztZQUM1QixXQUFXLEVBQUUsdURBQXVEO1NBQ3JFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLGlCQUFpQixDQUFDLEdBQUc7WUFDNUIsV0FBVyxFQUFFLHdEQUF3RDtTQUN0RSxDQUFDLENBQUM7UUFFSCw2Q0FBNkM7UUFDN0MsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUNsRCxLQUFLLEVBQUUsWUFBWSxDQUFDLFlBQVk7WUFDaEMsV0FBVyxFQUFFLG9DQUFvQztTQUNsRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDJCQUEyQixFQUFFO1lBQ25ELEtBQUssRUFBRSxhQUFhLENBQUMsWUFBWTtZQUNqQyxXQUFXLEVBQUUscUNBQXFDO1NBQ25ELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLEVBQUU7WUFDbkQsS0FBSyxFQUFFLGFBQWEsQ0FBQyxZQUFZO1lBQ2pDLFdBQVcsRUFBRSxxQ0FBcUM7U0FDbkQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBblBELHNEQW1QQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuXHJcbmV4cG9ydCBjbGFzcyBUZWxlcGhvbnlMYW1iZGFzU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIEltcG9ydCByZXNvdXJjZXMgZnJvbSBpbmZyYXN0cnVjdHVyZSBzdGFja1xyXG4gICAgY29uc3QgdnBjSWQgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1WcGNJZCcpO1xyXG4gICAgY29uc3Qgc3VibmV0SWRzID0gY2RrLkZuLnNwbGl0KCcsJywgY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktUHJpdmF0ZVN1Ym5ldElkcycpKTtcclxuICAgIGNvbnN0IHNlY3VyaXR5R3JvdXBJZCA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LUxhbWJkYVNlY3VyaXR5R3JvdXBJZCcpO1xyXG4gICAgY29uc3QgcmVkaXNFbmRwb2ludCA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVJlZGlzRW5kcG9pbnQnKTtcclxuICAgIGNvbnN0IHMzQnVja2V0TmFtZSA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVMzQnVja2V0TmFtZScpO1xyXG4gICAgY29uc3QgdGFibGVOYW1lcyA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVRhYmxlTmFtZXMnKTtcclxuXHJcbiAgICAvLyBJbXBvcnQgVlBDIGFuZCBzZWN1cml0eSBncm91cFxyXG4gICAgY29uc3QgdnBjID0gZWMyLlZwYy5mcm9tVnBjQXR0cmlidXRlcyh0aGlzLCAnSW1wb3J0ZWRWcGMnLCB7XHJcbiAgICAgIHZwY0lkLFxyXG4gICAgICBhdmFpbGFiaWxpdHlab25lczogY2RrLkZuLmdldEF6cygpLFxyXG4gICAgICBwcml2YXRlU3VibmV0SWRzOiBzdWJuZXRJZHMsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBzZWN1cml0eUdyb3VwID0gZWMyLlNlY3VyaXR5R3JvdXAuZnJvbVNlY3VyaXR5R3JvdXBJZChcclxuICAgICAgdGhpcyxcclxuICAgICAgJ0ltcG9ydGVkU2VjdXJpdHlHcm91cCcsXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBJZFxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgSUFNIHJvbGUgZm9yIExhbWJkYSBmdW5jdGlvbnNcclxuICAgIGNvbnN0IGxhbWJkYUV4ZWN1dGlvblJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xhbWJkYUV4ZWN1dGlvblJvbGVWMicsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXHJcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKSxcclxuICAgICAgXSxcclxuICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICBEeW5hbW9EQkFjY2VzczogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkdldEl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkRlbGV0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlF1ZXJ5JyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpTY2FuJyxcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgIHJlc291cmNlczogW1xyXG4gICAgICAgICAgICAgICAgLy8gVGFibGUgQVJOcyB3aWxsIGJlIHJlc29sdmVkIGF0IGRlcGxveSB0aW1lXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LSpgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS0qL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgLy8gSW5kaXZpZHVhbCB0YWJsZSBhY2Nlc3NcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktVXNlcnNgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1Vc2Vycy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktQ2FsbExvZ3NgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1DYWxsTG9ncy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktQ29tcGFuaWVzYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktQ29tcGFuaWVzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1TZXJ2aWNlQm9va2luZ3NgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1TZXJ2aWNlQm9va2luZ3MvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVNlcnZpY2VzYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktU2VydmljZXMvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVRyYW5zY3JpcHRDaHVua3NgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1UcmFuc2NyaXB0Q2h1bmtzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1UcmFuc2NyaXB0c2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVRyYW5zY3JpcHRzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9KSxcclxuICAgICAgICBTM0FjY2VzczogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgJ3MzOkdldE9iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICdzMzpEZWxldGVPYmplY3QnLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpzMzo6OnRlbGVwaG9ueS1zdG9yYWdlLSR7dGhpcy5hY2NvdW50fS0ke3RoaXMucmVnaW9ufWAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpzMzo6OnRlbGVwaG9ueS1zdG9yYWdlLSR7dGhpcy5hY2NvdW50fS0ke3RoaXMucmVnaW9ufS8qYCxcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDb21tb24gTGFtYmRhIGNvbmZpZ3VyYXRpb25cclxuICAgIGNvbnN0IGNvbW1vbkxhbWJkYVByb3BzID0ge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcclxuICAgICAgYXJjaGl0ZWN0dXJlOiBsYW1iZGEuQXJjaGl0ZWN0dXJlLkFSTV82NCxcclxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDEwLFxyXG4gICAgICB2cGMsXHJcbiAgICAgIHZwY1N1Ym5ldHM6IHtcclxuICAgICAgICBzdWJuZXRzOiB2cGMucHJpdmF0ZVN1Ym5ldHMsXHJcbiAgICAgIH0sXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbc2VjdXJpdHlHcm91cF0sXHJcbiAgICAgIHJvbGU6IGxhbWJkYUV4ZWN1dGlvblJvbGUsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgICBSRURJU19IT1NUOiByZWRpc0VuZHBvaW50LFxyXG4gICAgICAgIFJFRElTX1BPUlQ6ICc2Mzc5JyxcclxuICAgICAgICBTM19CVUNLRVQ6IHMzQnVja2V0TmFtZSxcclxuICAgICAgICAvLyBEeW5hbW9EQiB0YWJsZSBuYW1lcyAtIHdpbGwgYmUgcGFyc2VkIGZyb20gSlNPTiBhdCBydW50aW1lXHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEVfTkFNRVM6IHRhYmxlTmFtZXMsXHJcbiAgICAgICAgLy8gSW5kaXZpZHVhbCB0YWJsZSBuYW1lc1xyXG4gICAgICAgIFVTRVJTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktVXNlcnMnLFxyXG4gICAgICAgIENBTExMT0dTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktQ2FsbExvZ3MnLFxyXG4gICAgICAgIENPTVBBTklFU19UQUJMRV9OQU1FOiAnVGVsZXBob255LUNvbXBhbmllcycsXHJcbiAgICAgICAgU0VSVklDRV9CT09LSU5HU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVNlcnZpY2VCb29raW5ncycsXHJcbiAgICAgICAgU0VSVklDRVNfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1TZXJ2aWNlcycsXHJcbiAgICAgICAgVFJBTlNDUklQVF9DSFVOS1NfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1UcmFuc2NyaXB0Q2h1bmtzJyxcclxuICAgICAgICBUUkFOU0NSSVBUU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVRyYW5zY3JpcHRzJyxcclxuICAgICAgICAvLyBSZWRpcyBjb25maWd1cmF0aW9uXHJcbiAgICAgICAgUkVESVNfUEFTU1dPUkQ6IHByb2Nlc3MuZW52LlJFRElTX1BBU1NXT1JEIHx8ICcnLFxyXG4gICAgICAgIFJFRElTX0RCOiAnMCcsXHJcbiAgICAgICAgLy8gT3RoZXIgY29uZmlndXJhdGlvblxyXG4gICAgICAgIFBVQkxJQ19VUkw6IHByb2Nlc3MuZW52LlBVQkxJQ19VUkwgfHwgJ2h0dHBzOi8veW91ci1kb21haW4uY29tJyxcclxuICAgICAgICAvLyBFeHRlcm5hbCBzZXJ2aWNlIFVSTHMgKHRvIGJlIGNvbmZpZ3VyZWQpXHJcbiAgICAgICAgQUlfU0VSVklDRV9VUkw6IHByb2Nlc3MuZW52LkFJX1NFUlZJQ0VfVVJMIHx8ICdodHRwczovL3lvdXItYWktc2VydmljZS5jb20nLFxyXG4gICAgICAgIERJU1BBVENIX1NFUlZJQ0VfVVJMOiBwcm9jZXNzLmVudi5ESVNQQVRDSF9TRVJWSUNFX1VSTCB8fCAnaHR0cHM6Ly95b3VyLWRpc3BhdGNoLXNlcnZpY2UuY29tJyxcclxuICAgICAgfSxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBWb2ljZSBIYW5kbGVyIExhbWJkYVxyXG4gICAgY29uc3Qgdm9pY2VIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVm9pY2VIYW5kbGVyJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndGVsZXBob255LXZvaWNlLWhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0hhbmRsZXMgVHdpbGlvIHZvaWNlIHdlYmhvb2sgY2FsbHMnLFxyXG4gICAgICBoYW5kbGVyOiAnZGlzdC92b2ljZS1oYW5kbGVyL2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL3RlbGVwaG9ueS1sYW1iZGFzJyksIHtcclxuICAgICAgICBleGNsdWRlOiBbJ3NyYycsICd0ZXN0JywgJy5naXQnLCAnUkVBRE1FLm1kJywgJ3RzY29uZmlnLmpzb24nXSxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgRnVuY3Rpb24gVVJMIGZvciBWb2ljZSBIYW5kbGVyXHJcbiAgICBjb25zdCB2b2ljZUZ1bmN0aW9uVXJsID0gdm9pY2VIYW5kbGVyLmFkZEZ1bmN0aW9uVXJsKHtcclxuICAgICAgYXV0aFR5cGU6IGxhbWJkYS5GdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXHJcbiAgICAgIGNvcnM6IHtcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcclxuICAgICAgICBhbGxvd2VkSGVhZGVyczogWydDb250ZW50LVR5cGUnXSxcclxuICAgICAgICBhbGxvd2VkTWV0aG9kczogW2xhbWJkYS5IdHRwTWV0aG9kLlBPU1RdLFxyXG4gICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbXHJcbiAgICAgICAgICAnaHR0cHM6Ly93ZWJob29rcy50d2lsaW8uY29tJyxcclxuICAgICAgICAgICdodHRwczovLyoudHdpbGlvLmNvbScsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBtYXhBZ2U6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR2F0aGVyIEhhbmRsZXIgTGFtYmRhXHJcbiAgICBjb25zdCBnYXRoZXJIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnR2F0aGVySGFuZGxlcicsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ2Rpc3BhdGNoLWFnZW50LWdhdGhlci1oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdIYW5kbGVzIFR3aWxpbyBnYXRoZXIgd2ViaG9vayBjYWxscycsXHJcbiAgICAgIGhhbmRsZXI6ICdkaXN0L2dhdGhlci1oYW5kbGVyL2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL3RlbGVwaG9ueS1sYW1iZGFzJyksIHtcclxuICAgICAgICBleGNsdWRlOiBbJ3NyYycsICd0ZXN0JywgJy5naXQnLCAnUkVBRE1FLm1kJywgJ3RzY29uZmlnLmpzb24nXSxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgRnVuY3Rpb24gVVJMIGZvciBHYXRoZXIgSGFuZGxlclxyXG4gICAgY29uc3QgZ2F0aGVyRnVuY3Rpb25VcmwgPSBnYXRoZXJIYW5kbGVyLmFkZEZ1bmN0aW9uVXJsKHtcclxuICAgICAgYXV0aFR5cGU6IGxhbWJkYS5GdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXHJcbiAgICAgIGNvcnM6IHtcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcclxuICAgICAgICBhbGxvd2VkSGVhZGVyczogWydDb250ZW50LVR5cGUnXSxcclxuICAgICAgICBhbGxvd2VkTWV0aG9kczogW2xhbWJkYS5IdHRwTWV0aG9kLlBPU1RdLFxyXG4gICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbXHJcbiAgICAgICAgICAnaHR0cHM6Ly93ZWJob29rcy50d2lsaW8uY29tJyxcclxuICAgICAgICAgICdodHRwczovLyoudHdpbGlvLmNvbScsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBtYXhBZ2U6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3RhdHVzIEhhbmRsZXIgTGFtYmRhXHJcbiAgICBjb25zdCBzdGF0dXNIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU3RhdHVzSGFuZGxlcicsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ2Rpc3BhdGNoLWFnZW50LXN0YXR1cy1oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdIYW5kbGVzIFR3aWxpbyBzdGF0dXMgY2FsbGJhY2sgY2FsbHMnLFxyXG4gICAgICBoYW5kbGVyOiAnZGlzdC9zdGF0dXMtaGFuZGxlci9pbmRleC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi90ZWxlcGhvbnktbGFtYmRhcycpLCB7XHJcbiAgICAgICAgZXhjbHVkZTogWydzcmMnLCAndGVzdCcsICcuZ2l0JywgJ1JFQURNRS5tZCcsICd0c2NvbmZpZy5qc29uJ10sXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIEZ1bmN0aW9uIFVSTCBmb3IgU3RhdHVzIEhhbmRsZXJcclxuICAgIGNvbnN0IHN0YXR1c0Z1bmN0aW9uVXJsID0gc3RhdHVzSGFuZGxlci5hZGRGdW5jdGlvblVybCh7XHJcbiAgICAgIGF1dGhUeXBlOiBsYW1iZGEuRnVuY3Rpb25VcmxBdXRoVHlwZS5OT05FLFxyXG4gICAgICBjb3JzOiB7XHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogZmFsc2UsXHJcbiAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnQ29udGVudC1UeXBlJ10sXHJcbiAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtsYW1iZGEuSHR0cE1ldGhvZC5QT1NUXSxcclxuICAgICAgICBhbGxvd2VkT3JpZ2luczogW1xyXG4gICAgICAgICAgJ2h0dHBzOi8vd2ViaG9va3MudHdpbGlvLmNvbScsXHJcbiAgICAgICAgICAnaHR0cHM6Ly8qLnR3aWxpby5jb20nLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgbWF4QWdlOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENsb3VkV2F0Y2ggQWxhcm1zIGZvciBtb25pdG9yaW5nXHJcbiAgICBjb25zdCBlcnJvckFsYXJtUHJvcHMgPSB7XHJcbiAgICAgIHRocmVzaG9sZDogNSxcclxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXHJcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNkay5hd3NfY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIE91dHB1dCBGdW5jdGlvbiBVUkxzIGZvciBUd2lsaW8gY29uZmlndXJhdGlvblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZvaWNlSGFuZGxlclVybCcsIHtcclxuICAgICAgdmFsdWU6IHZvaWNlRnVuY3Rpb25VcmwudXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZvaWNlIEhhbmRsZXIgRnVuY3Rpb24gVVJMIGZvciBUd2lsaW8gVm9pY2Ugd2ViaG9vaycsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0aGVySGFuZGxlclVybCcsIHtcclxuICAgICAgdmFsdWU6IGdhdGhlckZ1bmN0aW9uVXJsLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdHYXRoZXIgSGFuZGxlciBGdW5jdGlvbiBVUkwgZm9yIFR3aWxpbyBHYXRoZXIgd2ViaG9vaycsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3RhdHVzSGFuZGxlclVybCcsIHtcclxuICAgICAgdmFsdWU6IHN0YXR1c0Z1bmN0aW9uVXJsLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdTdGF0dXMgSGFuZGxlciBGdW5jdGlvbiBVUkwgZm9yIFR3aWxpbyBTdGF0dXMgY2FsbGJhY2snLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0IExhbWJkYSBmdW5jdGlvbiBuYW1lcyBmb3IgcmVmZXJlbmNlXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVm9pY2VIYW5kbGVyRnVuY3Rpb25OYW1lJywge1xyXG4gICAgICB2YWx1ZTogdm9pY2VIYW5kbGVyLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdWb2ljZSBIYW5kbGVyIExhbWJkYSBmdW5jdGlvbiBuYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHYXRoZXJIYW5kbGVyRnVuY3Rpb25OYW1lJywge1xyXG4gICAgICB2YWx1ZTogZ2F0aGVySGFuZGxlci5mdW5jdGlvbk5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR2F0aGVyIEhhbmRsZXIgTGFtYmRhIGZ1bmN0aW9uIG5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1N0YXR1c0hhbmRsZXJGdW5jdGlvbk5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBzdGF0dXNIYW5kbGVyLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdTdGF0dXMgSGFuZGxlciBMYW1iZGEgZnVuY3Rpb24gbmFtZScsXHJcbiAgICB9KTtcclxuICB9XHJcbn0iXX0=