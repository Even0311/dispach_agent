"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DispatchAgentStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const elasticache = require("aws-cdk-lib/aws-elasticache");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecs = require("aws-cdk-lib/aws-ecs");
const ecsPatterns = require("aws-cdk-lib/aws-ecs-patterns");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const s3 = require("aws-cdk-lib/aws-s3");
const path = require("path");
class DispatchAgentStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create VPC for Redis, ECS and Lambda
        const vpc = new ec2.Vpc(this, 'DispatchAgentVpc', {
            maxAzs: 3,
            natGateways: 1,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'Private-App',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    cidrMask: 26,
                    name: 'Private-DB',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            ],
        });
        // Add VPC Gateway Endpoints for DynamoDB and S3
        vpc.addGatewayEndpoint('DynamoDBEndpoint', {
            service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
            subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
        });
        vpc.addGatewayEndpoint('S3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
        });
        // Security group for Redis
        const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
            vpc,
            description: 'Security group for Redis ElastiCache',
            allowAllOutbound: false,
        });
        // Security group for applications (ECS, Lambda)
        const appSecurityGroup = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
            vpc,
            description: 'Security group for applications (ECS tasks, Lambda functions)',
            allowAllOutbound: true,
        });
        // Allow applications to connect to Redis
        redisSecurityGroup.addIngressRule(appSecurityGroup, ec2.Port.tcp(6379), 'Allow applications to connect to Redis');
        // Redis Subnet Group (use isolated subnets for database layer)
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            description: 'Subnet group for Redis',
            subnetIds: vpc.isolatedSubnets.map(subnet => subnet.subnetId),
        });
        // Redis ElastiCache Cluster
        const redisCluster = new elasticache.CfnReplicationGroup(this, 'RedisCluster', {
            replicationGroupDescription: 'Redis cluster for session storage',
            replicationGroupId: 'dispatch-agent-redis',
            numCacheClusters: 1,
            cacheNodeType: 'cache.t3.micro',
            engine: 'redis',
            engineVersion: '7.0',
            port: 6379,
            cacheSubnetGroupName: redisSubnetGroup.ref,
            securityGroupIds: [redisSecurityGroup.securityGroupId],
            atRestEncryptionEnabled: true,
            transitEncryptionEnabled: false, // Simplify for now
            automaticFailoverEnabled: false, // Single node cluster
        });
        redisCluster.addDependency(redisSubnetGroup);
        // DynamoDB Tables
        const usersTable = new dynamodb.Table(this, 'UsersTable', {
            tableName: 'DispatchAgent-Users',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
        });
        usersTable.addGlobalSecondaryIndex({
            indexName: 'TwilioPhoneNumberIndex',
            partitionKey: { name: 'twilioPhoneNumber', type: dynamodb.AttributeType.STRING },
        });
        const companiesTable = new dynamodb.Table(this, 'CompaniesTable', {
            tableName: 'DispatchAgent-Companies',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        companiesTable.addGlobalSecondaryIndex({
            indexName: 'UserIdIndex',
            partitionKey: { name: 'user', type: dynamodb.AttributeType.STRING },
        });
        const servicesTable = new dynamodb.Table(this, 'ServicesTable', {
            tableName: 'DispatchAgent-Services',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        servicesTable.addGlobalSecondaryIndex({
            indexName: 'UserIdIndex',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
        });
        const callLogsTable = new dynamodb.Table(this, 'CallLogsTable', {
            tableName: 'DispatchAgent-CallLogs',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        callLogsTable.addGlobalSecondaryIndex({
            indexName: 'CallSidIndex',
            partitionKey: { name: 'callSid', type: dynamodb.AttributeType.STRING },
        });
        callLogsTable.addGlobalSecondaryIndex({
            indexName: 'UserIdIndex',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
        });
        const transcriptsTable = new dynamodb.Table(this, 'TranscriptsTable', {
            tableName: 'DispatchAgent-Transcripts',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        transcriptsTable.addGlobalSecondaryIndex({
            indexName: 'CallSidIndex',
            partitionKey: { name: 'callSid', type: dynamodb.AttributeType.STRING },
        });
        const transcriptChunksTable = new dynamodb.Table(this, 'TranscriptChunksTable', {
            tableName: 'DispatchAgent-TranscriptChunks',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        transcriptChunksTable.addGlobalSecondaryIndex({
            indexName: 'TranscriptIdIndex',
            partitionKey: { name: 'transcriptId', type: dynamodb.AttributeType.STRING },
        });
        const serviceBookingsTable = new dynamodb.Table(this, 'ServiceBookingsTable', {
            tableName: 'DispatchAgent-ServiceBookings',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        serviceBookingsTable.addGlobalSecondaryIndex({
            indexName: 'CallSidIndex',
            partitionKey: { name: 'callSid', type: dynamodb.AttributeType.STRING },
        });
        serviceBookingsTable.addGlobalSecondaryIndex({
            indexName: 'UserIdIndex',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
        });
        // S3 Bucket for file storage
        const storageBucket = new s3.Bucket(this, 'StorageBucket', {
            bucketName: `dispatch-agent-storage-${this.account}-${this.region}`,
            versioned: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
            lifecycleRules: [
                {
                    id: 'AudioRecordings',
                    prefix: 'recordings/',
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(30),
                        },
                        {
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(90),
                        },
                    ],
                },
            ],
        });
        // ECS Cluster
        const cluster = new ecs.Cluster(this, 'McpSessionCluster', {
            vpc,
        });
        // ECS Task Definition for MCP Session Server
        const mcpTaskDefinition = new ecs.FargateTaskDefinition(this, 'McpSessionTaskDef', {
            memoryLimitMiB: 512,
            cpu: 256,
        });
        // Add container to task definition
        const mcpContainer = mcpTaskDefinition.addContainer('McpSessionContainer', {
            image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../../mcp/session')),
            environment: {
                NODE_ENV: 'production',
                PORT: '3000',
                REDIS_HOST: redisCluster.attrPrimaryEndPointAddress,
                REDIS_PORT: '6379',
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'mcp-session',
            }),
        });
        mcpContainer.addPortMappings({
            containerPort: 3000,
            protocol: ecs.Protocol.TCP,
        });
        // ECS Service with Application Load Balancer
        const mcpService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'McpSessionService', {
            cluster,
            taskDefinition: mcpTaskDefinition,
            publicLoadBalancer: false, // Internal load balancer
            listenerPort: 80,
            securityGroups: [appSecurityGroup],
            desiredCount: 1,
        });
        // Lambda function
        const assistLambda = new lambda.Function(this, 'AssistLambda', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../agent/dist')),
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            vpc,
            securityGroups: [appSecurityGroup],
            environment: {
                NODE_ENV: 'production',
                MCP_SESSION_URL: `http://${mcpService.loadBalancer.loadBalancerDnsName}`,
                REDIS_HOST: redisCluster.attrPrimaryEndPointAddress,
                REDIS_PORT: '6379',
            },
        });
        // API Gateway
        const api = new apigateway.RestApi(this, 'DispatchAgentApi', {
            restApiName: 'Dispatch Agent API',
            description: 'API for Dispatch Agent service',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });
        // Create /v1 resource
        const v1Resource = api.root.addResource('v1');
        // Create /v1/assist resource
        const assistResource = v1Resource.addResource('assist');
        // Add POST method to /v1/assist
        assistResource.addMethod('POST', new apigateway.LambdaIntegration(assistLambda), {
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                        'method.response.header.Access-Control-Allow-Headers': true,
                        'method.response.header.Access-Control-Allow-Methods': true,
                    },
                },
                {
                    statusCode: '400',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
                {
                    statusCode: '500',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // Output the API URL
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url,
            description: 'API Gateway URL',
        });
        // Output the Lambda function name
        new cdk.CfnOutput(this, 'LambdaFunctionName', {
            value: assistLambda.functionName,
            description: 'Lambda function name',
        });
        // Export VPC and networking resources for other stacks
        new cdk.CfnOutput(this, 'VpcId', {
            value: vpc.vpcId,
            description: 'VPC ID',
            exportName: 'DispatchAgent-VpcId',
        });
        new cdk.CfnOutput(this, 'PrivateSubnetIds', {
            value: cdk.Fn.join(',', vpc.privateSubnets.map(subnet => subnet.subnetId)),
            description: 'Private subnet IDs',
            exportName: 'DispatchAgent-PrivateSubnetIds',
        });
        new cdk.CfnOutput(this, 'AppSecurityGroupId', {
            value: appSecurityGroup.securityGroupId,
            description: 'Application security group ID',
            exportName: 'DispatchAgent-AppSecurityGroupId',
        });
        // Export Redis endpoint
        new cdk.CfnOutput(this, 'RedisEndpoint', {
            value: redisCluster.attrPrimaryEndPointAddress,
            description: 'Redis ElastiCache endpoint',
            exportName: 'DispatchAgent-RedisEndpoint',
        });
        // Export S3 bucket name
        new cdk.CfnOutput(this, 'S3BucketName', {
            value: storageBucket.bucketName,
            description: 'S3 storage bucket name',
            exportName: 'DispatchAgent-S3BucketName',
        });
        // Export DynamoDB table names
        new cdk.CfnOutput(this, 'DynamoDBTableNames', {
            value: JSON.stringify({
                users: usersTable.tableName,
                companies: companiesTable.tableName,
                services: servicesTable.tableName,
                callLogs: callLogsTable.tableName,
                transcripts: transcriptsTable.tableName,
                transcriptChunks: transcriptChunksTable.tableName,
                serviceBookings: serviceBookingsTable.tableName,
            }),
            description: 'DynamoDB table names',
            exportName: 'DispatchAgent-TableNames',
        });
        // Export DynamoDB table ARNs for IAM permissions
        new cdk.CfnOutput(this, 'DynamoDBTableArns', {
            value: JSON.stringify({
                users: usersTable.tableArn,
                companies: companiesTable.tableArn,
                services: servicesTable.tableArn,
                callLogs: callLogsTable.tableArn,
                transcripts: transcriptsTable.tableArn,
                transcriptChunks: transcriptChunksTable.tableArn,
                serviceBookings: serviceBookingsTable.tableArn,
            }),
            description: 'DynamoDB table ARNs',
            exportName: 'DispatchAgent-TableArns',
        });
        // Output MCP Service Load Balancer DNS
        new cdk.CfnOutput(this, 'McpServiceUrl', {
            value: `http://${mcpService.loadBalancer.loadBalancerDnsName}`,
            description: 'MCP Session Service URL',
        });
    }
}
exports.DispatchAgentStack = DispatchAgentStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzcGF0Y2gtYWdlbnQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkaXNwYXRjaC1hZ2VudC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELHlEQUF5RDtBQUN6RCwyREFBMkQ7QUFDM0QsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw0REFBNEQ7QUFDNUQscURBQXFEO0FBQ3JELHlDQUF5QztBQUV6Qyw2QkFBNkI7QUFFN0IsTUFBYSxrQkFBbUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMvQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHVDQUF1QztRQUN2QyxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ2hELE1BQU0sRUFBRSxDQUFDO1lBQ1QsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTTtpQkFDbEM7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLGFBQWE7b0JBQ25CLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtpQkFDL0M7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFlBQVk7b0JBQ2xCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLGdCQUFnQjtpQkFDNUM7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILGdEQUFnRDtRQUNoRCxHQUFHLENBQUMsa0JBQWtCLENBQUMsa0JBQWtCLEVBQUU7WUFDekMsT0FBTyxF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QWdCLEVBQUUscUJBQXFCLENBQUMsU0FBUztnQkFDakQsZUFBZSxFQUFFLG9CQUFvQixDQUFDLFNBQVM7YUFDaEQsQ0FBQztZQUNGLFdBQVcsRUFBRSxzQkFBc0I7WUFDbkMsVUFBVSxFQUFFLDBCQUEwQjtTQUN2QyxDQUFDLENBQUM7UUFFSCxpREFBaUQ7UUFDakQsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMzQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDcEIsS0FBSyxFQUFFLFVBQVUsQ0FBQyxRQUFRO2dCQUMxQixTQUFTLEVBQUUsY0FBYyxDQUFDLFFBQVE7Z0JBQ2xDLFFBQVEsRUFBRSxhQUFhLENBQUMsUUFBUTtnQkFDaEMsUUFBUSxFQUFFLGFBQWEsQ0FBQyxRQUFRO2dCQUNoQyxXQUFXLEVBQUUsZ0JBQWdCLENBQUMsUUFBUTtnQkFDdEMsZ0JBQWdCLEVBQUUscUJBQXFCLENBQUMsUUFBUTtnQkFDaEQsZUFBZSxFQUFFLG9CQUFvQixDQUFDLFFBQVE7YUFDL0MsQ0FBQztZQUNGLFdBQVcsRUFBRSxxQkFBcUI7WUFDbEMsVUFBVSxFQUFFLHlCQUF5QjtTQUN0QyxDQUFDLENBQUM7UUFFSCx1Q0FBdUM7UUFDdkMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLFVBQVUsVUFBVSxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsRUFBRTtZQUM5RCxXQUFXLEVBQUUseUJBQXlCO1NBQ3ZDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWhZRCxnREFnWUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBlbGFzdGljYWNoZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2FjaGUnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcclxuaW1wb3J0ICogYXMgZWNzUGF0dGVybnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcy1wYXR0ZXJucyc7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XHJcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5cclxuZXhwb3J0IGNsYXNzIERpc3BhdGNoQWdlbnRTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIFZQQyBmb3IgUmVkaXMsIEVDUyBhbmQgTGFtYmRhXHJcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnRGlzcGF0Y2hBZ2VudFZwYycsIHtcclxuICAgICAgbWF4QXpzOiAzLFxyXG4gICAgICBuYXRHYXRld2F5czogMSxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICAgIG5hbWU6ICdQdWJsaWMnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgICAgbmFtZTogJ1ByaXZhdGUtQXBwJyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBjaWRyTWFzazogMjYsXHJcbiAgICAgICAgICBuYW1lOiAnUHJpdmF0ZS1EQicsXHJcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgVlBDIEdhdGV3YXkgRW5kcG9pbnRzIGZvciBEeW5hbW9EQiBhbmQgUzNcclxuICAgIHZwYy5hZGRHYXRld2F5RW5kcG9pbnQoJ0R5bmFtb0RCRW5kcG9pbnQnLCB7XHJcbiAgICAgIHNlcnZpY2U6IGVjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkRZTkFNT0RCLFxyXG4gICAgICBzdWJuZXRzOiBbeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH1dLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdnBjLmFkZEdhdGV3YXlFbmRwb2ludCgnUzNFbmRwb2ludCcsIHtcclxuICAgICAgc2VydmljZTogZWMyLkdhdGV3YXlWcGNFbmRwb2ludEF3c1NlcnZpY2UuUzMsXHJcbiAgICAgIHN1Ym5ldHM6IFt7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTZWN1cml0eSBncm91cCBmb3IgUmVkaXNcclxuICAgIGNvbnN0IHJlZGlzU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnUmVkaXNTZWN1cml0eUdyb3VwJywge1xyXG4gICAgICB2cGMsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIFJlZGlzIEVsYXN0aUNhY2hlJyxcclxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTZWN1cml0eSBncm91cCBmb3IgYXBwbGljYXRpb25zIChFQ1MsIExhbWJkYSlcclxuICAgIGNvbnN0IGFwcFNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0FwcFNlY3VyaXR5R3JvdXAnLCB7XHJcbiAgICAgIHZwYyxcclxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgYXBwbGljYXRpb25zIChFQ1MgdGFza3MsIExhbWJkYSBmdW5jdGlvbnMpJyxcclxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFsbG93IGFwcGxpY2F0aW9ucyB0byBjb25uZWN0IHRvIFJlZGlzXHJcbiAgICByZWRpc1NlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXHJcbiAgICAgIGFwcFNlY3VyaXR5R3JvdXAsXHJcbiAgICAgIGVjMi5Qb3J0LnRjcCg2Mzc5KSxcclxuICAgICAgJ0FsbG93IGFwcGxpY2F0aW9ucyB0byBjb25uZWN0IHRvIFJlZGlzJ1xyXG4gICAgKTtcclxuXHJcbiAgICAvLyBSZWRpcyBTdWJuZXQgR3JvdXAgKHVzZSBpc29sYXRlZCBzdWJuZXRzIGZvciBkYXRhYmFzZSBsYXllcilcclxuICAgIGNvbnN0IHJlZGlzU3VibmV0R3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuU3VibmV0R3JvdXAodGhpcywgJ1JlZGlzU3VibmV0R3JvdXAnLCB7XHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3VibmV0IGdyb3VwIGZvciBSZWRpcycsXHJcbiAgICAgIHN1Ym5ldElkczogdnBjLmlzb2xhdGVkU3VibmV0cy5tYXAoc3VibmV0ID0+IHN1Ym5ldC5zdWJuZXRJZCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSZWRpcyBFbGFzdGlDYWNoZSBDbHVzdGVyXHJcbiAgICBjb25zdCByZWRpc0NsdXN0ZXIgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuUmVwbGljYXRpb25Hcm91cCh0aGlzLCAnUmVkaXNDbHVzdGVyJywge1xyXG4gICAgICByZXBsaWNhdGlvbkdyb3VwRGVzY3JpcHRpb246ICdSZWRpcyBjbHVzdGVyIGZvciBzZXNzaW9uIHN0b3JhZ2UnLFxyXG4gICAgICByZXBsaWNhdGlvbkdyb3VwSWQ6ICdkaXNwYXRjaC1hZ2VudC1yZWRpcycsXHJcbiAgICAgIG51bUNhY2hlQ2x1c3RlcnM6IDEsXHJcbiAgICAgIGNhY2hlTm9kZVR5cGU6ICdjYWNoZS50My5taWNybycsXHJcbiAgICAgIGVuZ2luZTogJ3JlZGlzJyxcclxuICAgICAgZW5naW5lVmVyc2lvbjogJzcuMCcsXHJcbiAgICAgIHBvcnQ6IDYzNzksXHJcbiAgICAgIGNhY2hlU3VibmV0R3JvdXBOYW1lOiByZWRpc1N1Ym5ldEdyb3VwLnJlZixcclxuICAgICAgc2VjdXJpdHlHcm91cElkczogW3JlZGlzU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRdLFxyXG4gICAgICBhdFJlc3RFbmNyeXB0aW9uRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgdHJhbnNpdEVuY3J5cHRpb25FbmFibGVkOiBmYWxzZSwgLy8gU2ltcGxpZnkgZm9yIG5vd1xyXG4gICAgICBhdXRvbWF0aWNGYWlsb3ZlckVuYWJsZWQ6IGZhbHNlLCAvLyBTaW5nbGUgbm9kZSBjbHVzdGVyXHJcbiAgICB9KTtcclxuXHJcbiAgICByZWRpc0NsdXN0ZXIuYWRkRGVwZW5kZW5jeShyZWRpc1N1Ym5ldEdyb3VwKTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZXNcclxuICAgIGNvbnN0IHVzZXJzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1VzZXJzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ0Rpc3BhdGNoQWdlbnQtVXNlcnMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ19pZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIEZvciBkZXZlbG9wbWVudFxyXG4gICAgfSk7XHJcblxyXG4gICAgdXNlcnNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1R3aWxpb1Bob25lTnVtYmVySW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3R3aWxpb1Bob25lTnVtYmVyJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbXBhbmllc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb21wYW5pZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAnRGlzcGF0Y2hBZ2VudC1Db21wYW5pZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ19pZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb21wYW5pZXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1VzZXJJZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1c2VyJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNlcnZpY2VzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1NlcnZpY2VzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ0Rpc3BhdGNoQWdlbnQtU2VydmljZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ19pZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICBzZXJ2aWNlc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVXNlcklkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjYWxsTG9nc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDYWxsTG9nc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdEaXNwYXRjaEFnZW50LUNhbGxMb2dzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY2FsbExvZ3NUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0NhbGxTaWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY2FsbFNpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjYWxsTG9nc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVXNlcklkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB0cmFuc2NyaXB0c1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmFuc2NyaXB0c1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdEaXNwYXRjaEFnZW50LVRyYW5zY3JpcHRzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdHJhbnNjcmlwdHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0NhbGxTaWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY2FsbFNpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB0cmFuc2NyaXB0Q2h1bmtzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyYW5zY3JpcHRDaHVua3NUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAnRGlzcGF0Y2hBZ2VudC1UcmFuc2NyaXB0Q2h1bmtzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdHJhbnNjcmlwdENodW5rc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVHJhbnNjcmlwdElkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3RyYW5zY3JpcHRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBzZXJ2aWNlQm9va2luZ3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnU2VydmljZUJvb2tpbmdzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ0Rpc3BhdGNoQWdlbnQtU2VydmljZUJvb2tpbmdzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgc2VydmljZUJvb2tpbmdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdDYWxsU2lkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NhbGxTaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgc2VydmljZUJvb2tpbmdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdVc2VySWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFMzIEJ1Y2tldCBmb3IgZmlsZSBzdG9yYWdlXHJcbiAgICBjb25zdCBzdG9yYWdlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnU3RvcmFnZUJ1Y2tldCcsIHtcclxuICAgICAgYnVja2V0TmFtZTogYGRpc3BhdGNoLWFnZW50LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcclxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxyXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXHJcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIEZvciBkZXZlbG9wbWVudFxyXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGlkOiAnQXVkaW9SZWNvcmRpbmdzJyxcclxuICAgICAgICAgIHByZWZpeDogJ3JlY29yZGluZ3MvJyxcclxuICAgICAgICAgIHRyYW5zaXRpb25zOiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcclxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXHJcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBFQ1MgQ2x1c3RlclxyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnTWNwU2Vzc2lvbkNsdXN0ZXInLCB7XHJcbiAgICAgIHZwYyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEVDUyBUYXNrIERlZmluaXRpb24gZm9yIE1DUCBTZXNzaW9uIFNlcnZlclxyXG4gICAgY29uc3QgbWNwVGFza0RlZmluaXRpb24gPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLCAnTWNwU2Vzc2lvblRhc2tEZWYnLCB7XHJcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXHJcbiAgICAgIGNwdTogMjU2LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIGNvbnRhaW5lciB0byB0YXNrIGRlZmluaXRpb25cclxuICAgIGNvbnN0IG1jcENvbnRhaW5lciA9IG1jcFRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignTWNwU2Vzc2lvbkNvbnRhaW5lcicsIHtcclxuICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL21jcC9zZXNzaW9uJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgICAgUE9SVDogJzMwMDAnLFxyXG4gICAgICAgIFJFRElTX0hPU1Q6IHJlZGlzQ2x1c3Rlci5hdHRyUHJpbWFyeUVuZFBvaW50QWRkcmVzcyxcclxuICAgICAgICBSRURJU19QT1JUOiAnNjM3OScsXHJcbiAgICAgIH0sXHJcbiAgICAgIGxvZ2dpbmc6IGVjcy5Mb2dEcml2ZXJzLmF3c0xvZ3Moe1xyXG4gICAgICAgIHN0cmVhbVByZWZpeDogJ21jcC1zZXNzaW9uJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICBtY3BDb250YWluZXIuYWRkUG9ydE1hcHBpbmdzKHtcclxuICAgICAgY29udGFpbmVyUG9ydDogMzAwMCxcclxuICAgICAgcHJvdG9jb2w6IGVjcy5Qcm90b2NvbC5UQ1AsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBFQ1MgU2VydmljZSB3aXRoIEFwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXJcclxuICAgIGNvbnN0IG1jcFNlcnZpY2UgPSBuZXcgZWNzUGF0dGVybnMuQXBwbGljYXRpb25Mb2FkQmFsYW5jZWRGYXJnYXRlU2VydmljZSh0aGlzLCAnTWNwU2Vzc2lvblNlcnZpY2UnLCB7XHJcbiAgICAgIGNsdXN0ZXIsXHJcbiAgICAgIHRhc2tEZWZpbml0aW9uOiBtY3BUYXNrRGVmaW5pdGlvbixcclxuICAgICAgcHVibGljTG9hZEJhbGFuY2VyOiBmYWxzZSwgLy8gSW50ZXJuYWwgbG9hZCBiYWxhbmNlclxyXG4gICAgICBsaXN0ZW5lclBvcnQ6IDgwLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW2FwcFNlY3VyaXR5R3JvdXBdLFxyXG4gICAgICBkZXNpcmVkQ291bnQ6IDEsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb25cclxuICAgIGNvbnN0IGFzc2lzdExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0Fzc2lzdExhbWJkYScsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9hZ2VudC9kaXN0JykpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgdnBjLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW2FwcFNlY3VyaXR5R3JvdXBdLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgICAgTUNQX1NFU1NJT05fVVJMOiBgaHR0cDovLyR7bWNwU2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX1gLFxyXG4gICAgICAgIFJFRElTX0hPU1Q6IHJlZGlzQ2x1c3Rlci5hdHRyUHJpbWFyeUVuZFBvaW50QWRkcmVzcyxcclxuICAgICAgICBSRURJU19QT1JUOiAnNjM3OScsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBUEkgR2F0ZXdheVxyXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnRGlzcGF0Y2hBZ2VudEFwaScsIHtcclxuICAgICAgcmVzdEFwaU5hbWU6ICdEaXNwYXRjaCBBZ2VudCBBUEknLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBmb3IgRGlzcGF0Y2ggQWdlbnQgc2VydmljZScsXHJcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xyXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxyXG4gICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnQXV0aG9yaXphdGlvbiddLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIC92MSByZXNvdXJjZVxyXG4gICAgY29uc3QgdjFSZXNvdXJjZSA9IGFwaS5yb290LmFkZFJlc291cmNlKCd2MScpO1xyXG5cclxuICAgIC8vIENyZWF0ZSAvdjEvYXNzaXN0IHJlc291cmNlXHJcbiAgICBjb25zdCBhc3Npc3RSZXNvdXJjZSA9IHYxUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2Fzc2lzdCcpO1xyXG5cclxuICAgIC8vIEFkZCBQT1NUIG1ldGhvZCB0byAvdjEvYXNzaXN0XHJcbiAgICBhc3Npc3RSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhc3Npc3RMYW1iZGEpLCB7XHJcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxyXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XHJcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXHJcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiB0cnVlLFxyXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogdHJ1ZSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnNDAwJyxcclxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xyXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGU6ICc1MDAnLFxyXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XHJcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXQgdGhlIEFQSSBVUkxcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBhcGkudXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IFVSTCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXQgdGhlIExhbWJkYSBmdW5jdGlvbiBuYW1lXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGFtYmRhRnVuY3Rpb25OYW1lJywge1xyXG4gICAgICB2YWx1ZTogYXNzaXN0TGFtYmRhLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZnVuY3Rpb24gbmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBFeHBvcnQgVlBDIGFuZCBuZXR3b3JraW5nIHJlc291cmNlcyBmb3Igb3RoZXIgc3RhY2tzXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVnBjSWQnLCB7XHJcbiAgICAgIHZhbHVlOiB2cGMudnBjSWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVlBDIElEJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtVnBjSWQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ByaXZhdGVTdWJuZXRJZHMnLCB7XHJcbiAgICAgIHZhbHVlOiBjZGsuRm4uam9pbignLCcsIHZwYy5wcml2YXRlU3VibmV0cy5tYXAoc3VibmV0ID0+IHN1Ym5ldC5zdWJuZXRJZCkpLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1ByaXZhdGUgc3VibmV0IElEcycsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdEaXNwYXRjaEFnZW50LVByaXZhdGVTdWJuZXRJZHMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwcFNlY3VyaXR5R3JvdXBJZCcsIHtcclxuICAgICAgdmFsdWU6IGFwcFNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcGxpY2F0aW9uIHNlY3VyaXR5IGdyb3VwIElEJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtQXBwU2VjdXJpdHlHcm91cElkJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV4cG9ydCBSZWRpcyBlbmRwb2ludFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlZGlzRW5kcG9pbnQnLCB7XHJcbiAgICAgIHZhbHVlOiByZWRpc0NsdXN0ZXIuYXR0clByaW1hcnlFbmRQb2ludEFkZHJlc3MsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnUmVkaXMgRWxhc3RpQ2FjaGUgZW5kcG9pbnQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnRGlzcGF0Y2hBZ2VudC1SZWRpc0VuZHBvaW50JyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV4cG9ydCBTMyBidWNrZXQgbmFtZVxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1MzQnVja2V0TmFtZScsIHtcclxuICAgICAgdmFsdWU6IHN0b3JhZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdTMyBzdG9yYWdlIGJ1Y2tldCBuYW1lJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtUzNCdWNrZXROYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV4cG9ydCBEeW5hbW9EQiB0YWJsZSBuYW1lc1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0R5bmFtb0RCVGFibGVOYW1lcycsIHtcclxuICAgICAgdmFsdWU6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICB1c2VyczogdXNlcnNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgY29tcGFuaWVzOiBjb21wYW5pZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgc2VydmljZXM6IHNlcnZpY2VzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIGNhbGxMb2dzOiBjYWxsTG9nc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICB0cmFuc2NyaXB0czogdHJhbnNjcmlwdHNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgdHJhbnNjcmlwdENodW5rczogdHJhbnNjcmlwdENodW5rc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBzZXJ2aWNlQm9va2luZ3M6IHNlcnZpY2VCb29raW5nc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgdGFibGUgbmFtZXMnLFxyXG4gICAgICBleHBvcnROYW1lOiAnRGlzcGF0Y2hBZ2VudC1UYWJsZU5hbWVzJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV4cG9ydCBEeW5hbW9EQiB0YWJsZSBBUk5zIGZvciBJQU0gcGVybWlzc2lvbnNcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEeW5hbW9EQlRhYmxlQXJucycsIHtcclxuICAgICAgdmFsdWU6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICB1c2VyczogdXNlcnNUYWJsZS50YWJsZUFybixcclxuICAgICAgICBjb21wYW5pZXM6IGNvbXBhbmllc1RhYmxlLnRhYmxlQXJuLFxyXG4gICAgICAgIHNlcnZpY2VzOiBzZXJ2aWNlc1RhYmxlLnRhYmxlQXJuLFxyXG4gICAgICAgIGNhbGxMb2dzOiBjYWxsTG9nc1RhYmxlLnRhYmxlQXJuLFxyXG4gICAgICAgIHRyYW5zY3JpcHRzOiB0cmFuc2NyaXB0c1RhYmxlLnRhYmxlQXJuLFxyXG4gICAgICAgIHRyYW5zY3JpcHRDaHVua3M6IHRyYW5zY3JpcHRDaHVua3NUYWJsZS50YWJsZUFybixcclxuICAgICAgICBzZXJ2aWNlQm9va2luZ3M6IHNlcnZpY2VCb29raW5nc1RhYmxlLnRhYmxlQXJuLFxyXG4gICAgICB9KSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiB0YWJsZSBBUk5zJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtVGFibGVBcm5zJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCBNQ1AgU2VydmljZSBMb2FkIEJhbGFuY2VyIEROU1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ01jcFNlcnZpY2VVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBgaHR0cDovLyR7bWNwU2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX1gLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ01DUCBTZXNzaW9uIFNlcnZpY2UgVVJMJyxcclxuICAgIH0pO1xyXG4gIH1cclxufSJdfQ==