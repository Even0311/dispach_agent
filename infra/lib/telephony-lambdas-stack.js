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
exports.TelephonyLambdasStack = TelephonyLambdasStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVsZXBob255LWxhbWJkYXMtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ0ZWxlcGhvbnktbGFtYmRhcy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBRTdDLDZCQUE2QjtBQUU3QixNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ2xELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsNkNBQTZDO1FBQzdDLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDcEQsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLDRCQUE0QixDQUFDLENBQUMsQ0FBQztRQUN0RixNQUFNLGVBQWUsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO1FBQzlFLE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLHlCQUF5QixDQUFDLENBQUM7UUFDcEUsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUNsRSxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO1FBRTlELGdDQUFnQztRQUNoQyxNQUFNLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDekQsS0FBSztZ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LENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUNuRCxLQUFLLEVBQUUsYUFBYSxDQUFDLFlBQVk7WUFDakMsV0FBVyxFQUFFLHFDQUFxQztTQUNuRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFoUUQsc0RBZ1FDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5cclxuZXhwb3J0IGNsYXNzIFRlbGVwaG9ueUxhbWJkYXNTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gSW1wb3J0IHJlc291cmNlcyBmcm9tIGluZnJhc3RydWN0dXJlIHN0YWNrXHJcbiAgICBjb25zdCB2cGNJZCA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVZwY0lkJyk7XHJcbiAgICBjb25zdCBzdWJuZXRJZHMgPSBjZGsuRm4uc3BsaXQoJywnLCBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1Qcml2YXRlU3VibmV0SWRzJykpO1xyXG4gICAgY29uc3Qgc2VjdXJpdHlHcm91cElkID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktTGFtYmRhU2VjdXJpdHlHcm91cElkJyk7XHJcbiAgICBjb25zdCByZWRpc0VuZHBvaW50ID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktUmVkaXNFbmRwb2ludCcpO1xyXG4gICAgY29uc3QgczNCdWNrZXROYW1lID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktUzNCdWNrZXROYW1lJyk7XHJcbiAgICBjb25zdCB0YWJsZU5hbWVzID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktVGFibGVOYW1lcycpO1xyXG5cclxuICAgIC8vIEltcG9ydCBWUEMgYW5kIHNlY3VyaXR5IGdyb3VwXHJcbiAgICBjb25zdCB2cGMgPSBlYzIuVnBjLmZyb21WcGNBdHRyaWJ1dGVzKHRoaXMsICdJbXBvcnRlZFZwYycsIHtcclxuICAgICAgdnBjSWQsXHJcbiAgICAgIGF2YWlsYWJpbGl0eVpvbmVzOiBjZGsuRm4uZ2V0QXpzKCksXHJcbiAgICAgIHByaXZhdGVTdWJuZXRJZHM6IHN1Ym5ldElkcyxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNlY3VyaXR5R3JvdXAgPSBlYzIuU2VjdXJpdHlHcm91cC5mcm9tU2VjdXJpdHlHcm91cElkKFxyXG4gICAgICB0aGlzLFxyXG4gICAgICAnSW1wb3J0ZWRTZWN1cml0eUdyb3VwJyxcclxuICAgICAgc2VjdXJpdHlHcm91cElkXHJcbiAgICApO1xyXG5cclxuICAgIC8vIENyZWF0ZSBJQU0gcm9sZSBmb3IgTGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgY29uc3QgbGFtYmRhRXhlY3V0aW9uUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnTGFtYmRhRXhlY3V0aW9uUm9sZVYyJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICBdLFxyXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgIER5bmFtb0RCQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6RGVsZXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlNjYW4nLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICAgICAgICAvLyBUYWJsZSBBUk5zIHdpbGwgYmUgcmVzb2x2ZWQgYXQgZGVwbG95IHRpbWVcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LSovaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICAvLyBJbmRpdmlkdWFsIHRhYmxlIGFjY2Vzc1xyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1Vc2Vyc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVVzZXJzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1DYWxsTG9nc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LUNhbGxMb2dzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1Db21wYW5pZXNgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1Db21wYW5pZXMvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVNlcnZpY2VCb29raW5nc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVNlcnZpY2VCb29raW5ncy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktU2VydmljZXNgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1TZXJ2aWNlcy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktVHJhbnNjcmlwdENodW5rc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVRyYW5zY3JpcHRDaHVua3MvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVRyYW5zY3JpcHRzYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktVHJhbnNjcmlwdHMvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIFMzQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICdzMzpQdXRPYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgJ3MzOkRlbGV0ZU9iamVjdCcsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOnMzOjo6dGVsZXBob255LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOnMzOjo6dGVsZXBob255LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259LypgLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENvbW1vbiBMYW1iZGEgY29uZmlndXJhdGlvblxyXG4gICAgY29uc3QgY29tbW9uTGFtYmRhUHJvcHMgPSB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxyXG4gICAgICBhcmNoaXRlY3R1cmU6IGxhbWJkYS5BcmNoaXRlY3R1cmUuQVJNXzY0LFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogMTAsXHJcbiAgICAgIHZwYyxcclxuICAgICAgdnBjU3VibmV0czoge1xyXG4gICAgICAgIHN1Ym5ldHM6IHZwYy5wcml2YXRlU3VibmV0cyxcclxuICAgICAgfSxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZWN1cml0eUdyb3VwXSxcclxuICAgICAgcm9sZTogbGFtYmRhRXhlY3V0aW9uUm9sZSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICAgIFJFRElTX0hPU1Q6IHJlZGlzRW5kcG9pbnQsXHJcbiAgICAgICAgUkVESVNfUE9SVDogJzYzNzknLFxyXG4gICAgICAgIFMzX0JVQ0tFVDogczNCdWNrZXROYW1lLFxyXG4gICAgICAgIC8vIER5bmFtb0RCIHRhYmxlIG5hbWVzIC0gd2lsbCBiZSBwYXJzZWQgZnJvbSBKU09OIGF0IHJ1bnRpbWVcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRV9OQU1FUzogdGFibGVOYW1lcyxcclxuICAgICAgICAvLyBJbmRpdmlkdWFsIHRhYmxlIG5hbWVzXHJcbiAgICAgICAgVVNFUlNfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1Vc2VycycsXHJcbiAgICAgICAgQ0FMTExPR1NfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1DYWxsTG9ncycsXHJcbiAgICAgICAgQ09NUEFOSUVTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktQ29tcGFuaWVzJyxcclxuICAgICAgICBTRVJWSUNFX0JPT0tJTkdTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktU2VydmljZUJvb2tpbmdzJyxcclxuICAgICAgICBTRVJWSUNFU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVNlcnZpY2VzJyxcclxuICAgICAgICBUUkFOU0NSSVBUX0NIVU5LU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVRyYW5zY3JpcHRDaHVua3MnLFxyXG4gICAgICAgIFRSQU5TQ1JJUFRTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktVHJhbnNjcmlwdHMnLFxyXG4gICAgICAgIC8vIFJlZGlzIGNvbmZpZ3VyYXRpb25cclxuICAgICAgICBSRURJU19QQVNTV09SRDogcHJvY2Vzcy5lbnYuUkVESVNfUEFTU1dPUkQgfHwgJycsXHJcbiAgICAgICAgUkVESVNfREI6ICcwJyxcclxuICAgICAgICAvLyBPdGhlciBjb25maWd1cmF0aW9uXHJcbiAgICAgICAgUFVCTElDX1VSTDogcHJvY2Vzcy5lbnYuUFVCTElDX1VSTCB8fCAnaHR0cHM6Ly95b3VyLWRvbWFpbi5jb20nLFxyXG4gICAgICAgIC8vIEV4dGVybmFsIHNlcnZpY2UgVVJMcyAodG8gYmUgY29uZmlndXJlZClcclxuICAgICAgICBBSV9TRVJWSUNFX1VSTDogcHJvY2Vzcy5lbnYuQUlfU0VSVklDRV9VUkwgfHwgJ2h0dHBzOi8veW91ci1haS1zZXJ2aWNlLmNvbScsXHJcbiAgICAgICAgRElTUEFUQ0hfU0VSVklDRV9VUkw6IHByb2Nlc3MuZW52LkRJU1BBVENIX1NFUlZJQ0VfVVJMIHx8ICdodHRwczovL3lvdXItZGlzcGF0Y2gtc2VydmljZS5jb20nLFxyXG4gICAgICB9LFxyXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEdhdGhlciBIYW5kbGVyIExhbWJkYSAoY3JlYXRlIGZpcnN0IHRvIGdldCBVUkwpXHJcbiAgICBjb25zdCBnYXRoZXJIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnR2F0aGVySGFuZGxlcicsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RlbGVwaG9ueS1nYXRoZXItaGFuZGxlcicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnSGFuZGxlcyBUd2lsaW8gZ2F0aGVyIHdlYmhvb2sgY2FsbHMnLFxyXG4gICAgICBoYW5kbGVyOiAnZGlzdC9nYXRoZXItaGFuZGxlci9pbmRleC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi90ZWxlcGhvbnktbGFtYmRhcycpLCB7XHJcbiAgICAgICAgZXhjbHVkZTogWydzcmMnLCAndGVzdCcsICcuZ2l0JywgJ1JFQURNRS5tZCcsICd0c2NvbmZpZy5qc29uJ10sXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIEZ1bmN0aW9uIFVSTCBmb3IgR2F0aGVyIEhhbmRsZXJcclxuICAgIGNvbnN0IGdhdGhlckZ1bmN0aW9uVXJsID0gZ2F0aGVySGFuZGxlci5hZGRGdW5jdGlvblVybCh7XHJcbiAgICAgIGF1dGhUeXBlOiBsYW1iZGEuRnVuY3Rpb25VcmxBdXRoVHlwZS5OT05FLFxyXG4gICAgICBjb3JzOiB7XHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogZmFsc2UsXHJcbiAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnQ29udGVudC1UeXBlJ10sXHJcbiAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtsYW1iZGEuSHR0cE1ldGhvZC5QT1NUXSxcclxuICAgICAgICBhbGxvd2VkT3JpZ2luczogW1xyXG4gICAgICAgICAgJ2h0dHBzOi8vd2ViaG9va3MudHdpbGlvLmNvbScsXHJcbiAgICAgICAgICAnaHR0cHM6Ly8qLnR3aWxpby5jb20nLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgbWF4QWdlOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFZvaWNlIEhhbmRsZXIgTGFtYmRhIChjcmVhdGUgd2l0aCBHYXRoZXIgSGFuZGxlciBVUkwpXHJcbiAgICBjb25zdCB2b2ljZUhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdWb2ljZUhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGNvbW1vbkxhbWJkYVByb3BzLnJ1bnRpbWUsXHJcbiAgICAgIGFyY2hpdGVjdHVyZTogY29tbW9uTGFtYmRhUHJvcHMuYXJjaGl0ZWN0dXJlLFxyXG4gICAgICBtZW1vcnlTaXplOiBjb21tb25MYW1iZGFQcm9wcy5tZW1vcnlTaXplLFxyXG4gICAgICB0aW1lb3V0OiBjb21tb25MYW1iZGFQcm9wcy50aW1lb3V0LFxyXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiBjb21tb25MYW1iZGFQcm9wcy5yZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zLFxyXG4gICAgICB2cGM6IGNvbW1vbkxhbWJkYVByb3BzLnZwYyxcclxuICAgICAgdnBjU3VibmV0czogY29tbW9uTGFtYmRhUHJvcHMudnBjU3VibmV0cyxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IGNvbW1vbkxhbWJkYVByb3BzLnNlY3VyaXR5R3JvdXBzLFxyXG4gICAgICByb2xlOiBjb21tb25MYW1iZGFQcm9wcy5yb2xlLFxyXG4gICAgICBsb2dSZXRlbnRpb246IGNvbW1vbkxhbWJkYVByb3BzLmxvZ1JldGVudGlvbixcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndGVsZXBob255LXZvaWNlLWhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0hhbmRsZXMgVHdpbGlvIHZvaWNlIHdlYmhvb2sgY2FsbHMnLFxyXG4gICAgICBoYW5kbGVyOiAnZGlzdC92b2ljZS1oYW5kbGVyL2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL3RlbGVwaG9ueS1sYW1iZGFzJyksIHtcclxuICAgICAgICBleGNsdWRlOiBbJ3NyYycsICd0ZXN0JywgJy5naXQnLCAnUkVBRE1FLm1kJywgJ3RzY29uZmlnLmpzb24nXSxcclxuICAgICAgfSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMuZW52aXJvbm1lbnQsXHJcbiAgICAgICAgR0FUSEVSX0hBTkRMRVJfVVJMOiBnYXRoZXJGdW5jdGlvblVybC51cmwsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgRnVuY3Rpb24gVVJMIGZvciBWb2ljZSBIYW5kbGVyXHJcbiAgICBjb25zdCB2b2ljZUZ1bmN0aW9uVXJsID0gdm9pY2VIYW5kbGVyLmFkZEZ1bmN0aW9uVXJsKHtcclxuICAgICAgYXV0aFR5cGU6IGxhbWJkYS5GdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXHJcbiAgICAgIGNvcnM6IHtcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcclxuICAgICAgICBhbGxvd2VkSGVhZGVyczogWydDb250ZW50LVR5cGUnXSxcclxuICAgICAgICBhbGxvd2VkTWV0aG9kczogW2xhbWJkYS5IdHRwTWV0aG9kLlBPU1RdLFxyXG4gICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbXHJcbiAgICAgICAgICAnaHR0cHM6Ly93ZWJob29rcy50d2lsaW8uY29tJyxcclxuICAgICAgICAgICdodHRwczovLyoudHdpbGlvLmNvbScsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBtYXhBZ2U6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3RhdHVzIEhhbmRsZXIgTGFtYmRhXHJcbiAgICBjb25zdCBzdGF0dXNIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU3RhdHVzSGFuZGxlcicsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RlbGVwaG9ueS1zdGF0dXMtaGFuZGxlcicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnSGFuZGxlcyBUd2lsaW8gc3RhdHVzIGNhbGxiYWNrIGNhbGxzJyxcclxuICAgICAgaGFuZGxlcjogJ2Rpc3Qvc3RhdHVzLWhhbmRsZXIvaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vdGVsZXBob255LWxhbWJkYXMnKSwge1xyXG4gICAgICAgIGV4Y2x1ZGU6IFsnc3JjJywgJ3Rlc3QnLCAnLmdpdCcsICdSRUFETUUubWQnLCAndHNjb25maWcuanNvbiddLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBGdW5jdGlvbiBVUkwgZm9yIFN0YXR1cyBIYW5kbGVyXHJcbiAgICBjb25zdCBzdGF0dXNGdW5jdGlvblVybCA9IHN0YXR1c0hhbmRsZXIuYWRkRnVuY3Rpb25Vcmwoe1xyXG4gICAgICBhdXRoVHlwZTogbGFtYmRhLkZ1bmN0aW9uVXJsQXV0aFR5cGUuTk9ORSxcclxuICAgICAgY29yczoge1xyXG4gICAgICAgIGFsbG93Q3JlZGVudGlhbHM6IGZhbHNlLFxyXG4gICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbJ0NvbnRlbnQtVHlwZSddLFxyXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBbbGFtYmRhLkh0dHBNZXRob2QuUE9TVF0sXHJcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFtcclxuICAgICAgICAgICdodHRwczovL3dlYmhvb2tzLnR3aWxpby5jb20nLFxyXG4gICAgICAgICAgJ2h0dHBzOi8vKi50d2lsaW8uY29tJyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDbG91ZFdhdGNoIEFsYXJtcyBmb3IgbW9uaXRvcmluZ1xyXG4gICAgY29uc3QgZXJyb3JBbGFybVByb3BzID0ge1xyXG4gICAgICB0aHJlc2hvbGQ6IDUsXHJcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxyXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjZGsuYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBPdXRwdXQgRnVuY3Rpb24gVVJMcyBmb3IgVHdpbGlvIGNvbmZpZ3VyYXRpb25cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdWb2ljZUhhbmRsZXJVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiB2b2ljZUZ1bmN0aW9uVXJsLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdWb2ljZSBIYW5kbGVyIEZ1bmN0aW9uIFVSTCBmb3IgVHdpbGlvIFZvaWNlIHdlYmhvb2snLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGhlckhhbmRsZXJVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBnYXRoZXJGdW5jdGlvblVybC51cmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR2F0aGVyIEhhbmRsZXIgRnVuY3Rpb24gVVJMIGZvciBUd2lsaW8gR2F0aGVyIHdlYmhvb2snLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1N0YXR1c0hhbmRsZXJVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBzdGF0dXNGdW5jdGlvblVybC51cmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RhdHVzIEhhbmRsZXIgRnVuY3Rpb24gVVJMIGZvciBUd2lsaW8gU3RhdHVzIGNhbGxiYWNrJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCBMYW1iZGEgZnVuY3Rpb24gbmFtZXMgZm9yIHJlZmVyZW5jZVxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZvaWNlSGFuZGxlckZ1bmN0aW9uTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHZvaWNlSGFuZGxlci5mdW5jdGlvbk5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVm9pY2UgSGFuZGxlciBMYW1iZGEgZnVuY3Rpb24gbmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0aGVySGFuZGxlckZ1bmN0aW9uTmFtZScsIHtcclxuICAgICAgdmFsdWU6IGdhdGhlckhhbmRsZXIuZnVuY3Rpb25OYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0dhdGhlciBIYW5kbGVyIExhbWJkYSBmdW5jdGlvbiBuYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTdGF0dXNIYW5kbGVyRnVuY3Rpb25OYW1lJywge1xyXG4gICAgICB2YWx1ZTogc3RhdHVzSGFuZGxlci5mdW5jdGlvbk5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RhdHVzIEhhbmRsZXIgTGFtYmRhIGZ1bmN0aW9uIG5hbWUnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19