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
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const aws_lambda_nodejs_2 = require("aws-cdk-lib/aws-lambda-nodejs");
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
        // this.agentFunction = new lambda.Function(this, 'AgentFunction', {
        //   functionName: 'dispatch-agent-react-agent',
        //   description: 'React Agent for handling general service inquiries and bookings',
        //   runtime: lambda.Runtime.NODEJS_20_X,
        //   architecture: lambda.Architecture.ARM_64,
        //   handler: 'dist/lambda-handler.handler',
        //   code: lambda.Code.fromAsset(path.join(__dirname, '../../agent'), {
        //     exclude: [
        //       'test',
        //       '*.ts',
        //       '*.md',
        //       'tsconfig.json',
        //       '.claude',
        //       'cdk.json',
        //       // Include node_modules and compiled dist folder
        //     ],
        //   }),
        //   memorySize: 1024, // Increased memory for ML workloads
        //   timeout: cdk.Duration.minutes(5), // Longer timeout for agent processing
        //   // Remove reserved concurrency to avoid account limits for development
        //   vpc,
        //   vpcSubnets: {
        //     subnets: vpc.privateSubnets,
        //   },
        //   securityGroups: [securityGroup],
        //   role: agentLambdaExecutionRole,
        //   environment: {
        //     NODE_ENV: 'production',
        //     // Redis configuration
        //     REDIS_HOST: redisEndpoint,
        //     REDIS_PORT: '6379',
        //     REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
        //     REDIS_DB: '0',
        //     // DynamoDB configuration
        //     DYNAMODB_TABLE_NAMES: tableNames,
        //     USERS_TABLE_NAME: 'Telephony-Users',
        //     CALLLOGS_TABLE_NAME: 'Telephony-CallLogs',
        //     COMPANIES_TABLE_NAME: 'Telephony-Companies',
        //     SERVICE_BOOKINGS_TABLE_NAME: 'Telephony-ServiceBookings',
        //     SERVICES_TABLE_NAME: 'Telephony-Services',
        //     TRANSCRIPT_CHUNKS_TABLE_NAME: 'Telephony-TranscriptChunks',
        //     TRANSCRIPTS_TABLE_NAME: 'Telephony-Transcripts',
        //     // S3 configuration
        //     S3_BUCKET: s3BucketName,
        //     // Bedrock configuration
        //     BEDROCK_AWS_REGION: this.region,
        //     PRIMARY_MODEL: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        //     FALLBACK_MODEL: 'anthropic.claude-3-haiku-20240307-v1:0',
        //     // LangSmith configuration (API key from Parameter Store)
        //     LANGSMITH_PROJECT: 'dispatch-agent-react-agent',
        //     LANGSMITH_TRACING: 'true',
        //     LANGSMITH_API_KEY_PARAM: langsmithApiKeyParam.parameterName,
        //     // Agent configuration
        //     AGENT_MAX_ITERATIONS: '10',
        //     AGENT_TIMEOUT_SECONDS: '280', // Leave buffer for Lambda timeout
        //     // Service URLs
        //     PUBLIC_URL: process.env.PUBLIC_URL || 'https://your-domain.com',
        //     AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'https://your-ai-service.com',
        //     DISPATCH_SERVICE_URL: process.env.DISPATCH_SERVICE_URL || 'https://your-dispatch-service.com',
        //   },
        //   logRetention: logs.RetentionDays.ONE_MONTH,
        // });
        // 添加调试日志
        const entryPath = path.resolve(__dirname, "../../agent/lambda-handler.ts");
        const tsconfigPath = path.resolve(__dirname, "../../agent/tsconfig.json");
        const projectRootPath = path.resolve(__dirname, "../../agent");
        console.log('=== CDK NodejsFunction 调试信息 ===');
        console.log('当前工作目录 (process.cwd()):', process.cwd());
        console.log('Stack文件目录 (__dirname):', __dirname);
        console.log('Entry文件路径:', entryPath);
        console.log('Entry文件存在:', require('fs').existsSync(entryPath));
        console.log('TSConfig路径:', tsconfigPath);
        console.log('TSConfig存在:', require('fs').existsSync(tsconfigPath));
        console.log('项目根目录:', projectRootPath);
        console.log('项目根目录存在:', require('fs').existsSync(projectRootPath));
        console.log('================================');
        this.agentFunction = new aws_lambda_nodejs_1.NodejsFunction(this, 'AgentFunction', {
            functionName: 'dispatch-agent-react-agent-v2',
            description: 'React Agent for handling general service inquiries and bookings',
            // 入口文件：建议用 .ts；如果你现在是 .js 也可以，改成 .js 即可
            entry: entryPath,
            handler: 'handler', // 源码里要导出同名的 handler
            runtime: lambda.Runtime.NODEJS_20_X,
            architecture: lambda.Architecture.ARM_64,
            memorySize: 1024,
            timeout: cdk.Duration.minutes(5),
            // 原有网络与权限保持
            vpc,
            vpcSubnets: { subnets: vpc.privateSubnets },
            securityGroups: [securityGroup],
            role: agentLambdaExecutionRole,
            environment: {
                NODE_ENV: 'production',
                NODE_OPTIONS: '--enable-source-maps', // 便于线上报错回溯到源码
                // Redis
                REDIS_HOST: redisEndpoint,
                REDIS_PORT: '6379',
                REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
                REDIS_DB: '0',
                // DynamoDB
                DYNAMODB_TABLE_NAMES: tableNames,
                USERS_TABLE_NAME: 'Telephony-Users',
                CALLLOGS_TABLE_NAME: 'Telephony-CallLogs',
                COMPANIES_TABLE_NAME: 'Telephony-Companies',
                SERVICE_BOOKINGS_TABLE_NAME: 'Telephony-ServiceBookings',
                SERVICES_TABLE_NAME: 'Telephony-Services',
                TRANSCRIPT_CHUNKS_TABLE_NAME: 'Telephony-TranscriptChunks',
                TRANSCRIPTS_TABLE_NAME: 'Telephony-Transcripts',
                // S3
                S3_BUCKET: s3BucketName,
                // Bedrock
                BEDROCK_AWS_REGION: this.region,
                PRIMARY_MODEL: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                FALLBACK_MODEL: 'anthropic.claude-3-haiku-20240307-v1:0',
                // LangSmith
                LANGSMITH_PROJECT: 'dispatch-agent-react-agent',
                LANGSMITH_TRACING: 'true',
                LANGSMITH_API_KEY_PARAM: langsmithApiKeyParam.parameterName,
                // Agent
                AGENT_MAX_ITERATIONS: '10',
                AGENT_TIMEOUT_SECONDS: '280',
                // Service URLs
                PUBLIC_URL: process.env.PUBLIC_URL || 'https://your-domain.com',
                AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'https://your-ai-service.com',
                DISPATCH_SERVICE_URL: process.env.DISPATCH_SERVICE_URL || 'https://your-dispatch-service.com',
            },
            logRetention: logs.RetentionDays.ONE_MONTH,
            // esbuild 打包配置
            bundling: {
                target: 'node20',
                format: aws_lambda_nodejs_1.OutputFormat.CJS, // 你的源码是 CJS/TS import 都可；默认也是 CJS
                minify: true,
                sourceMap: true,
                logLevel: aws_lambda_nodejs_2.LogLevel.DEBUG, // 打开 esbuild 详细日志
                metafile: true, // 生成 meta.json（记录打进包的每个文件）
                tsconfig: tsconfigPath,
                // 如果你在 agent/tsconfig.json 里使用了 baseUrl/paths，指向它
                // tsconfig: path.join(__dirname, '../../agent/tsconfig.json'),
                // 没有 Layer，就不要 external 掉常用库；让 esbuild 直接摇树打进包里
                externalModules: [],
                // 若依赖原生模块（如 sharp），可以这样声明：nodeModules: ['sharp']
                // nodeModules: [],
            },
            projectRoot: projectRootPath,
        });
        // Add Function URL for Agent Lambda
        // this.agentFunctionUrl = this.agentFunction.addFunctionUrl({
        //   authType: lambda.FunctionUrlAuthType.NONE,
        //   cors: {
        //     allowCredentials: false,
        //     allowedHeaders: [
        //       'Content-Type',
        //       'Authorization',
        //       'X-Request-ID',
        //       'X-Session-ID',
        //     ],
        //     allowedMethods: [
        //       lambda.HttpMethod.GET,
        //       lambda.HttpMethod.POST,
        //     ],
        //     allowedOrigins: [
        //       '*', // Allow all origins for now - restrict in production
        //     ],
        //     maxAge: cdk.Duration.minutes(5),
        //   },
        // });
        this.agentFunctionUrl = this.agentFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE,
            cors: {
                allowCredentials: false,
                allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Session-ID'],
                allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
                allowedOrigins: ['*'],
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdlbnQtbGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYWdlbnQtbGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw2Q0FBNkM7QUFDN0MsMkNBQTJDO0FBRTNDLDZCQUE2QjtBQUM3QixxRUFBNkU7QUFDN0UscUVBQXlEO0FBRXpELE1BQWEsZ0JBQWlCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDN0IsYUFBYSxDQUFrQjtJQUMvQixnQkFBZ0IsQ0FBcUI7SUFFckQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix5RUFBeUU7UUFDekUsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNwRCxNQUFNLFNBQVMsR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsNEJBQTRCLENBQUMsQ0FBQyxDQUFDO1FBQ3RGLE1BQU0sZUFBZSxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLGlDQUFpQyxDQUFDLENBQUM7UUFDOUUsTUFBTSxhQUFhLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMseUJBQXlCLENBQUMsQ0FBQztRQUNwRSxNQUFNLFlBQVksR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO1FBQ2xFLE1BQU0sVUFBVSxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLHNCQUFzQixDQUFDLENBQUM7UUFFOUQsZ0NBQWdDO1FBQ2hDLE1BQU0sR0FBRyxHQUFH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QUFFLHNEQUFzRDtZQUNuRSxVQUFVLEVBQUUsb0NBQW9DO1NBQ2pELENBQUMsQ0FBQztRQUVILGlEQUFpRDtRQUNqRCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzNDLEtBQUssRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxZQUFZO1lBQy9DLFdBQVcsRUFBRSxnREFBZ0Q7WUFDN0QsVUFBVSxFQUFFLDZCQUE2QjtTQUMxQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFsWUQsNENBa1lDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XHJcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uLCBPdXRwdXRGb3JtYXQgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XHJcbmltcG9ydCB7IExvZ0xldmVsIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xyXG5cclxuZXhwb3J0IGNsYXNzIEFnZW50TGFtYmRhU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIHB1YmxpYyByZWFkb25seSBhZ2VudEZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgcHVibGljIHJlYWRvbmx5IGFnZW50RnVuY3Rpb25Vcmw6IGxhbWJkYS5GdW5jdGlvblVybDtcclxuXHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gSW1wb3J0IHJlc291cmNlcyBmcm9tIGluZnJhc3RydWN0dXJlIHN0YWNrIChNaW5pbWFsSW5mcmFTdGFjayBleHBvcnRzKVxyXG4gICAgY29uc3QgdnBjSWQgPSBjZGsuRm4uaW1wb3J0VmFsdWUoJ1RlbGVwaG9ueS1WcGNJZCcpO1xyXG4gICAgY29uc3Qgc3VibmV0SWRzID0gY2RrLkZuLnNwbGl0KCcsJywgY2RrLkZuLmltcG9ydFZhbHVlKCdUZWxlcGhvbnktUHJpdmF0ZVN1Ym5ldElkcycpKTtcclxuICAgIGNvbnN0IHNlY3VyaXR5R3JvdXBJZCA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LUxhbWJkYVNlY3VyaXR5R3JvdXBJZCcpO1xyXG4gICAgY29uc3QgcmVkaXNFbmRwb2ludCA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVJlZGlzRW5kcG9pbnQnKTtcclxuICAgIGNvbnN0IHMzQnVja2V0TmFtZSA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVMzQnVja2V0TmFtZScpO1xyXG4gICAgY29uc3QgdGFibGVOYW1lcyA9IGNkay5Gbi5pbXBvcnRWYWx1ZSgnVGVsZXBob255LVRhYmxlTmFtZXMnKTtcclxuXHJcbiAgICAvLyBJbXBvcnQgVlBDIGFuZCBzZWN1cml0eSBncm91cFxyXG4gICAgY29uc3QgdnBjID0gZWMyLlZwYy5mcm9tVnBjQXR0cmlidXRlcyh0aGlzLCAnSW1wb3J0ZWRWcGMnLCB7XHJcbiAgICAgIHZwY0lkLFxyXG4gICAgICBhdmFpbGFiaWxpdHlab25lczogY2RrLkZuLmdldEF6cygpLFxyXG4gICAgICBwcml2YXRlU3VibmV0SWRzOiBzdWJuZXRJZHMsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBzZWN1cml0eUdyb3VwID0gZWMyLlNlY3VyaXR5R3JvdXAuZnJvbVNlY3VyaXR5R3JvdXBJZChcclxuICAgICAgdGhpcyxcclxuICAgICAgJ0ltcG9ydGVkU2VjdXJpdHlHcm91cCcsXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBJZFxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgUGFyYW1ldGVyIFN0b3JlIHBhcmFtZXRlciBmb3IgTGFuZ1NtaXRoIEFQSSBrZXlcclxuICAgIGNvbnN0IGxhbmdzbWl0aEFwaUtleVBhcmFtID0gbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0xhbmdTbWl0aEFwaUtleVBhcmFtJywge1xyXG4gICAgICBwYXJhbWV0ZXJOYW1lOiAnL2Rpc3BhdGNoLWFnZW50L2xhbmdzbWl0aC9hcGkta2V5JyxcclxuICAgICAgZGVzY3JpcHRpb246ICdMYW5nU21pdGggQVBJIGtleSBmb3IgYWdlbnQgdHJhY2luZyBhbmQgbW9uaXRvcmluZycsXHJcbiAgICAgIHN0cmluZ1ZhbHVlOiAncGxhY2Vob2xkZXIta2V5JywgLy8gV2lsbCBiZSB1cGRhdGVkIG1hbnVhbGx5IGFmdGVyIGRlcGxveW1lbnRcclxuICAgICAgdGllcjogc3NtLlBhcmFtZXRlclRpZXIuU1RBTkRBUkQsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgSUFNIHJvbGUgZm9yIEFnZW50IExhbWJkYSBmdW5jdGlvblxyXG4gICAgY29uc3QgYWdlbnRMYW1iZGFFeGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdBZ2VudExhbWJkYUV4ZWN1dGlvblJvbGUnLCB7XHJcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFWUENBY2Nlc3NFeGVjdXRpb25Sb2xlJyksXHJcbiAgICAgIF0sXHJcbiAgICAgIGlubGluZVBvbGljaWVzOiB7XHJcbiAgICAgICAgRHluYW1vREJBY2Nlc3M6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpHZXRJdGVtJyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpVcGRhdGVJdGVtJyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpEZWxldGVJdGVtJyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6U2NhbicsXHJcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6QmF0Y2hHZXRJdGVtJyxcclxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpCYXRjaFdyaXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgIC8vIFRhYmxlIEFSTnMgd2lsbCBiZSByZXNvbHZlZCBhdCBkZXBsb3kgdGltZVxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS0qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktKi9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIC8vIEluZGl2aWR1YWwgdGFibGUgYWNjZXNzXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVVzZXJzYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktVXNlcnMvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LUNhbGxMb2dzYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktQ2FsbExvZ3MvaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LUNvbXBhbmllc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LUNvbXBhbmllcy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktU2VydmljZUJvb2tpbmdzYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktU2VydmljZUJvb2tpbmdzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1TZXJ2aWNlc2AsXHJcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvVGVsZXBob255LVNlcnZpY2VzL2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1UcmFuc2NyaXB0Q2h1bmtzYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktVHJhbnNjcmlwdENodW5rcy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS9UZWxlcGhvbnktVHJhbnNjcmlwdHNgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL1RlbGVwaG9ueS1UcmFuc2NyaXB0cy9pbmRleC8qYCxcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgUzNBY2Nlc3M6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICdzMzpHZXRPYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgJ3MzOlB1dE9iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAnczM6RGVsZXRlT2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICdzMzpMaXN0QnVja2V0JyxcclxuICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgIHJlc291cmNlczogW1xyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6czM6Ojp0ZWxlcGhvbnktc3RvcmFnZS0ke3RoaXMuYWNjb3VudH0tJHt0aGlzLnJlZ2lvbn1gLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6czM6Ojp0ZWxlcGhvbnktc3RvcmFnZS0ke3RoaXMuYWNjb3VudH0tJHt0aGlzLnJlZ2lvbn0vKmAsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIEJlZHJvY2tBY2Nlc3M6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcclxuICAgICAgICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtJyxcclxuICAgICAgICAgICAgICAgICdiZWRyb2NrOkdldEZvdW5kYXRpb25Nb2RlbCcsXHJcbiAgICAgICAgICAgICAgICAnYmVkcm9jazpMaXN0Rm91bmRhdGlvbk1vZGVscycsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06OmZvdW5kYXRpb24tbW9kZWwvYW50aHJvcGljLmNsYXVkZS0qYCxcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06OmZvdW5kYXRpb24tbW9kZWwvYW1hem9uLnRpdGFuLSpgLFxyXG4gICAgICAgICAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufTo6Zm91bmRhdGlvbi1tb2RlbC9tZXRhLmxsYW1hLSpgLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9KSxcclxuICAgICAgICBQYXJhbWV0ZXJTdG9yZUFjY2VzczogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXInLFxyXG4gICAgICAgICAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXJzJyxcclxuICAgICAgICAgICAgICAgICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCcsXHJcbiAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgIGBhcm46YXdzOnNzbToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cGFyYW1ldGVyL2Rpc3BhdGNoLWFnZW50LypgLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3NtaXRoQXBpS2V5UGFyYW0ucGFyYW1ldGVyQXJuLFxyXG4gICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFnZW50IExhbWJkYSBmdW5jdGlvbiBjb25maWd1cmF0aW9uXHJcbiAgICAvLyB0aGlzLmFnZW50RnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBZ2VudEZ1bmN0aW9uJywge1xyXG4gICAgLy8gICBmdW5jdGlvbk5hbWU6ICdkaXNwYXRjaC1hZ2VudC1yZWFjdC1hZ2VudCcsXHJcbiAgICAvLyAgIGRlc2NyaXB0aW9uOiAnUmVhY3QgQWdlbnQgZm9yIGhhbmRsaW5nIGdlbmVyYWwgc2VydmljZSBpbnF1aXJpZXMgYW5kIGJvb2tpbmdzJyxcclxuICAgIC8vICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAvLyAgIGFyY2hpdGVjdHVyZTogbGFtYmRhLkFyY2hpdGVjdHVyZS5BUk1fNjQsXHJcbiAgICAvLyAgIGhhbmRsZXI6ICdkaXN0L2xhbWJkYS1oYW5kbGVyLmhhbmRsZXInLFxyXG4gICAgLy8gICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2FnZW50JyksIHtcclxuICAgIC8vICAgICBleGNsdWRlOiBbXHJcbiAgICAvLyAgICAgICAndGVzdCcsXHJcbiAgICAvLyAgICAgICAnKi50cycsXHJcbiAgICAvLyAgICAgICAnKi5tZCcsXHJcbiAgICAvLyAgICAgICAndHNjb25maWcuanNvbicsXHJcbiAgICAvLyAgICAgICAnLmNsYXVkZScsXHJcbiAgICAvLyAgICAgICAnY2RrLmpzb24nLFxyXG4gICAgLy8gICAgICAgLy8gSW5jbHVkZSBub2RlX21vZHVsZXMgYW5kIGNvbXBpbGVkIGRpc3QgZm9sZGVyXHJcbiAgICAvLyAgICAgXSxcclxuICAgIC8vICAgfSksXHJcbiAgICAvLyAgIG1lbW9yeVNpemU6IDEwMjQsIC8vIEluY3JlYXNlZCBtZW1vcnkgZm9yIE1MIHdvcmtsb2Fkc1xyXG4gICAgLy8gICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSwgLy8gTG9uZ2VyIHRpbWVvdXQgZm9yIGFnZW50IHByb2Nlc3NpbmdcclxuICAgIC8vICAgLy8gUmVtb3ZlIHJlc2VydmVkIGNvbmN1cnJlbmN5IHRvIGF2b2lkIGFjY291bnQgbGltaXRzIGZvciBkZXZlbG9wbWVudFxyXG4gICAgLy8gICB2cGMsXHJcbiAgICAvLyAgIHZwY1N1Ym5ldHM6IHtcclxuICAgIC8vICAgICBzdWJuZXRzOiB2cGMucHJpdmF0ZVN1Ym5ldHMsXHJcbiAgICAvLyAgIH0sXHJcbiAgICAvLyAgIHNlY3VyaXR5R3JvdXBzOiBbc2VjdXJpdHlHcm91cF0sXHJcbiAgICAvLyAgIHJvbGU6IGFnZW50TGFtYmRhRXhlY3V0aW9uUm9sZSxcclxuICAgIC8vICAgZW52aXJvbm1lbnQ6IHtcclxuICAgIC8vICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG5cclxuICAgIC8vICAgICAvLyBSZWRpcyBjb25maWd1cmF0aW9uXHJcbiAgICAvLyAgICAgUkVESVNfSE9TVDogcmVkaXNFbmRwb2ludCxcclxuICAgIC8vICAgICBSRURJU19QT1JUOiAnNjM3OScsXHJcbiAgICAvLyAgICAgUkVESVNfUEFTU1dPUkQ6IHByb2Nlc3MuZW52LlJFRElTX1BBU1NXT1JEIHx8ICcnLFxyXG4gICAgLy8gICAgIFJFRElTX0RCOiAnMCcsXHJcblxyXG4gICAgLy8gICAgIC8vIER5bmFtb0RCIGNvbmZpZ3VyYXRpb25cclxuICAgIC8vICAgICBEWU5BTU9EQl9UQUJMRV9OQU1FUzogdGFibGVOYW1lcyxcclxuICAgIC8vICAgICBVU0VSU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVVzZXJzJyxcclxuICAgIC8vICAgICBDQUxMTE9HU19UQUJMRV9OQU1FOiAnVGVsZXBob255LUNhbGxMb2dzJyxcclxuICAgIC8vICAgICBDT01QQU5JRVNfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1Db21wYW5pZXMnLFxyXG4gICAgLy8gICAgIFNFUlZJQ0VfQk9PS0lOR1NfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1TZXJ2aWNlQm9va2luZ3MnLFxyXG4gICAgLy8gICAgIFNFUlZJQ0VTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktU2VydmljZXMnLFxyXG4gICAgLy8gICAgIFRSQU5TQ1JJUFRfQ0hVTktTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktVHJhbnNjcmlwdENodW5rcycsXHJcbiAgICAvLyAgICAgVFJBTlNDUklQVFNfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1UcmFuc2NyaXB0cycsXHJcblxyXG4gICAgLy8gICAgIC8vIFMzIGNvbmZpZ3VyYXRpb25cclxuICAgIC8vICAgICBTM19CVUNLRVQ6IHMzQnVja2V0TmFtZSxcclxuXHJcbiAgICAvLyAgICAgLy8gQmVkcm9jayBjb25maWd1cmF0aW9uXHJcbiAgICAvLyAgICAgQkVEUk9DS19BV1NfUkVHSU9OOiB0aGlzLnJlZ2lvbixcclxuICAgIC8vICAgICBQUklNQVJZX01PREVMOiAnYW50aHJvcGljLmNsYXVkZS0zLTUtc29ubmV0LTIwMjQxMDIyLXYyOjAnLFxyXG4gICAgLy8gICAgIEZBTExCQUNLX01PREVMOiAnYW50aHJvcGljLmNsYXVkZS0zLWhhaWt1LTIwMjQwMzA3LXYxOjAnLFxyXG5cclxuICAgIC8vICAgICAvLyBMYW5nU21pdGggY29uZmlndXJhdGlvbiAoQVBJIGtleSBmcm9tIFBhcmFtZXRlciBTdG9yZSlcclxuICAgIC8vICAgICBMQU5HU01JVEhfUFJPSkVDVDogJ2Rpc3BhdGNoLWFnZW50LXJlYWN0LWFnZW50JyxcclxuICAgIC8vICAgICBMQU5HU01JVEhfVFJBQ0lORzogJ3RydWUnLFxyXG4gICAgLy8gICAgIExBTkdTTUlUSF9BUElfS0VZX1BBUkFNOiBsYW5nc21pdGhBcGlLZXlQYXJhbS5wYXJhbWV0ZXJOYW1lLFxyXG5cclxuICAgIC8vICAgICAvLyBBZ2VudCBjb25maWd1cmF0aW9uXHJcbiAgICAvLyAgICAgQUdFTlRfTUFYX0lURVJBVElPTlM6ICcxMCcsXHJcbiAgICAvLyAgICAgQUdFTlRfVElNRU9VVF9TRUNPTkRTOiAnMjgwJywgLy8gTGVhdmUgYnVmZmVyIGZvciBMYW1iZGEgdGltZW91dFxyXG5cclxuICAgIC8vICAgICAvLyBTZXJ2aWNlIFVSTHNcclxuICAgIC8vICAgICBQVUJMSUNfVVJMOiBwcm9jZXNzLmVudi5QVUJMSUNfVVJMIHx8ICdodHRwczovL3lvdXItZG9tYWluLmNvbScsXHJcbiAgICAvLyAgICAgQUlfU0VSVklDRV9VUkw6IHByb2Nlc3MuZW52LkFJX1NFUlZJQ0VfVVJMIHx8ICdodHRwczovL3lvdXItYWktc2VydmljZS5jb20nLFxyXG4gICAgLy8gICAgIERJU1BBVENIX1NFUlZJQ0VfVVJMOiBwcm9jZXNzLmVudi5ESVNQQVRDSF9TRVJWSUNFX1VSTCB8fCAnaHR0cHM6Ly95b3VyLWRpc3BhdGNoLXNlcnZpY2UuY29tJyxcclxuICAgIC8vICAgfSxcclxuICAgIC8vICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxyXG4gICAgLy8gfSk7XHJcblxyXG4gICAgLy8g5re75Yqg6LCD6K+V5pel5b+XXHJcbiAgICBjb25zdCBlbnRyeVBhdGggPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uLy4uL2FnZW50L2xhbWJkYS1oYW5kbGVyLnRzXCIpO1xyXG4gICAgY29uc3QgdHNjb25maWdQYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi8uLi9hZ2VudC90c2NvbmZpZy5qc29uXCIpO1xyXG4gICAgY29uc3QgcHJvamVjdFJvb3RQYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi8uLi9hZ2VudFwiKTtcclxuXHJcbiAgICBjb25zb2xlLmxvZygnPT09IENESyBOb2RlanNGdW5jdGlvbiDosIPor5Xkv6Hmga8gPT09Jyk7XHJcbiAgICBjb25zb2xlLmxvZygn5b2T5YmN5bel5L2c55uu5b2VIChwcm9jZXNzLmN3ZCgpKTonLCBwcm9jZXNzLmN3ZCgpKTtcclxuICAgIGNvbnNvbGUubG9nKCdTdGFja+aWh+S7tuebruW9lSAoX19kaXJuYW1lKTonLCBfX2Rpcm5hbWUpO1xyXG4gICAgY29uc29sZS5sb2coJ0VudHJ55paH5Lu26Lev5b6EOicsIGVudHJ5UGF0aCk7XHJcbiAgICBjb25zb2xlLmxvZygnRW50cnnmlofku7blrZjlnKg6JywgcmVxdWlyZSgnZnMnKS5leGlzdHNTeW5jKGVudHJ5UGF0aCkpO1xyXG4gICAgY29uc29sZS5sb2coJ1RTQ29uZmln6Lev5b6EOicsIHRzY29uZmlnUGF0aCk7XHJcbiAgICBjb25zb2xlLmxvZygnVFNDb25maWflrZjlnKg6JywgcmVxdWlyZSgnZnMnKS5leGlzdHNTeW5jKHRzY29uZmlnUGF0aCkpO1xyXG4gICAgY29uc29sZS5sb2coJ+mhueebruagueebruW9lTonLCBwcm9qZWN0Um9vdFBhdGgpO1xyXG4gICAgY29uc29sZS5sb2coJ+mhueebruagueebruW9leWtmOWcqDonLCByZXF1aXJlKCdmcycpLmV4aXN0c1N5bmMocHJvamVjdFJvb3RQYXRoKSk7XHJcbiAgICBjb25zb2xlLmxvZygnPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0nKTtcclxuXHJcbiAgICB0aGlzLmFnZW50RnVuY3Rpb24gPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgJ0FnZW50RnVuY3Rpb24nLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ2Rpc3BhdGNoLWFnZW50LXJlYWN0LWFnZW50LXYyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdSZWFjdCBBZ2VudCBmb3IgaGFuZGxpbmcgZ2VuZXJhbCBzZXJ2aWNlIGlucXVpcmllcyBhbmQgYm9va2luZ3MnLFxyXG5cclxuICAgICAgLy8g5YWl5Y+j5paH5Lu277ya5bu66K6u55SoIC50c++8m+WmguaenOS9oOeOsOWcqOaYryAuanMg5Lmf5Y+v5Lul77yM5pS55oiQIC5qcyDljbPlj69cclxuICAgICAgZW50cnk6IGVudHJ5UGF0aCxcclxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLCAgICAgICAgICAgICAgICAgICAgICAgLy8g5rqQ56CB6YeM6KaB5a+85Ye65ZCM5ZCN55qEIGhhbmRsZXJcclxuXHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxyXG4gICAgICBhcmNoaXRlY3R1cmU6IGxhbWJkYS5BcmNoaXRlY3R1cmUuQVJNXzY0LFxyXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuXHJcbiAgICAgIC8vIOWOn+aciee9kee7nOS4juadg+mZkOS/neaMgVxyXG4gICAgICB2cGMsXHJcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0czogdnBjLnByaXZhdGVTdWJuZXRzIH0sXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbc2VjdXJpdHlHcm91cF0sXHJcbiAgICAgIHJvbGU6IGFnZW50TGFtYmRhRXhlY3V0aW9uUm9sZSxcclxuXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgICBOT0RFX09QVElPTlM6ICctLWVuYWJsZS1zb3VyY2UtbWFwcycsICAgLy8g5L6/5LqO57q/5LiK5oql6ZSZ5Zue5rqv5Yiw5rqQ56CBXHJcblxyXG4gICAgICAgIC8vIFJlZGlzXHJcbiAgICAgICAgUkVESVNfSE9TVDogcmVkaXNFbmRwb2ludCxcclxuICAgICAgICBSRURJU19QT1JUOiAnNjM3OScsXHJcbiAgICAgICAgUkVESVNfUEFTU1dPUkQ6IHByb2Nlc3MuZW52LlJFRElTX1BBU1NXT1JEIHx8ICcnLFxyXG4gICAgICAgIFJFRElTX0RCOiAnMCcsXHJcblxyXG4gICAgICAgIC8vIER5bmFtb0RCXHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEVfTkFNRVM6IHRhYmxlTmFtZXMsXHJcbiAgICAgICAgVVNFUlNfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1Vc2VycycsXHJcbiAgICAgICAgQ0FMTExPR1NfVEFCTEVfTkFNRTogJ1RlbGVwaG9ueS1DYWxsTG9ncycsXHJcbiAgICAgICAgQ09NUEFOSUVTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktQ29tcGFuaWVzJyxcclxuICAgICAgICBTRVJWSUNFX0JPT0tJTkdTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktU2VydmljZUJvb2tpbmdzJyxcclxuICAgICAgICBTRVJWSUNFU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVNlcnZpY2VzJyxcclxuICAgICAgICBUUkFOU0NSSVBUX0NIVU5LU19UQUJMRV9OQU1FOiAnVGVsZXBob255LVRyYW5zY3JpcHRDaHVua3MnLFxyXG4gICAgICAgIFRSQU5TQ1JJUFRTX1RBQkxFX05BTUU6ICdUZWxlcGhvbnktVHJhbnNjcmlwdHMnLFxyXG5cclxuICAgICAgICAvLyBTM1xyXG4gICAgICAgIFMzX0JVQ0tFVDogczNCdWNrZXROYW1lLFxyXG5cclxuICAgICAgICAvLyBCZWRyb2NrXHJcbiAgICAgICAgQkVEUk9DS19BV1NfUkVHSU9OOiB0aGlzLnJlZ2lvbixcclxuICAgICAgICBQUklNQVJZX01PREVMOiAnYW50aHJvcGljLmNsYXVkZS0zLTUtc29ubmV0LTIwMjQxMDIyLXYyOjAnLFxyXG4gICAgICAgIEZBTExCQUNLX01PREVMOiAnYW50aHJvcGljLmNsYXVkZS0zLWhhaWt1LTIwMjQwMzA3LXYxOjAnLFxyXG5cclxuICAgICAgICAvLyBMYW5nU21pdGhcclxuICAgICAgICBMQU5HU01JVEhfUFJPSkVDVDogJ2Rpc3BhdGNoLWFnZW50LXJlYWN0LWFnZW50JyxcclxuICAgICAgICBMQU5HU01JVEhfVFJBQ0lORzogJ3RydWUnLFxyXG4gICAgICAgIExBTkdTTUlUSF9BUElfS0VZX1BBUkFNOiBsYW5nc21pdGhBcGlLZXlQYXJhbS5wYXJhbWV0ZXJOYW1lLFxyXG5cclxuICAgICAgICAvLyBBZ2VudFxyXG4gICAgICAgIEFHRU5UX01BWF9JVEVSQVRJT05TOiAnMTAnLFxyXG4gICAgICAgIEFHRU5UX1RJTUVPVVRfU0VDT05EUzogJzI4MCcsXHJcblxyXG4gICAgICAgIC8vIFNlcnZpY2UgVVJMc1xyXG4gICAgICAgIFBVQkxJQ19VUkw6IHByb2Nlc3MuZW52LlBVQkxJQ19VUkwgfHwgJ2h0dHBzOi8veW91ci1kb21haW4uY29tJyxcclxuICAgICAgICBBSV9TRVJWSUNFX1VSTDogcHJvY2Vzcy5lbnYuQUlfU0VSVklDRV9VUkwgfHwgJ2h0dHBzOi8veW91ci1haS1zZXJ2aWNlLmNvbScsXHJcbiAgICAgICAgRElTUEFUQ0hfU0VSVklDRV9VUkw6IHByb2Nlc3MuZW52LkRJU1BBVENIX1NFUlZJQ0VfVVJMIHx8ICdodHRwczovL3lvdXItZGlzcGF0Y2gtc2VydmljZS5jb20nLFxyXG4gICAgICB9LFxyXG5cclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxyXG5cclxuICAgICAgLy8gZXNidWlsZCDmiZPljIXphY3nva5cclxuICAgICAgYnVuZGxpbmc6IHtcclxuICAgICAgICB0YXJnZXQ6ICdub2RlMjAnLFxyXG4gICAgICAgIGZvcm1hdDogT3V0cHV0Rm9ybWF0LkNKUywgICAvLyDkvaDnmoTmupDnoIHmmK8gQ0pTL1RTIGltcG9ydCDpg73lj6/vvJvpu5jorqTkuZ/mmK8gQ0pTXHJcbiAgICAgICAgbWluaWZ5OiB0cnVlLFxyXG4gICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcclxuICAgICAgICBsb2dMZXZlbDogTG9nTGV2ZWwuREVCVUcsICAgLy8g5omT5byAIGVzYnVpbGQg6K+m57uG5pel5b+XXHJcbiAgICAgICAgbWV0YWZpbGU6IHRydWUsICAgICAgICAgICAgIC8vIOeUn+aIkCBtZXRhLmpzb27vvIjorrDlvZXmiZPov5vljIXnmoTmr4/kuKrmlofku7bvvIlcclxuICAgICAgICB0c2NvbmZpZzogdHNjb25maWdQYXRoLFxyXG4gICAgICAgIC8vIOWmguaenOS9oOWcqCBhZ2VudC90c2NvbmZpZy5qc29uIOmHjOS9v+eUqOS6hiBiYXNlVXJsL3BhdGhz77yM5oyH5ZCR5a6DXHJcbiAgICAgICAgLy8gdHNjb25maWc6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9hZ2VudC90c2NvbmZpZy5qc29uJyksXHJcblxyXG4gICAgICAgIC8vIOayoeaciSBMYXllcu+8jOWwseS4jeimgSBleHRlcm5hbCDmjonluLjnlKjlupPvvJvorqkgZXNidWlsZCDnm7TmjqXmkYfmoJHmiZPov5vljIXph4xcclxuICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtdLFxyXG5cclxuICAgICAgICAvLyDoi6Xkvp3otZbljp/nlJ/mqKHlnZfvvIjlpoIgc2hhcnDvvInvvIzlj6/ku6Xov5nmoLflo7DmmI7vvJpub2RlTW9kdWxlczogWydzaGFycCddXHJcbiAgICAgICAgLy8gbm9kZU1vZHVsZXM6IFtdLFxyXG4gICAgICB9LFxyXG4gICAgICBwcm9qZWN0Um9vdDogcHJvamVjdFJvb3RQYXRoLFxyXG4gICAgfSk7XHJcblxyXG5cclxuICAgIC8vIEFkZCBGdW5jdGlvbiBVUkwgZm9yIEFnZW50IExhbWJkYVxyXG4gICAgLy8gdGhpcy5hZ2VudEZ1bmN0aW9uVXJsID0gdGhpcy5hZ2VudEZ1bmN0aW9uLmFkZEZ1bmN0aW9uVXJsKHtcclxuICAgIC8vICAgYXV0aFR5cGU6IGxhbWJkYS5GdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXHJcbiAgICAvLyAgIGNvcnM6IHtcclxuICAgIC8vICAgICBhbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcclxuICAgIC8vICAgICBhbGxvd2VkSGVhZGVyczogW1xyXG4gICAgLy8gICAgICAgJ0NvbnRlbnQtVHlwZScsXHJcbiAgICAvLyAgICAgICAnQXV0aG9yaXphdGlvbicsXHJcbiAgICAvLyAgICAgICAnWC1SZXF1ZXN0LUlEJyxcclxuICAgIC8vICAgICAgICdYLVNlc3Npb24tSUQnLFxyXG4gICAgLy8gICAgIF0sXHJcbiAgICAvLyAgICAgYWxsb3dlZE1ldGhvZHM6IFtcclxuICAgIC8vICAgICAgIGxhbWJkYS5IdHRwTWV0aG9kLkdFVCxcclxuICAgIC8vICAgICAgIGxhbWJkYS5IdHRwTWV0aG9kLlBPU1QsXHJcbiAgICAvLyAgICAgXSxcclxuICAgIC8vICAgICBhbGxvd2VkT3JpZ2luczogW1xyXG4gICAgLy8gICAgICAgJyonLCAvLyBBbGxvdyBhbGwgb3JpZ2lucyBmb3Igbm93IC0gcmVzdHJpY3QgaW4gcHJvZHVjdGlvblxyXG4gICAgLy8gICAgIF0sXHJcbiAgICAvLyAgICAgbWF4QWdlOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgIC8vICAgfSxcclxuICAgIC8vIH0pO1xyXG4gICAgdGhpcy5hZ2VudEZ1bmN0aW9uVXJsID0gdGhpcy5hZ2VudEZ1bmN0aW9uLmFkZEZ1bmN0aW9uVXJsKHtcclxuICAgICAgYXV0aFR5cGU6IGxhbWJkYS5GdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXHJcbiAgICAgIGNvcnM6IHtcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcclxuICAgICAgICBhbGxvd2VkSGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnQXV0aG9yaXphdGlvbicsICdYLVJlcXVlc3QtSUQnLCAnWC1TZXNzaW9uLUlEJ10sXHJcbiAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtsYW1iZGEuSHR0cE1ldGhvZC5HRVQsIGxhbWJkYS5IdHRwTWV0aG9kLlBPU1RdLFxyXG4gICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSxcclxuICAgICAgICBtYXhBZ2U6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ2xvdWRXYXRjaCBBbGFybXMgZm9yIG1vbml0b3JpbmdcclxuICAgIGNvbnN0IGVycm9yQWxhcm0gPSB0aGlzLmFnZW50RnVuY3Rpb24ubWV0cmljRXJyb3JzKHtcclxuICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgIH0pLmNyZWF0ZUFsYXJtKHRoaXMsICdBZ2VudEVycm9yQWxhcm0nLCB7XHJcbiAgICAgIHRocmVzaG9sZDogNSxcclxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXHJcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNkay5hd3NfY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXHJcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBZ2VudCBMYW1iZGEgZnVuY3Rpb24gZXJyb3IgcmF0ZSBpcyB0b28gaGlnaCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBkdXJhdGlvbkFsYXJtID0gdGhpcy5hZ2VudEZ1bmN0aW9uLm1ldHJpY0R1cmF0aW9uKHtcclxuICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgIH0pLmNyZWF0ZUFsYXJtKHRoaXMsICdBZ2VudER1cmF0aW9uQWxhcm0nLCB7XHJcbiAgICAgIHRocmVzaG9sZDogMjQwMDAwLCAvLyA0IG1pbnV0ZXMgaW4gbWlsbGlzZWNvbmRzXHJcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxyXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjZGsuYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxyXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWdlbnQgTGFtYmRhIGZ1bmN0aW9uIGR1cmF0aW9uIGlzIHRvbyBoaWdoJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCBGdW5jdGlvbiBVUkwgZm9yIGV4dGVybmFsIGFjY2Vzc1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50RnVuY3Rpb25VcmwnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFnZW50RnVuY3Rpb25VcmwudXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FnZW50IEZ1bmN0aW9uIFVSTCBmb3IgZXh0ZXJuYWwgQVBJIGFjY2VzcycsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdEaXNwYXRjaEFnZW50LUFnZW50RnVuY3Rpb25VcmwnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0IExhbWJkYSBmdW5jdGlvbiBuYW1lIGZvciByZWZlcmVuY2VcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZ2VudEZ1bmN0aW9uTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuYWdlbnRGdW5jdGlvbi5mdW5jdGlvbk5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQWdlbnQgTGFtYmRhIGZ1bmN0aW9uIG5hbWUnLFxyXG4gICAgICBleHBvcnROYW1lOiAnRGlzcGF0Y2hBZ2VudC1BZ2VudEZ1bmN0aW9uTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXQgUGFyYW1ldGVyIFN0b3JlIHBhcmFtZXRlciBuYW1lXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGFuZ1NtaXRoQXBpS2V5UGFyYW1ldGVyTmFtZScsIHtcclxuICAgICAgdmFsdWU6IGxhbmdzbWl0aEFwaUtleVBhcmFtLnBhcmFtZXRlck5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnUGFyYW1ldGVyIFN0b3JlIHBhcmFtZXRlciBuYW1lIGZvciBMYW5nU21pdGggQVBJIGtleScsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdEaXNwYXRjaEFnZW50LUxhbmdTbWl0aEFwaUtleVBhcmFtJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCBDbG91ZFdhdGNoIExvZyBHcm91cCBuYW1lIGZvciBkZWJ1Z2dpbmdcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZ2VudExvZ0dyb3VwTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuYWdlbnRGdW5jdGlvbi5sb2dHcm91cC5sb2dHcm91cE5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRXYXRjaCBMb2cgR3JvdXAgZm9yIEFnZW50IExhbWJkYSBmdW5jdGlvbicsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdEaXNwYXRjaEFnZW50LUFnZW50TG9nR3JvdXAnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19