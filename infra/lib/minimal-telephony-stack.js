"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinimalTelephonyStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const ec2 = require("aws-cdk-lib/aws-ec2");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const path = require("path");
class MinimalTelephonyStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedSecurityGroup', securityGroupId);
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
exports.MinimalTelephonyStack = MinimalTelephonyStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWluaW1hbC10ZWxlcGhvbnktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJtaW5pbWFsLXRlbGVwaG9ueS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBRTdDLDZCQUE2QjtBQUU3QixNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ2xELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsOENBQThDO1FBQzlDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxNQUFNLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSw0QkFBNEIsRUFBRTtZQUNwRixnQkFBZ0IsRUFBRSwyQkFBMkI7WUFDN0MsV0FBVyxFQUFFLDRFQUE0RTtZQUN6RixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztZQUN2RSxrQkFBa0IsRUFBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDO1lBQ2hELHVCQUF1QixFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUM7U0FDdEQsQ0FBQyxDQUFDO1FBRUgscURBQXFEO1FBQ3JELE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDcEQsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLDRCQUE0QixDQUFDLENBQUMsQ0FBQztRQUN0RixNQUFNLGVBQWUsR0FBRyxHQUFH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RSxhQUFhLENBQUMsWUFBWTthQUMxQyxDQUFDO1lBQ0YsV0FBVyxFQUFFLGdDQUFnQztTQUM5QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFqT0Qsc0RBaU9DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5cclxuZXhwb3J0IGNsYXNzIE1pbmltYWxUZWxlcGhvbnlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBMYXllciBmb3Igc2hhcmVkIGRlcGVuZGVuY2llc1xyXG4gICAgY29uc3QgZGVwZW5kZW5jaWVzTGF5ZXIgPSBuZXcgbGFtYmRhLkxheWVyVmVyc2lvbih0aGlzLCAnVGVsZXBob255RGVwZW5kZW5jaWVzTGF5ZXInLCB7XHJcbiAgICAgIGxheWVyVmVyc2lvbk5hbWU6ICd0ZWxlcGhvbnktZGVwZW5kZW5jaWVzLXYyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdTaGFyZWQgZGVwZW5kZW5jaWVzIGZvciB0ZWxlcGhvbnkgTGFtYmRhIGZ1bmN0aW9ucyAoVHdpbGlvLCBBV1MgU0RLLCBldGMuKScsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vbGFtYmRhLWxheWVyJykpLFxyXG4gICAgICBjb21wYXRpYmxlUnVudGltZXM6IFtsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWF0sXHJcbiAgICAgIGNvbXBhdGlibGVBcmNoaXRlY3R1cmVzOiBbbGFtYmRhLkFyY2hpdGVjdHVyZS5BUk1fNjRdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gSW1wb3J0IHJlc291cmNlcyBmcm9tIG1pbmltYWwgaW5mcmFzdHJ1Y3R1cmUgc3RhY2tcclxuICAgIGNvbnN0IHZwY0lkID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktVnBjSWQnKTtcclxuICAgIGNvbnN0IHN1Ym5ldElkcyA9IGNkay5Gbi5zcGxpdCgnLCcsIGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVByaXZhdGVTdWJuZXRJZHMnKSk7XHJcbiAgICBjb25zdCBzZWN1cml0eUdyb3VwSWQgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1MYW1iZGFTZWN1cml0eUdyb3VwSWQnKTtcclxuICAgIGNvbnN0IHJlZGlzRW5kcG9pbnQgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1SZWRpc0VuZHBvaW50Jyk7XHJcbiAgICBjb25zdCBzM0J1Y2tldE5hbWUgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1TM0J1Y2tldE5hbWUnKTtcclxuICAgIGNvbnN0IHRhYmxlTmFtZXMgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1UYWJsZU5hbWVzJyk7XHJcblxyXG4gICAgLy8gSW1wb3J0IFZQQyBhbmQgc2VjdXJpdHkgZ3JvdXBcclxuICAgIGNvbnN0IHZwYyA9IGVjMi5WcGMuZnJvbVZwY0F0dHJpYnV0ZXModGhpcywgJ0ltcG9ydGVkVnBjJywge1xyXG4gICAgICB2cGNJZCxcclxuICAgICAgYXZhaWxhYmlsaXR5Wm9uZXM6IGNkay5Gbi5nZXRBenMoKSxcclxuICAgICAgcHJpdmF0ZVN1Ym5ldElkczogc3VibmV0SWRzLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgc2VjdXJpdHlHcm91cCA9IGVjMi5TZWN1cml0eUdyb3VwLmZyb21TZWN1cml0eUdyb3VwSWQoXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgICdJbXBvcnRlZFNlY3VyaXR5R3JvdXAnLFxyXG4gICAgICBzZWN1cml0eUdyb3VwSWRcclxuICAgICk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBjb25zdCBsYW1iZGFFeGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdUZWxlcGhvbnlMYW1iZGFSb2xlJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICBdLFxyXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgIER5bmFtb0RCQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6RGVsZXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlNjYW4nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkJhdGNoR2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6QmF0Y2hXcml0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICAgICAgICAvLyBBbGwgVGVsZXBob255IHRhYmxlcyBhbmQgdGhlaXIgaW5kZXhlc1xyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS0qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktKi9pbmRleC8qYCxcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgUzNBY2Nlc3M6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICdzMzpHZXRPYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgJ3MzOlB1dE9iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAnczM6RGVsZXRlT2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICdzMzpMaXN0QnVja2V0JyxcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgIHJlc291cmNlczogW1xyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6czM6Ojp0ZWxlcGhvbnktc3RvcmFnZS0ke3RoaXMuYWNjb3VudH0tJHt0aGlzLnJlZ2lvbn1gLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6czM6Ojp0ZWxlcGhvbnktc3RvcmFnZS0ke3RoaXMuYWNjb3VudH0tJHt0aGlzLnJlZ2lvbn0vKmAsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ29tbW9uIExhbWJkYSBjb25maWd1cmF0aW9uXHJcbiAgICBjb25zdCBjb21tb25MYW1iZGFQcm9wcyA9IHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgIGFyY2hpdGVjdHVyZTogbGFtYmRhLkFyY2hpdGVjdHVyZS5BUk1fNjQsXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgICAvLyBSZW1vdmUgcmVzZXJ2ZWQgY29uY3VycmVuY3kgdG8gYXZvaWQgYWNjb3VudCBsaW1pdHNcclxuICAgICAgdnBjLFxyXG4gICAgICB2cGNTdWJuZXRzOiB7XHJcbiAgICAgICAgc3VibmV0czogdnBjLnByaXZhdGVTdWJuZXRzLFxyXG4gICAgICB9LFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3NlY3VyaXR5R3JvdXBdLFxyXG4gICAgICByb2xlOiBsYW1iZGFFeGVjdXRpb25Sb2xlLFxyXG4gICAgICBsYXllcnM6IFtkZXBlbmRlbmNpZXNMYXllcl0sIC8vIEFkZCB0aGUgc2hhcmVkIGRlcGVuZGVuY2llcyBsYXllclxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgICAgUkVESVNfSE9TVDogcmVkaXNFbmRwb2ludCxcclxuICAgICAgICBSRURJU19QT1JUOiAnNjM3OScsXHJcbiAgICAgICAgUzNfQlVDS0VUOiBzM0J1Y2tldE5hbWUsXHJcbiAgICAgICAgLy8gRHluYW1vREIgdGFibGUgbmFtZXMgLSB3aWxsIGJlIHBhcnNlZCBmcm9tIEpTT04gYXQgcnVudGltZVxyXG4gICAgICAgIERZTkFNT0RCX1RBQkxFX05BTUVTOiB0YWJsZU5hbWVzLFxyXG4gICAgICAgIC8vIEV4dGVybmFsIHNlcnZpY2UgVVJMcyAodG8gYmUgY29uZmlndXJlZCBsYXRlcilcclxuICAgICAgICBBSV9TRVJWSUNFX1VSTDogcHJvY2Vzcy5lbnYuQUlfU0VSVklDRV9VUkwgfHwgJ2h0dHBzOi8veW91ci1haS1zZXJ2aWNlLmNvbScsXHJcbiAgICAgICAgRElTUEFUQ0hfU0VSVklDRV9VUkw6IHByb2Nlc3MuZW52LkRJU1BBVENIX1NFUlZJQ0VfVVJMIHx8ICdodHRwczovL3lvdXItZGlzcGF0Y2gtc2VydmljZS5jb20nLFxyXG4gICAgICB9LFxyXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSywgLy8gUmVkdWNlZCBmb3IgY29zdCBvcHRpbWl6YXRpb25cclxuICAgIH07XHJcblxyXG4gICAgLy8gVm9pY2UgSGFuZGxlciBMYW1iZGFcclxuICAgIGNvbnN0IHZvaWNlSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ZvaWNlSGFuZGxlcicsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RlbGVwaG9ueS12b2ljZS1oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdIYW5kbGVzIFR3aWxpbyB2b2ljZSB3ZWJob29rIGNhbGxzIC0gdjMgd2l0aCBMYXllcicsXHJcbiAgICAgIGhhbmRsZXI6ICd2b2ljZS1oYW5kbGVyL2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL3RlbGVwaG9ueS1sYW1iZGFzL2Rpc3QnKSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgRnVuY3Rpb24gVVJMIGZvciBWb2ljZSBIYW5kbGVyXHJcbiAgICBjb25zdCB2b2ljZUZ1bmN0aW9uVXJsID0gdm9pY2VIYW5kbGVyLmFkZEZ1bmN0aW9uVXJsKHtcclxuICAgICAgYXV0aFR5cGU6IGxhbWJkYS5GdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXHJcbiAgICAgIGNvcnM6IHtcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcclxuICAgICAgICBhbGxvd2VkSGVhZGVyczogWycqJ10sXHJcbiAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtsYW1iZGEuSHR0cE1ldGhvZC5BTExdLFxyXG4gICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSxcclxuICAgICAgICBtYXhBZ2U6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR2F0aGVyIEhhbmRsZXIgTGFtYmRhXHJcbiAgICBjb25zdCBnYXRoZXJIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnR2F0aGVySGFuZGxlcicsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RlbGVwaG9ueS1nYXRoZXItaGFuZGxlcicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnSGFuZGxlcyBUd2lsaW8gZ2F0aGVyIHdlYmhvb2sgY2FsbHMnLFxyXG4gICAgICBoYW5kbGVyOiAnZ2F0aGVyLWhhbmRsZXIvaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vdGVsZXBob255LWxhbWJkYXMvZGlzdCcpKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBGdW5jdGlvbiBVUkwgZm9yIEdhdGhlciBIYW5kbGVyXHJcbiAgICBjb25zdCBnYXRoZXJGdW5jdGlvblVybCA9IGdhdGhlckhhbmRsZXIuYWRkRnVuY3Rpb25Vcmwoe1xyXG4gICAgICBhdXRoVHlwZTogbGFtYmRhLkZ1bmN0aW9uVXJsQXV0aFR5cGUuTk9ORSxcclxuICAgICAgY29yczoge1xyXG4gICAgICAgIGFsbG93Q3JlZGVudGlhbHM6IGZhbHNlLFxyXG4gICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbJyonXSxcclxuICAgICAgICBhbGxvd2VkTWV0aG9kczogW2xhbWJkYS5IdHRwTWV0aG9kLkFMTF0sXHJcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFsnKiddLFxyXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTdGF0dXMgSGFuZGxlciBMYW1iZGFcclxuICAgIGNvbnN0IHN0YXR1c0hhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTdGF0dXNIYW5kbGVyJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndGVsZXBob255LXN0YXR1cy1oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdIYW5kbGVzIFR3aWxpbyBzdGF0dXMgY2FsbGJhY2sgY2FsbHMnLFxyXG4gICAgICBoYW5kbGVyOiAnc3RhdHVzLWhhbmRsZXIvaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vdGVsZXBob255LWxhbWJkYXMvZGlzdCcpKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBGdW5jdGlvbiBVUkwgZm9yIFN0YXR1cyBIYW5kbGVyXHJcbiAgICBjb25zdCBzdGF0dXNGdW5jdGlvblVybCA9IHN0YXR1c0hhbmRsZXIuYWRkRnVuY3Rpb25Vcmwoe1xyXG4gICAgICBhdXRoVHlwZTogbGFtYmRhLkZ1bmN0aW9uVXJsQXV0aFR5cGUuTk9ORSxcclxuICAgICAgY29yczoge1xyXG4gICAgICAgIGFsbG93Q3JlZGVudGlhbHM6IGZhbHNlLFxyXG4gICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbJyonXSxcclxuICAgICAgICBhbGxvd2VkTWV0aG9kczogW2xhbWJkYS5IdHRwTWV0aG9kLkFMTF0sXHJcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFsnKiddLFxyXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDbG91ZFdhdGNoIEFsYXJtcyBmb3IgYmFzaWMgbW9uaXRvcmluZ1xyXG4gICAgY29uc3QgZnVuY3Rpb25zID0gW3ZvaWNlSGFuZGxlciwgZ2F0aGVySGFuZGxlciwgc3RhdHVzSGFuZGxlcl07XHJcbiAgICBmdW5jdGlvbnMuZm9yRWFjaCgoZnVuYywgaW5kZXgpID0+IHtcclxuICAgICAgY29uc3QgZnVuY3Rpb25OYW1lID0gWydWb2ljZScsICdHYXRoZXInLCAnU3RhdHVzJ11baW5kZXhdO1xyXG5cclxuICAgICAgbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBgJHtmdW5jdGlvbk5hbWV9RXJyb3JBbGFybWAsIHtcclxuICAgICAgICBhbGFybURlc2NyaXB0aW9uOiBgJHtmdW5jdGlvbk5hbWV9IEhhbmRsZXIgZXJyb3IgcmF0ZSB0b28gaGlnaGAsXHJcbiAgICAgICAgbWV0cmljOiBmdW5jLm1ldHJpY0Vycm9ycyh7XHJcbiAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIHRocmVzaG9sZDogMyxcclxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXQgRnVuY3Rpb24gVVJMcyBmb3IgVHdpbGlvIGNvbmZpZ3VyYXRpb25cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdWb2ljZUhhbmRsZXJVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiB2b2ljZUZ1bmN0aW9uVXJsLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdWb2ljZSBIYW5kbGVyIEZ1bmN0aW9uIFVSTCBmb3IgVHdpbGlvIFZvaWNlIHdlYmhvb2snLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGhlckhhbmRsZXJVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBnYXRoZXJGdW5jdGlvblVybC51cmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR2F0aGVyIEhhbmRsZXIgRnVuY3Rpb24gVVJMIGZvciBUd2lsaW8gR2F0aGVyIHdlYmhvb2snLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1N0YXR1c0hhbmRsZXJVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBzdGF0dXNGdW5jdGlvblVybC51cmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RhdHVzIEhhbmRsZXIgRnVuY3Rpb24gVVJMIGZvciBUd2lsaW8gU3RhdHVzIGNhbGxiYWNrJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCBmb3IgZWFzeSByZWZlcmVuY2VcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdUd2lsaW9XZWJob29rQ29uZmlndXJhdGlvbicsIHtcclxuICAgICAgdmFsdWU6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICB2b2ljZVVybDogdm9pY2VGdW5jdGlvblVybC51cmwsXHJcbiAgICAgICAgZ2F0aGVyVXJsOiBnYXRoZXJGdW5jdGlvblVybC51cmwsXHJcbiAgICAgICAgc3RhdHVzQ2FsbGJhY2tVcmw6IHN0YXR1c0Z1bmN0aW9uVXJsLnVybCxcclxuICAgICAgfSksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWxsIHdlYmhvb2sgVVJMcyBmb3IgVHdpbGlvIGNvbmZpZ3VyYXRpb24nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0IExhbWJkYSBmdW5jdGlvbiBuYW1lcyBmb3IgbW9uaXRvcmluZ1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RlcGxveWVkRnVuY3Rpb25zJywge1xyXG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIHZvaWNlSGFuZGxlcjogdm9pY2VIYW5kbGVyLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgICBnYXRoZXJIYW5kbGVyOiBnYXRoZXJIYW5kbGVyLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgICBzdGF0dXNIYW5kbGVyOiBzdGF0dXNIYW5kbGVyLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgfSksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGVwbG95ZWQgTGFtYmRhIGZ1bmN0aW9uIG5hbWVzJyxcclxuICAgIH0pO1xyXG4gIH1cclxufSJdfQ==