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
        // Gather Handler Lambda (create first to get URL for Voice Handler)
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
        // Voice Handler Lambda (create with Gather Handler URL)
        const voiceHandler = new lambda.Function(this, 'VoiceHandler', {
            ...commonLambdaProps,
            functionName: 'telephony-voice-handler',
            description: 'Handles Twilio voice webhook calls - v5 with Environment Fix',
            handler: 'voice-handler/index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../telephony-lambdas/dist')),
            environment: {
                NODE_ENV: 'production',
                REDIS_HOST: redisEndpoint,
                REDIS_PORT: '6379',
                S3_BUCKET: s3BucketName,
                DYNAMODB_TABLE_NAMES: tableNames,
                AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'https://your-ai-service.com',
                DISPATCH_SERVICE_URL: process.env.DISPATCH_SERVICE_URL || 'https://your-dispatch-service.com',
                GATHER_HANDLER_URL: gatherFunctionUrl.url,
            },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWluaW1hbC10ZWxlcGhvbnktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJtaW5pbWFsLXRlbGVwaG9ueS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBRTdDLDZCQUE2QjtBQUU3QixNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ2xELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsOENBQThDO1FBQzlDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxNQUFNLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSw0QkFBNEIsRUFBRTtZQUNwRixnQkFBZ0IsRUFBRSwyQkFBMkI7WUFDN0MsV0FBVyxFQUFFLDRFQUE0RTtZQUN6RixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztZQUN2RSxrQkFBa0IsRUFBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDO1lBQ2hELHVCQUF1QixFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUM7U0FDdEQsQ0FBQyxDQUFDO1FBRUgscURBQXFEO1FBQ3JELE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDcEQsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLDRCQUE0QixDQUFDLENBQUMsQ0FBQztRQUN0RixNQUFNLGVBQWUsR0FBRyxHQUFH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QUFpQixDQUFDLEdBQUc7Z0JBQ2hDLGlCQUFpQixFQUFFLGlCQUFpQixDQUFDLEdBQUc7YUFDekMsQ0FBQztZQUNGLFdBQVcsRUFBRSwyQ0FBMkM7U0FDekQsQ0FBQyxDQUFDO1FBRUgsOENBQThDO1FBQzlDLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDM0MsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ3BCLFlBQVksRUFBRSxZQUFZLENBQUMsWUFBWTtnQkFDdkMsYUFBYSxFQUFFLGFBQWEsQ0FBQyxZQUFZO2dCQUN6QyxhQUFhLEVBQUUsYUFBYSxDQUFDLFlBQVk7YUFDMUMsQ0FBQztZQUNGLFdBQVcsRUFBRSxnQ0FBZ0M7U0FDOUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBM09ELHNEQTJPQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuXHJcbmV4cG9ydCBjbGFzcyBNaW5pbWFsVGVsZXBob255U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBMYW1iZGEgTGF5ZXIgZm9yIHNoYXJlZCBkZXBlbmRlbmNpZXNcclxuICAgIGNvbnN0IGRlcGVuZGVuY2llc0xheWVyID0gbmV3IGxhbWJkYS5MYXllclZlcnNpb24odGhpcywgJ1RlbGVwaG9ueURlcGVuZGVuY2llc0xheWVyJywge1xyXG4gICAgICBsYXllclZlcnNpb25OYW1lOiAndGVsZXBob255LWRlcGVuZGVuY2llcy12MicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2hhcmVkIGRlcGVuZGVuY2llcyBmb3IgdGVsZXBob255IExhbWJkYSBmdW5jdGlvbnMgKFR3aWxpbywgQVdTIFNESywgZXRjLiknLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2xhbWJkYS1sYXllcicpKSxcclxuICAgICAgY29tcGF0aWJsZVJ1bnRpbWVzOiBbbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1hdLFxyXG4gICAgICBjb21wYXRpYmxlQXJjaGl0ZWN0dXJlczogW2xhbWJkYS5BcmNoaXRlY3R1cmUuQVJNXzY0XSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEltcG9ydCByZXNvdXJjZXMgZnJvbSBtaW5pbWFsIGluZnJhc3RydWN0dXJlIHN0YWNrXHJcbiAgICBjb25zdCB2cGNJZCA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVZwY0lkJyk7XHJcbiAgICBjb25zdCBzdWJuZXRJZHMgPSBjZGsuRm4uc3BsaXQoJywnLCBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1Qcml2YXRlU3VibmV0SWRzJykpO1xyXG4gICAgY29uc3Qgc2VjdXJpdHlHcm91cElkID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktTGFtYmRhU2VjdXJpdHlHcm91cElkJyk7XHJcbiAgICBjb25zdCByZWRpc0VuZHBvaW50ID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktUmVkaXNFbmRwb2ludCcpO1xyXG4gICAgY29uc3QgczNCdWNrZXROYW1lID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktUzNCdWNrZXROYW1lJyk7XHJcbiAgICBjb25zdCB0YWJsZU5hbWVzID0gY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktVGFibGVOYW1lcycpO1xyXG5cclxuICAgIC8vIEltcG9ydCBWUEMgYW5kIHNlY3VyaXR5IGdyb3VwXHJcbiAgICBjb25zdCB2cGMgPSBlYzIuVnBjLmZyb21WcGNBdHRyaWJ1dGVzKHRoaXMsICdJbXBvcnRlZFZwYycsIHtcclxuICAgICAgdnBjSWQsXHJcbiAgICAgIGF2YWlsYWJpbGl0eVpvbmVzOiBjZGsuRm4uZ2V0QXpzKCksXHJcbiAgICAgIHByaXZhdGVTdWJuZXRJZHM6IHN1Ym5ldElkcyxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNlY3VyaXR5R3JvdXAgPSBlYzIuU2VjdXJpdHlHcm91cC5mcm9tU2VjdXJpdHlHcm91cElkKFxyXG4gICAgICB0aGlzLFxyXG4gICAgICAnSW1wb3J0ZWRTZWN1cml0eUdyb3VwJyxcclxuICAgICAgc2VjdXJpdHlHcm91cElkXHJcbiAgICApO1xyXG5cclxuICAgIC8vIENyZWF0ZSBJQU0gcm9sZSBmb3IgTGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgY29uc3QgbGFtYmRhRXhlY3V0aW9uUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVGVsZXBob255TGFtYmRhUm9sZScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXHJcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKSxcclxuICAgICAgXSxcclxuICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICBEeW5hbW9EQkFjY2VzczogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkdldEl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkRlbGV0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlF1ZXJ5JyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpTY2FuJyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpCYXRjaEdldEl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkJhdGNoV3JpdGVJdGVtJyxcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgIHJlc291cmNlczogW1xyXG4gICAgICAgICAgICAgICAgLy8gQWxsIFRlbGVwaG9ueSB0YWJsZXMgYW5kIHRoZWlyIGluZGV4ZXNcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LSovaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIFMzQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICdzMzpQdXRPYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgJ3MzOkRlbGV0ZU9iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAnczM6TGlzdEJ1Y2tldCcsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOnMzOjo6dGVsZXBob255LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOnMzOjo6dGVsZXBob255LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259LypgLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENvbW1vbiBMYW1iZGEgY29uZmlndXJhdGlvblxyXG4gICAgY29uc3QgY29tbW9uTGFtYmRhUHJvcHMgPSB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxyXG4gICAgICBhcmNoaXRlY3R1cmU6IGxhbWJkYS5BcmNoaXRlY3R1cmUuQVJNXzY0LFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgICAgLy8gUmVtb3ZlIHJlc2VydmVkIGNvbmN1cnJlbmN5IHRvIGF2b2lkIGFjY291bnQgbGltaXRzXHJcbiAgICAgIHZwYyxcclxuICAgICAgdnBjU3VibmV0czoge1xyXG4gICAgICAgIHN1Ym5ldHM6IHZwYy5wcml2YXRlU3VibmV0cyxcclxuICAgICAgfSxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZWN1cml0eUdyb3VwXSxcclxuICAgICAgcm9sZTogbGFtYmRhRXhlY3V0aW9uUm9sZSxcclxuICAgICAgbGF5ZXJzOiBbZGVwZW5kZW5jaWVzTGF5ZXJdLCAvLyBBZGQgdGhlIHNoYXJlZCBkZXBlbmRlbmNpZXMgbGF5ZXJcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICAgIFJFRElTX0hPU1Q6IHJlZGlzRW5kcG9pbnQsXHJcbiAgICAgICAgUkVESVNfUE9SVDogJzYzNzknLFxyXG4gICAgICAgIFMzX0JVQ0tFVDogczNCdWNrZXROYW1lLFxyXG4gICAgICAgIC8vIER5bmFtb0RCIHRhYmxlIG5hbWVzIC0gd2lsbCBiZSBwYXJzZWQgZnJvbSBKU09OIGF0IHJ1bnRpbWVcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRV9OQU1FUzogdGFibGVOYW1lcyxcclxuICAgICAgICAvLyBFeHRlcm5hbCBzZXJ2aWNlIFVSTHMgKHRvIGJlIGNvbmZpZ3VyZWQgbGF0ZXIpXHJcbiAgICAgICAgQUlfU0VSVklDRV9VUkw6IHByb2Nlc3MuZW52LkFJX1NFUlZJQ0VfVVJMIHx8ICdodHRwczovL3lvdXItYWktc2VydmljZS5jb20nLFxyXG4gICAgICAgIERJU1BBVENIX1NFUlZJQ0VfVVJMOiBwcm9jZXNzLmVudi5ESVNQQVRDSF9TRVJWSUNFX1VSTCB8fCAnaHR0cHM6Ly95b3VyLWRpc3BhdGNoLXNlcnZpY2UuY29tJyxcclxuICAgICAgfSxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssIC8vIFJlZHVjZWQgZm9yIGNvc3Qgb3B0aW1pemF0aW9uXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEdhdGhlciBIYW5kbGVyIExhbWJkYSAoY3JlYXRlIGZpcnN0IHRvIGdldCBVUkwgZm9yIFZvaWNlIEhhbmRsZXIpXHJcbiAgICBjb25zdCBnYXRoZXJIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnR2F0aGVySGFuZGxlcicsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RlbGVwaG9ueS1nYXRoZXItaGFuZGxlcicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnSGFuZGxlcyBUd2lsaW8gZ2F0aGVyIHdlYmhvb2sgY2FsbHMnLFxyXG4gICAgICBoYW5kbGVyOiAnZ2F0aGVyLWhhbmRsZXIvaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vdGVsZXBob255LWxhbWJkYXMvZGlzdCcpKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBGdW5jdGlvbiBVUkwgZm9yIEdhdGhlciBIYW5kbGVyXHJcbiAgICBjb25zdCBnYXRoZXJGdW5jdGlvblVybCA9IGdhdGhlckhhbmRsZXIuYWRkRnVuY3Rpb25Vcmwoe1xyXG4gICAgICBhdXRoVHlwZTogbGFtYmRhLkZ1bmN0aW9uVXJsQXV0aFR5cGUuTk9ORSxcclxuICAgICAgY29yczoge1xyXG4gICAgICAgIGFsbG93Q3JlZGVudGlhbHM6IGZhbHNlLFxyXG4gICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbJyonXSxcclxuICAgICAgICBhbGxvd2VkTWV0aG9kczogW2xhbWJkYS5IdHRwTWV0aG9kLkFMTF0sXHJcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFsnKiddLFxyXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBWb2ljZSBIYW5kbGVyIExhbWJkYSAoY3JlYXRlIHdpdGggR2F0aGVyIEhhbmRsZXIgVVJMKVxyXG4gICAgY29uc3Qgdm9pY2VIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVm9pY2VIYW5kbGVyJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndGVsZXBob255LXZvaWNlLWhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0hhbmRsZXMgVHdpbGlvIHZvaWNlIHdlYmhvb2sgY2FsbHMgLSB2NSB3aXRoIEVudmlyb25tZW50IEZpeCcsXHJcbiAgICAgIGhhbmRsZXI6ICd2b2ljZS1oYW5kbGVyL2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL3RlbGVwaG9ueS1sYW1iZGFzL2Rpc3QnKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgICBSRURJU19IT1NUOiByZWRpc0VuZHBvaW50LFxyXG4gICAgICAgIFJFRElTX1BPUlQ6ICc2Mzc5JyxcclxuICAgICAgICBTM19CVUNLRVQ6IHMzQnVja2V0TmFtZSxcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRV9OQU1FUzogdGFibGVOYW1lcyxcclxuICAgICAgICBBSV9TRVJWSUNFX1VSTDogcHJvY2Vzcy5lbnYuQUlfU0VSVklDRV9VUkwgfHwgJ2h0dHBzOi8veW91ci1haS1zZXJ2aWNlLmNvbScsXHJcbiAgICAgICAgRElTUEFUQ0hfU0VSVklDRV9VUkw6IHByb2Nlc3MuZW52LkRJU1BBVENIX1NFUlZJQ0VfVVJMIHx8ICdodHRwczovL3lvdXItZGlzcGF0Y2gtc2VydmljZS5jb20nLFxyXG4gICAgICAgIEdBVEhFUl9IQU5ETEVSX1VSTDogZ2F0aGVyRnVuY3Rpb25VcmwudXJsLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIEZ1bmN0aW9uIFVSTCBmb3IgVm9pY2UgSGFuZGxlclxyXG4gICAgY29uc3Qgdm9pY2VGdW5jdGlvblVybCA9IHZvaWNlSGFuZGxlci5hZGRGdW5jdGlvblVybCh7XHJcbiAgICAgIGF1dGhUeXBlOiBsYW1iZGEuRnVuY3Rpb25VcmxBdXRoVHlwZS5OT05FLFxyXG4gICAgICBjb3JzOiB7XHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogZmFsc2UsXHJcbiAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnKiddLFxyXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBbbGFtYmRhLkh0dHBNZXRob2QuQUxMXSxcclxuICAgICAgICBhbGxvd2VkT3JpZ2luczogWycqJ10sXHJcbiAgICAgICAgbWF4QWdlOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFN0YXR1cyBIYW5kbGVyIExhbWJkYVxyXG4gICAgY29uc3Qgc3RhdHVzSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1N0YXR1c0hhbmRsZXInLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0ZWxlcGhvbnktc3RhdHVzLWhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0hhbmRsZXMgVHdpbGlvIHN0YXR1cyBjYWxsYmFjayBjYWxscycsXHJcbiAgICAgIGhhbmRsZXI6ICdzdGF0dXMtaGFuZGxlci9pbmRleC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi90ZWxlcGhvbnktbGFtYmRhcy9kaXN0JykpLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIEZ1bmN0aW9uIFVSTCBmb3IgU3RhdHVzIEhhbmRsZXJcclxuICAgIGNvbnN0IHN0YXR1c0Z1bmN0aW9uVXJsID0gc3RhdHVzSGFuZGxlci5hZGRGdW5jdGlvblVybCh7XHJcbiAgICAgIGF1dGhUeXBlOiBsYW1iZGEuRnVuY3Rpb25VcmxBdXRoVHlwZS5OT05FLFxyXG4gICAgICBjb3JzOiB7XHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogZmFsc2UsXHJcbiAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnKiddLFxyXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBbbGFtYmRhLkh0dHBNZXRob2QuQUxMXSxcclxuICAgICAgICBhbGxvd2VkT3JpZ2luczogWycqJ10sXHJcbiAgICAgICAgbWF4QWdlOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENsb3VkV2F0Y2ggQWxhcm1zIGZvciBiYXNpYyBtb25pdG9yaW5nXHJcbiAgICBjb25zdCBmdW5jdGlvbnMgPSBbdm9pY2VIYW5kbGVyLCBnYXRoZXJIYW5kbGVyLCBzdGF0dXNIYW5kbGVyXTtcclxuICAgIGZ1bmN0aW9ucy5mb3JFYWNoKChmdW5jLCBpbmRleCkgPT4ge1xyXG4gICAgICBjb25zdCBmdW5jdGlvbk5hbWUgPSBbJ1ZvaWNlJywgJ0dhdGhlcicsICdTdGF0dXMnXVtpbmRleF07XHJcblxyXG4gICAgICBuZXcgY2RrLmF3c19jbG91ZHdhdGNoLkFsYXJtKHRoaXMsIGAke2Z1bmN0aW9uTmFtZX1FcnJvckFsYXJtYCwge1xyXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246IGAke2Z1bmN0aW9uTmFtZX0gSGFuZGxlciBlcnJvciByYXRlIHRvbyBoaWdoYCxcclxuICAgICAgICBtZXRyaWM6IGZ1bmMubWV0cmljRXJyb3JzKHtcclxuICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgdGhyZXNob2xkOiAzLFxyXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCBGdW5jdGlvbiBVUkxzIGZvciBUd2lsaW8gY29uZmlndXJhdGlvblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZvaWNlSGFuZGxlclVybCcsIHtcclxuICAgICAgdmFsdWU6IHZvaWNlRnVuY3Rpb25VcmwudXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZvaWNlIEhhbmRsZXIgRnVuY3Rpb24gVVJMIGZvciBUd2lsaW8gVm9pY2Ugd2ViaG9vaycsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0aGVySGFuZGxlclVybCcsIHtcclxuICAgICAgdmFsdWU6IGdhdGhlckZ1bmN0aW9uVXJsLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdHYXRoZXIgSGFuZGxlciBGdW5jdGlvbiBVUkwgZm9yIFR3aWxpbyBHYXRoZXIgd2ViaG9vaycsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3RhdHVzSGFuZGxlclVybCcsIHtcclxuICAgICAgdmFsdWU6IHN0YXR1c0Z1bmN0aW9uVXJsLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdTdGF0dXMgSGFuZGxlciBGdW5jdGlvbiBVUkwgZm9yIFR3aWxpbyBTdGF0dXMgY2FsbGJhY2snLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0IGZvciBlYXN5IHJlZmVyZW5jZVxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1R3aWxpb1dlYmhvb2tDb25maWd1cmF0aW9uJywge1xyXG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIHZvaWNlVXJsOiB2b2ljZUZ1bmN0aW9uVXJsLnVybCxcclxuICAgICAgICBnYXRoZXJVcmw6IGdhdGhlckZ1bmN0aW9uVXJsLnVybCxcclxuICAgICAgICBzdGF0dXNDYWxsYmFja1VybDogc3RhdHVzRnVuY3Rpb25VcmwudXJsLFxyXG4gICAgICB9KSxcclxuICAgICAgZGVzY3JpcHRpb246ICdBbGwgd2ViaG9vayBVUkxzIGZvciBUd2lsaW8gY29uZmlndXJhdGlvbicsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXQgTGFtYmRhIGZ1bmN0aW9uIG5hbWVzIGZvciBtb25pdG9yaW5nXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGVwbG95ZWRGdW5jdGlvbnMnLCB7XHJcbiAgICAgIHZhbHVlOiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgdm9pY2VIYW5kbGVyOiB2b2ljZUhhbmRsZXIuZnVuY3Rpb25OYW1lLFxyXG4gICAgICAgIGdhdGhlckhhbmRsZXI6IGdhdGhlckhhbmRsZXIuZnVuY3Rpb25OYW1lLFxyXG4gICAgICAgIHN0YXR1c0hhbmRsZXI6IHN0YXR1c0hhbmRsZXIuZnVuY3Rpb25OYW1lLFxyXG4gICAgICB9KSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEZXBsb3llZCBMYW1iZGEgZnVuY3Rpb24gbmFtZXMnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19