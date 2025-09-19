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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzcGF0Y2gtYWdlbnQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkaXNwYXRjaC1hZ2VudC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELHlEQUF5RDtBQUN6RCwyREFBMkQ7QUFDM0QsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw0REFBNEQ7QUFDNUQscURBQXFEO0FBQ3JELHlDQUF5QztBQUV6Qyw2QkFBNkI7QUFFN0IsTUFBYSxrQkFBbUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMvQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHVDQUF1QztRQUN2QyxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ2hELE1BQU0sRUFBRSxDQUFDO1lBQ1QsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTTtpQkFDbEM7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLGFBQWE7b0JBQ25CLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtpQkFDL0M7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFlBQVk7b0JBQ2xCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLGdCQUFnQjtpQkFDNUM7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILGdEQUFnRDtRQUNoRCxHQUFHLENBQUMsa0JBQWtCLENBQUMsa0JBQWtCLEVBQUU7WUFDekMsT0FBTyxF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QWdCLEVBQUUscUJBQXFCLENBQUMsU0FBUztnQkFDakQsZUFBZSxFQUFFLG9CQUFvQixDQUFDLFNBQVM7YUFDaEQsQ0FBQztZQUNGLFdBQVcsRUFBRSxzQkFBc0I7WUFDbkMsVUFBVSxFQUFFLDBCQUEwQjtTQUN2QyxDQUFDLENBQUM7UUFFSCxpREFBaUQ7UUFDakQsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMzQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDcEIsS0FBSyxFQUFFLFVBQVUsQ0FBQyxRQUFRO2dCQUMxQixTQUFTLEVBQUUsY0FBYyxDQUFDLFFBQVE7Z0JBQ2xDLFFBQVEsRUFBRSxhQUFhLENBQUMsUUFBUTtnQkFDaEMsUUFBUSxFQUFFLGFBQWEsQ0FBQyxRQUFRO2dCQUNoQyxXQUFXLEVBQUUsZ0JBQWdCLENBQUMsUUFBUTtnQkFDdEMsZ0JBQWdCLEVBQUUscUJBQXFCLENBQUMsUUFBUTtnQkFDaEQsZUFBZSxFQUFFLG9CQUFvQixDQUFDLFFBQVE7YUFDL0MsQ0FBQztZQUNGLFdBQVcsRUFBRSxxQkFBcUI7WUFDbEMsVUFBVSxFQUFFLHlCQUF5QjtTQUN0QyxDQUFDLENBQUM7UUFFSCx1Q0FBdUM7UUFDdkMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLFVBQVUsVUFBVSxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsRUFBRTtZQUM5RCxXQUFXLEVBQUUseUJBQXlCO1NBQ3ZDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWhZRCxnREFnWUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBlbGFzdGljYWNoZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2FjaGUnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWNzUGF0dGVybnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcy1wYXR0ZXJucyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGNsYXNzIERpc3BhdGNoQWdlbnRTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIENyZWF0ZSBWUEMgZm9yIFJlZGlzLCBFQ1MgYW5kIExhbWJkYVxuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdEaXNwYXRjaEFnZW50VnBjJywge1xuICAgICAgbWF4QXpzOiAzLFxuICAgICAgbmF0R2F0ZXdheXM6IDEsXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ1B1YmxpYycsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdQcml2YXRlLUFwcCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNixcbiAgICAgICAgICBuYW1lOiAnUHJpdmF0ZS1EQicsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgVlBDIEdhdGV3YXkgRW5kcG9pbnRzIGZvciBEeW5hbW9EQiBhbmQgUzNcbiAgICB2cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdEeW5hbW9EQkVuZHBvaW50Jywge1xuICAgICAgc2VydmljZTogZWMyLkdhdGV3YXlWcGNFbmRwb2ludEF3c1NlcnZpY2UuRFlOQU1PREIsXG4gICAgICBzdWJuZXRzOiBbeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH1dLFxuICAgIH0pO1xuXG4gICAgdnBjLmFkZEdhdGV3YXlFbmRwb2ludCgnUzNFbmRwb2ludCcsIHtcbiAgICAgIHNlcnZpY2U6IGVjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLlMzLFxuICAgICAgc3VibmV0czogW3sgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9XSxcbiAgICB9KTtcblxuICAgIC8vIFNlY3VyaXR5IGdyb3VwIGZvciBSZWRpc1xuICAgIGNvbnN0IHJlZGlzU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnUmVkaXNTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgUmVkaXMgRWxhc3RpQ2FjaGUnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXG4gICAgfSk7XG5cbiAgICAvLyBTZWN1cml0eSBncm91cCBmb3IgYXBwbGljYXRpb25zIChFQ1MsIExhbWJkYSlcbiAgICBjb25zdCBhcHBTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdBcHBTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgYXBwbGljYXRpb25zIChFQ1MgdGFza3MsIExhbWJkYSBmdW5jdGlvbnMpJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBBbGxvdyBhcHBsaWNhdGlvbnMgdG8gY29ubmVjdCB0byBSZWRpc1xuICAgIHJlZGlzU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGFwcFNlY3VyaXR5R3JvdXAsXG4gICAgICBlYzIuUG9ydC50Y3AoNjM3OSksXG4gICAgICAnQWxsb3cgYXBwbGljYXRpb25zIHRvIGNvbm5lY3QgdG8gUmVkaXMnXG4gICAgKTtcblxuICAgIC8vIFJlZGlzIFN1Ym5ldCBHcm91cCAodXNlIGlzb2xhdGVkIHN1Ym5ldHMgZm9yIGRhdGFiYXNlIGxheWVyKVxuICAgIGNvbnN0IHJlZGlzU3VibmV0R3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuU3VibmV0R3JvdXAodGhpcywgJ1JlZGlzU3VibmV0R3JvdXAnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1N1Ym5ldCBncm91cCBmb3IgUmVkaXMnLFxuICAgICAgc3VibmV0SWRzOiB2cGMuaXNvbGF0ZWRTdWJuZXRzLm1hcChzdWJuZXQgPT4gc3VibmV0LnN1Ym5ldElkKSxcbiAgICB9KTtcblxuICAgIC8vIFJlZGlzIEVsYXN0aUNhY2hlIENsdXN0ZXJcbiAgICBjb25zdCByZWRpc0NsdXN0ZXIgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuUmVwbGljYXRpb25Hcm91cCh0aGlzLCAnUmVkaXNDbHVzdGVyJywge1xuICAgICAgcmVwbGljYXRpb25Hcm91cERlc2NyaXB0aW9uOiAnUmVkaXMgY2x1c3RlciBmb3Igc2Vzc2lvbiBzdG9yYWdlJyxcbiAgICAgIHJlcGxpY2F0aW9uR3JvdXBJZDogJ2Rpc3BhdGNoLWFnZW50LXJlZGlzJyxcbiAgICAgIG51bUNhY2hlQ2x1c3RlcnM6IDEsXG4gICAgICBjYWNoZU5vZGVUeXBlOiAnY2FjaGUudDMubWljcm8nLFxuICAgICAgZW5naW5lOiAncmVkaXMnLFxuICAgICAgZW5naW5lVmVyc2lvbjogJzcuMCcsXG4gICAgICBwb3J0OiA2Mzc5LFxuICAgICAgY2FjaGVTdWJuZXRHcm91cE5hbWU6IHJlZGlzU3VibmV0R3JvdXAucmVmLFxuICAgICAgc2VjdXJpdHlHcm91cElkczogW3JlZGlzU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRdLFxuICAgICAgYXRSZXN0RW5jcnlwdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgICB0cmFuc2l0RW5jcnlwdGlvbkVuYWJsZWQ6IGZhbHNlLCAvLyBTaW1wbGlmeSBmb3Igbm93XG4gICAgICBhdXRvbWF0aWNGYWlsb3ZlckVuYWJsZWQ6IGZhbHNlLCAvLyBTaW5nbGUgbm9kZSBjbHVzdGVyXG4gICAgfSk7XG5cbiAgICByZWRpc0NsdXN0ZXIuYWRkRGVwZW5kZW5jeShyZWRpc1N1Ym5ldEdyb3VwKTtcblxuICAgIC8vIER5bmFtb0RCIFRhYmxlc1xuICAgIGNvbnN0IHVzZXJzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1VzZXJzVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdEaXNwYXRjaEFnZW50LVVzZXJzJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnX2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBGb3IgZGV2ZWxvcG1lbnRcbiAgICB9KTtcblxuICAgIHVzZXJzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnVHdpbGlvUGhvbmVOdW1iZXJJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3R3aWxpb1Bob25lTnVtYmVyJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbXBhbmllc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb21wYW5pZXNUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0Rpc3BhdGNoQWdlbnQtQ29tcGFuaWVzJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnX2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgY29tcGFuaWVzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnVXNlcklkSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1c2VyJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHNlcnZpY2VzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1NlcnZpY2VzVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdEaXNwYXRjaEFnZW50LVNlcnZpY2VzJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnX2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgc2VydmljZXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdVc2VySWRJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBjYWxsTG9nc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDYWxsTG9nc1RhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiAnRGlzcGF0Y2hBZ2VudC1DYWxsTG9ncycsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ19pZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIGNhbGxMb2dzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnQ2FsbFNpZEluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY2FsbFNpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgfSk7XG5cbiAgICBjYWxsTG9nc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ1VzZXJJZEluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHRyYW5zY3JpcHRzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyYW5zY3JpcHRzVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdEaXNwYXRjaEFnZW50LVRyYW5zY3JpcHRzJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnX2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgdHJhbnNjcmlwdHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdDYWxsU2lkSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdjYWxsU2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHRyYW5zY3JpcHRDaHVua3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVHJhbnNjcmlwdENodW5rc1RhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiAnRGlzcGF0Y2hBZ2VudC1UcmFuc2NyaXB0Q2h1bmtzJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnX2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgdHJhbnNjcmlwdENodW5rc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ1RyYW5zY3JpcHRJZEluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndHJhbnNjcmlwdElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHNlcnZpY2VCb29raW5nc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdTZXJ2aWNlQm9va2luZ3NUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0Rpc3BhdGNoQWdlbnQtU2VydmljZUJvb2tpbmdzJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnX2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgc2VydmljZUJvb2tpbmdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnQ2FsbFNpZEluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY2FsbFNpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgfSk7XG5cbiAgICBzZXJ2aWNlQm9va2luZ3NUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdVc2VySWRJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgfSk7XG5cbiAgICAvLyBTMyBCdWNrZXQgZm9yIGZpbGUgc3RvcmFnZVxuICAgIGNvbnN0IHN0b3JhZ2VCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdTdG9yYWdlQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGRpc3BhdGNoLWFnZW50LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBGb3IgZGV2ZWxvcG1lbnRcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F1ZGlvUmVjb3JkaW5ncycsXG4gICAgICAgICAgcHJlZml4OiAncmVjb3JkaW5ncy8nLFxuICAgICAgICAgIHRyYW5zaXRpb25zOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLklORlJFUVVFTlRfQUNDRVNTLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEVDUyBDbHVzdGVyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnTWNwU2Vzc2lvbkNsdXN0ZXInLCB7XG4gICAgICB2cGMsXG4gICAgfSk7XG5cbiAgICAvLyBFQ1MgVGFzayBEZWZpbml0aW9uIGZvciBNQ1AgU2Vzc2lvbiBTZXJ2ZXJcbiAgICBjb25zdCBtY3BUYXNrRGVmaW5pdGlvbiA9IG5ldyBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uKHRoaXMsICdNY3BTZXNzaW9uVGFza0RlZicsIHtcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXG4gICAgICBjcHU6IDI1NixcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb250YWluZXIgdG8gdGFzayBkZWZpbml0aW9uXG4gICAgY29uc3QgbWNwQ29udGFpbmVyID0gbWNwVGFza0RlZmluaXRpb24uYWRkQ29udGFpbmVyKCdNY3BTZXNzaW9uQ29udGFpbmVyJywge1xuICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL21jcC9zZXNzaW9uJykpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcbiAgICAgICAgUE9SVDogJzMwMDAnLFxuICAgICAgICBSRURJU19IT1NUOiByZWRpc0NsdXN0ZXIuYXR0clByaW1hcnlFbmRQb2ludEFkZHJlc3MsXG4gICAgICAgIFJFRElTX1BPUlQ6ICc2Mzc5JyxcbiAgICAgIH0sXG4gICAgICBsb2dnaW5nOiBlY3MuTG9nRHJpdmVycy5hd3NMb2dzKHtcbiAgICAgICAgc3RyZWFtUHJlZml4OiAnbWNwLXNlc3Npb24nLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBtY3BDb250YWluZXIuYWRkUG9ydE1hcHBpbmdzKHtcbiAgICAgIGNvbnRhaW5lclBvcnQ6IDMwMDAsXG4gICAgICBwcm90b2NvbDogZWNzLlByb3RvY29sLlRDUCxcbiAgICB9KTtcblxuICAgIC8vIEVDUyBTZXJ2aWNlIHdpdGggQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlclxuICAgIGNvbnN0IG1jcFNlcnZpY2UgPSBuZXcgZWNzUGF0dGVybnMuQXBwbGljYXRpb25Mb2FkQmFsYW5jZWRGYXJnYXRlU2VydmljZSh0aGlzLCAnTWNwU2Vzc2lvblNlcnZpY2UnLCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgdGFza0RlZmluaXRpb246IG1jcFRhc2tEZWZpbml0aW9uLFxuICAgICAgcHVibGljTG9hZEJhbGFuY2VyOiBmYWxzZSwgLy8gSW50ZXJuYWwgbG9hZCBiYWxhbmNlclxuICAgICAgbGlzdGVuZXJQb3J0OiA4MCxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbYXBwU2VjdXJpdHlHcm91cF0sXG4gICAgICBkZXNpcmVkQ291bnQ6IDEsXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgZnVuY3Rpb25cbiAgICBjb25zdCBhc3Npc3RMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBc3Npc3RMYW1iZGEnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYWdlbnQvZGlzdCcpKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbYXBwU2VjdXJpdHlHcm91cF0sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICBNQ1BfU0VTU0lPTl9VUkw6IGBodHRwOi8vJHttY3BTZXJ2aWNlLmxvYWRCYWxhbmNlci5sb2FkQmFsYW5jZXJEbnNOYW1lfWAsXG4gICAgICAgIFJFRElTX0hPU1Q6IHJlZGlzQ2x1c3Rlci5hdHRyUHJpbWFyeUVuZFBvaW50QWRkcmVzcyxcbiAgICAgICAgUkVESVNfUE9SVDogJzYzNzknLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnRGlzcGF0Y2hBZ2VudEFwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiAnRGlzcGF0Y2ggQWdlbnQgQVBJJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGZvciBEaXNwYXRjaCBBZ2VudCBzZXJ2aWNlJyxcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUyxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnQXV0aG9yaXphdGlvbiddLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSAvdjEgcmVzb3VyY2VcbiAgICBjb25zdCB2MVJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3YxJyk7XG5cbiAgICAvLyBDcmVhdGUgL3YxL2Fzc2lzdCByZXNvdXJjZVxuICAgIGNvbnN0IGFzc2lzdFJlc291cmNlID0gdjFSZXNvdXJjZS5hZGRSZXNvdXJjZSgnYXNzaXN0Jyk7XG5cbiAgICAvLyBBZGQgUE9TVCBtZXRob2QgdG8gL3YxL2Fzc2lzdFxuICAgIGFzc2lzdFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGFzc2lzdExhbWJkYSksIHtcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6IHRydWUsXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzQwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnNTAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXQgdGhlIEFQSSBVUkxcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywge1xuICAgICAgdmFsdWU6IGFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IFVSTCcsXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXQgdGhlIExhbWJkYSBmdW5jdGlvbiBuYW1lXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xhbWJkYUZ1bmN0aW9uTmFtZScsIHtcbiAgICAgIHZhbHVlOiBhc3Npc3RMYW1iZGEuZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZnVuY3Rpb24gbmFtZScsXG4gICAgfSk7XG5cbiAgICAvLyBFeHBvcnQgVlBDIGFuZCBuZXR3b3JraW5nIHJlc291cmNlcyBmb3Igb3RoZXIgc3RhY2tzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZwY0lkJywge1xuICAgICAgdmFsdWU6IHZwYy52cGNJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVlBDIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdEaXNwYXRjaEFnZW50LVZwY0lkJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQcml2YXRlU3VibmV0SWRzJywge1xuICAgICAgdmFsdWU6IGNkay5Gbi5qb2luKCcsJywgdnBjLnByaXZhdGVTdWJuZXRzLm1hcChzdWJuZXQgPT4gc3VibmV0LnN1Ym5ldElkKSksXG4gICAgICBkZXNjcmlwdGlvbjogJ1ByaXZhdGUgc3VibmV0IElEcycsXG4gICAgICBleHBvcnROYW1lOiAnRGlzcGF0Y2hBZ2VudC1Qcml2YXRlU3VibmV0SWRzJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcHBTZWN1cml0eUdyb3VwSWQnLCB7XG4gICAgICB2YWx1ZTogYXBwU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcGxpY2F0aW9uIHNlY3VyaXR5IGdyb3VwIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdEaXNwYXRjaEFnZW50LUFwcFNlY3VyaXR5R3JvdXBJZCcsXG4gICAgfSk7XG5cbiAgICAvLyBFeHBvcnQgUmVkaXMgZW5kcG9pbnRcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiByZWRpc0NsdXN0ZXIuYXR0clByaW1hcnlFbmRQb2ludEFkZHJlc3MsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JlZGlzIEVsYXN0aUNhY2hlIGVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6ICdEaXNwYXRjaEFnZW50LVJlZGlzRW5kcG9pbnQnLFxuICAgIH0pO1xuXG4gICAgLy8gRXhwb3J0IFMzIGJ1Y2tldCBuYW1lXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1MzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiBzdG9yYWdlQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIHN0b3JhZ2UgYnVja2V0IG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtUzNCdWNrZXROYW1lJyxcbiAgICB9KTtcblxuICAgIC8vIEV4cG9ydCBEeW5hbW9EQiB0YWJsZSBuYW1lc1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEeW5hbW9EQlRhYmxlTmFtZXMnLCB7XG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB1c2VyczogdXNlcnNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIGNvbXBhbmllczogY29tcGFuaWVzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBzZXJ2aWNlczogc2VydmljZXNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIGNhbGxMb2dzOiBjYWxsTG9nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgdHJhbnNjcmlwdHM6IHRyYW5zY3JpcHRzVGFibGUudGFibGVOYW1lLFxuICAgICAgICB0cmFuc2NyaXB0Q2h1bmtzOiB0cmFuc2NyaXB0Q2h1bmtzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBzZXJ2aWNlQm9va2luZ3M6IHNlcnZpY2VCb29raW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiB0YWJsZSBuYW1lcycsXG4gICAgICBleHBvcnROYW1lOiAnRGlzcGF0Y2hBZ2VudC1UYWJsZU5hbWVzJyxcbiAgICB9KTtcblxuICAgIC8vIEV4cG9ydCBEeW5hbW9EQiB0YWJsZSBBUk5zIGZvciBJQU0gcGVybWlzc2lvbnNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vREJUYWJsZUFybnMnLCB7XG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB1c2VyczogdXNlcnNUYWJsZS50YWJsZUFybixcbiAgICAgICAgY29tcGFuaWVzOiBjb21wYW5pZXNUYWJsZS50YWJsZUFybixcbiAgICAgICAgc2VydmljZXM6IHNlcnZpY2VzVGFibGUudGFibGVBcm4sXG4gICAgICAgIGNhbGxMb2dzOiBjYWxsTG9nc1RhYmxlLnRhYmxlQXJuLFxuICAgICAgICB0cmFuc2NyaXB0czogdHJhbnNjcmlwdHNUYWJsZS50YWJsZUFybixcbiAgICAgICAgdHJhbnNjcmlwdENodW5rczogdHJhbnNjcmlwdENodW5rc1RhYmxlLnRhYmxlQXJuLFxuICAgICAgICBzZXJ2aWNlQm9va2luZ3M6IHNlcnZpY2VCb29raW5nc1RhYmxlLnRhYmxlQXJuLFxuICAgICAgfSksXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIHRhYmxlIEFSTnMnLFxuICAgICAgZXhwb3J0TmFtZTogJ0Rpc3BhdGNoQWdlbnQtVGFibGVBcm5zJyxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCBNQ1AgU2VydmljZSBMb2FkIEJhbGFuY2VyIEROU1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNY3BTZXJ2aWNlVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwOi8vJHttY3BTZXJ2aWNlLmxvYWRCYWxhbmNlci5sb2FkQmFsYW5jZXJEbnNOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ01DUCBTZXNzaW9uIFNlcnZpY2UgVVJMJyxcbiAgICB9KTtcbiAgfVxufSJdfQ==