"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinimalInfraStack = void 0;
const cdk = require("aws-cdk-lib");
const elasticache = require("aws-cdk-lib/aws-elasticache");
const ec2 = require("aws-cdk-lib/aws-ec2");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const s3 = require("aws-cdk-lib/aws-s3");
class MinimalInfraStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create VPC for Lambda functions and Redis
        const vpc = new ec2.Vpc(this, 'MinimalVpc', {
            maxAzs: 2, // Reduce to 2 AZ for cost optimization
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
        // Add VPC Gateway Endpoints for cost optimization
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
        // Security group for Lambda functions
        const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
            vpc,
            description: 'Security group for Lambda functions',
            allowAllOutbound: true,
        });
        // Allow Lambda to connect to Redis
        redisSecurityGroup.addIngressRule(lambdaSecurityGroup, ec2.Port.tcp(6379), 'Allow Lambda functions to connect to Redis');
        // Redis Subnet Group (use isolated subnets for database layer)
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            description: 'Subnet group for Redis',
            subnetIds: vpc.isolatedSubnets.map(subnet => subnet.subnetId),
        });
        // Redis ElastiCache Cluster (minimal configuration)
        const redisCluster = new elasticache.CfnReplicationGroup(this, 'RedisCluster', {
            replicationGroupDescription: 'Redis cluster for telephony sessions',
            replicationGroupId: 'telephony-redis',
            numCacheClusters: 1,
            cacheNodeType: 'cache.t3.micro', // Smallest instance for development
            engine: 'redis',
            engineVersion: '7.0',
            port: 6379,
            cacheSubnetGroupName: redisSubnetGroup.ref,
            securityGroupIds: [redisSecurityGroup.securityGroupId],
            atRestEncryptionEnabled: true,
            transitEncryptionEnabled: false, // Simplify for VPC internal access
            automaticFailoverEnabled: false, // Single node cluster
        });
        redisCluster.addDependency(redisSubnetGroup);
        // DynamoDB Tables - exactly what your telephony lambdas need
        const usersTable = new dynamodb.Table(this, 'UsersTable', {
            tableName: 'Telephony-Users',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
        });
        usersTable.addGlobalSecondaryIndex({
            indexName: 'TwilioPhoneNumberIndex',
            partitionKey: { name: 'twilioPhoneNumber', type: dynamodb.AttributeType.STRING },
        });
        const companiesTable = new dynamodb.Table(this, 'CompaniesTable', {
            tableName: 'Telephony-Companies',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        companiesTable.addGlobalSecondaryIndex({
            indexName: 'UserIdIndex',
            partitionKey: { name: 'user', type: dynamodb.AttributeType.STRING },
        });
        const servicesTable = new dynamodb.Table(this, 'ServicesTable', {
            tableName: 'Telephony-Services',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        servicesTable.addGlobalSecondaryIndex({
            indexName: 'UserIdIndex',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
        });
        const callLogsTable = new dynamodb.Table(this, 'CallLogsTable', {
            tableName: 'Telephony-CallLogs',
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
            tableName: 'Telephony-Transcripts',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        transcriptsTable.addGlobalSecondaryIndex({
            indexName: 'CallSidIndex',
            partitionKey: { name: 'callSid', type: dynamodb.AttributeType.STRING },
        });
        const transcriptChunksTable = new dynamodb.Table(this, 'TranscriptChunksTable', {
            tableName: 'Telephony-TranscriptChunks',
            partitionKey: { name: '_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        transcriptChunksTable.addGlobalSecondaryIndex({
            indexName: 'TranscriptIdIndex',
            partitionKey: { name: 'transcriptId', type: dynamodb.AttributeType.STRING },
        });
        const serviceBookingsTable = new dynamodb.Table(this, 'ServiceBookingsTable', {
            tableName: 'Telephony-ServiceBookings',
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
        // S3 Bucket for call recordings and data
        const storageBucket = new s3.Bucket(this, 'TelephonyBucket', {
            bucketName: `telephony-storage-${this.account}-${this.region}`,
            versioned: false, // Simplify for development
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
            lifecycleRules: [
                {
                    id: 'CallRecordings',
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
        // Export resources for Lambda stack to import
        new cdk.CfnOutput(this, 'VpcId', {
            value: vpc.vpcId,
            description: 'VPC ID for Lambda functions',
            exportName: 'Telephony-VpcId',
        });
        new cdk.CfnOutput(this, 'PrivateSubnetIds', {
            value: cdk.Fn.join(',', vpc.privateSubnets.map(subnet => subnet.subnetId)),
            description: 'Private subnet IDs for Lambda functions',
            exportName: 'Telephony-PrivateSubnetIds',
        });
        new cdk.CfnOutput(this, 'LambdaSecurityGroupId', {
            value: lambdaSecurityGroup.securityGroupId,
            description: 'Security group ID for Lambda functions',
            exportName: 'Telephony-LambdaSecurityGroupId',
        });
        new cdk.CfnOutput(this, 'RedisEndpoint', {
            value: redisCluster.attrPrimaryEndPointAddress,
            description: 'Redis ElastiCache endpoint',
            exportName: 'Telephony-RedisEndpoint',
        });
        new cdk.CfnOutput(this, 'S3BucketName', {
            value: storageBucket.bucketName,
            description: 'S3 storage bucket name',
            exportName: 'Telephony-S3BucketName',
        });
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
            exportName: 'Telephony-TableNames',
        });
    }
}
exports.MinimalInfraStack = MinimalInfraStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWluaW1hbC1pbmZyYS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1pbmltYWwtaW5mcmEtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDJEQUEyRDtBQUMzRCwyQ0FBMkM7QUFDM0MscURBQXFEO0FBQ3JELHlDQUF5QztBQUd6QyxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsNENBQTRDO1FBQzVDLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQzFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsdUNBQXVDO1lBQ2xELFdBQVcsRUFBRSxDQUFDO1lBQ2QsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07aUJBQ2xDO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxhQUFhO29CQUNuQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUI7aUJBQy9DO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxZQUFZO29CQUNsQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0I7aUJBQzVDO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxrREFBa0Q7UUFDbEQsR0FBRyxDQUFDLGtCQUFrQixDQUFDLGtCQUFrQixFQUFFO1lBQ3pDLE9BQU8sRUFBRSxHQUFHLENBQUMsNEJBQTRCLENBQUMsUUFBUTtZQUNsRCxPQUFPLEVBQUUsQ0FBQyxFQUFF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Z0JBQWdCLENBQUMsU0FBUztnQkFDdkMsZ0JBQWdCLEVBQUUscUJBQXFCLENBQUMsU0FBUztnQkFDakQsZUFBZSxFQUFFLG9CQUFvQixDQUFDLFNBQVM7YUFDaEQsQ0FBQztZQUNGLFdBQVcsRUFBRSxzQkFBc0I7WUFDbkMsVUFBVSxFQUFFLHNCQUFzQjtTQUNuQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF4UEQsOENBd1BDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0ICogYXMgZWxhc3RpY2FjaGUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNhY2hlJztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuXHJcbmV4cG9ydCBjbGFzcyBNaW5pbWFsSW5mcmFTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIFZQQyBmb3IgTGFtYmRhIGZ1bmN0aW9ucyBhbmQgUmVkaXNcclxuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdNaW5pbWFsVnBjJywge1xyXG4gICAgICBtYXhBenM6IDIsIC8vIFJlZHVjZSB0byAyIEFaIGZvciBjb3N0IG9wdGltaXphdGlvblxyXG4gICAgICBuYXRHYXRld2F5czogMSxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICAgIG5hbWU6ICdQdWJsaWMnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgICAgbmFtZTogJ1ByaXZhdGUtQXBwJyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBjaWRyTWFzazogMjYsXHJcbiAgICAgICAgICBuYW1lOiAnUHJpdmF0ZS1EQicsXHJcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgVlBDIEdhdGV3YXkgRW5kcG9pbnRzIGZvciBjb3N0IG9wdGltaXphdGlvblxyXG4gICAgdnBjLmFkZEdhdGV3YXlFbmRwb2ludCgnRHluYW1vREJFbmRwb2ludCcsIHtcclxuICAgICAgc2VydmljZTogZWMyLkdhdGV3YXlWcGNFbmRwb2ludEF3c1NlcnZpY2UuRFlOQU1PREIsXHJcbiAgICAgIHN1Ym5ldHM6IFt7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICB2cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdTM0VuZHBvaW50Jywge1xyXG4gICAgICBzZXJ2aWNlOiBlYzIuR2F0ZXdheVZwY0VuZHBvaW50QXdzU2VydmljZS5TMyxcclxuICAgICAgc3VibmV0czogW3sgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9XSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNlY3VyaXR5IGdyb3VwIGZvciBSZWRpc1xyXG4gICAgY29uc3QgcmVkaXNTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdSZWRpc1NlY3VyaXR5R3JvdXAnLCB7XHJcbiAgICAgIHZwYyxcclxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgUmVkaXMgRWxhc3RpQ2FjaGUnLFxyXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNlY3VyaXR5IGdyb3VwIGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBjb25zdCBsYW1iZGFTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdMYW1iZGFTZWN1cml0eUdyb3VwJywge1xyXG4gICAgICB2cGMsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIExhbWJkYSBmdW5jdGlvbnMnLFxyXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWxsb3cgTGFtYmRhIHRvIGNvbm5lY3QgdG8gUmVkaXNcclxuICAgIHJlZGlzU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcclxuICAgICAgbGFtYmRhU2VjdXJpdHlHcm91cCxcclxuICAgICAgZWMyLlBvcnQudGNwKDYzNzkpLFxyXG4gICAgICAnQWxsb3cgTGFtYmRhIGZ1bmN0aW9ucyB0byBjb25uZWN0IHRvIFJlZGlzJ1xyXG4gICAgKTtcclxuXHJcbiAgICAvLyBSZWRpcyBTdWJuZXQgR3JvdXAgKHVzZSBpc29sYXRlZCBzdWJuZXRzIGZvciBkYXRhYmFzZSBsYXllcilcclxuICAgIGNvbnN0IHJlZGlzU3VibmV0R3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuU3VibmV0R3JvdXAodGhpcywgJ1JlZGlzU3VibmV0R3JvdXAnLCB7XHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3VibmV0IGdyb3VwIGZvciBSZWRpcycsXHJcbiAgICAgIHN1Ym5ldElkczogdnBjLmlzb2xhdGVkU3VibmV0cy5tYXAoc3VibmV0ID0+IHN1Ym5ldC5zdWJuZXRJZCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSZWRpcyBFbGFzdGlDYWNoZSBDbHVzdGVyIChtaW5pbWFsIGNvbmZpZ3VyYXRpb24pXHJcbiAgICBjb25zdCByZWRpc0NsdXN0ZXIgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuUmVwbGljYXRpb25Hcm91cCh0aGlzLCAnUmVkaXNDbHVzdGVyJywge1xyXG4gICAgICByZXBsaWNhdGlvbkdyb3VwRGVzY3JpcHRpb246ICdSZWRpcyBjbHVzdGVyIGZvciB0ZWxlcGhvbnkgc2Vzc2lvbnMnLFxyXG4gICAgICByZXBsaWNhdGlvbkdyb3VwSWQ6ICd0ZWxlcGhvbnktcmVkaXMnLFxyXG4gICAgICBudW1DYWNoZUNsdXN0ZXJzOiAxLFxyXG4gICAgICBjYWNoZU5vZGVUeXBlOiAnY2FjaGUudDMubWljcm8nLCAvLyBTbWFsbGVzdCBpbnN0YW5jZSBmb3IgZGV2ZWxvcG1lbnRcclxuICAgICAgZW5naW5lOiAncmVkaXMnLFxyXG4gICAgICBlbmdpbmVWZXJzaW9uOiAnNy4wJyxcclxuICAgICAgcG9ydDogNjM3OSxcclxuICAgICAgY2FjaGVTdWJuZXRHcm91cE5hbWU6IHJlZGlzU3VibmV0R3JvdXAucmVmLFxyXG4gICAgICBzZWN1cml0eUdyb3VwSWRzOiBbcmVkaXNTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZF0sXHJcbiAgICAgIGF0UmVzdEVuY3J5cHRpb25FbmFibGVkOiB0cnVlLFxyXG4gICAgICB0cmFuc2l0RW5jcnlwdGlvbkVuYWJsZWQ6IGZhbHNlLCAvLyBTaW1wbGlmeSBmb3IgVlBDIGludGVybmFsIGFjY2Vzc1xyXG4gICAgICBhdXRvbWF0aWNGYWlsb3ZlckVuYWJsZWQ6IGZhbHNlLCAvLyBTaW5nbGUgbm9kZSBjbHVzdGVyXHJcbiAgICB9KTtcclxuXHJcbiAgICByZWRpc0NsdXN0ZXIuYWRkRGVwZW5kZW5jeShyZWRpc1N1Ym5ldEdyb3VwKTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZXMgLSBleGFjdGx5IHdoYXQgeW91ciB0ZWxlcGhvbnkgbGFtYmRhcyBuZWVkXHJcbiAgICBjb25zdCB1c2Vyc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdVc2Vyc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUZWxlcGhvbnktVXNlcnMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ19pZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIEZvciBkZXZlbG9wbWVudFxyXG4gICAgfSk7XHJcblxyXG4gICAgdXNlcnNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1R3aWxpb1Bob25lTnVtYmVySW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3R3aWxpb1Bob25lTnVtYmVyJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbXBhbmllc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb21wYW5pZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVGVsZXBob255LUNvbXBhbmllcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnX2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbXBhbmllc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVXNlcklkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXInLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgc2VydmljZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnU2VydmljZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVGVsZXBob255LVNlcnZpY2VzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgc2VydmljZXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1VzZXJJZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1c2VySWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2FsbExvZ3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ2FsbExvZ3NUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVGVsZXBob255LUNhbGxMb2dzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY2FsbExvZ3NUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0NhbGxTaWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY2FsbFNpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjYWxsTG9nc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVXNlcklkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB0cmFuc2NyaXB0c1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmFuc2NyaXB0c1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUZWxlcGhvbnktVHJhbnNjcmlwdHMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ19pZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICB0cmFuc2NyaXB0c1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQ2FsbFNpZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdjYWxsU2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHRyYW5zY3JpcHRDaHVua3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVHJhbnNjcmlwdENodW5rc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUZWxlcGhvbnktVHJhbnNjcmlwdENodW5rcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnX2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIHRyYW5zY3JpcHRDaHVua3NUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1RyYW5zY3JpcHRJZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd0cmFuc2NyaXB0SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgc2VydmljZUJvb2tpbmdzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1NlcnZpY2VCb29raW5nc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUZWxlcGhvbnktU2VydmljZUJvb2tpbmdzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgc2VydmljZUJvb2tpbmdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdDYWxsU2lkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NhbGxTaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgc2VydmljZUJvb2tpbmdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdVc2VySWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFMzIEJ1Y2tldCBmb3IgY2FsbCByZWNvcmRpbmdzIGFuZCBkYXRhXHJcbiAgICBjb25zdCBzdG9yYWdlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnVGVsZXBob255QnVja2V0Jywge1xyXG4gICAgICBidWNrZXROYW1lOiBgdGVsZXBob255LXN0b3JhZ2UtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcclxuICAgICAgdmVyc2lvbmVkOiBmYWxzZSwgLy8gU2ltcGxpZnkgZm9yIGRldmVsb3BtZW50XHJcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8gRm9yIGRldmVsb3BtZW50XHJcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgaWQ6ICdDYWxsUmVjb3JkaW5ncycsXHJcbiAgICAgICAgICBwcmVmaXg6ICdyZWNvcmRpbmdzLycsXHJcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuSU5GUkVRVUVOVF9BQ0NFU1MsXHJcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygzMCksXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxyXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRXhwb3J0IHJlc291cmNlcyBmb3IgTGFtYmRhIHN0YWNrIHRvIGltcG9ydFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZwY0lkJywge1xyXG4gICAgICB2YWx1ZTogdnBjLnZwY0lkLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZQQyBJRCBmb3IgTGFtYmRhIGZ1bmN0aW9ucycsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUZWxlcGhvbnktVnBjSWQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ByaXZhdGVTdWJuZXRJZHMnLCB7XHJcbiAgICAgIHZhbHVlOiBjZGsuRm4uam9pbignLCcsIHZwYy5wcml2YXRlU3VibmV0cy5tYXAoc3VibmV0ID0+IHN1Ym5ldC5zdWJuZXRJZCkpLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1ByaXZhdGUgc3VibmV0IElEcyBmb3IgTGFtYmRhIGZ1bmN0aW9ucycsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUZWxlcGhvbnktUHJpdmF0ZVN1Ym5ldElkcycsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGFtYmRhU2VjdXJpdHlHcm91cElkJywge1xyXG4gICAgICB2YWx1ZTogbGFtYmRhU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgSUQgZm9yIExhbWJkYSBmdW5jdGlvbnMnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVGVsZXBob255LUxhbWJkYVNlY3VyaXR5R3JvdXBJZCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNFbmRwb2ludCcsIHtcclxuICAgICAgdmFsdWU6IHJlZGlzQ2x1c3Rlci5hdHRyUHJpbWFyeUVuZFBvaW50QWRkcmVzcyxcclxuICAgICAgZGVzY3JpcHRpb246ICdSZWRpcyBFbGFzdGlDYWNoZSBlbmRwb2ludCcsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUZWxlcGhvbnktUmVkaXNFbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUzNCdWNrZXROYW1lJywge1xyXG4gICAgICB2YWx1ZTogc3RvcmFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIHN0b3JhZ2UgYnVja2V0IG5hbWUnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVGVsZXBob255LVMzQnVja2V0TmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vREJUYWJsZU5hbWVzJywge1xyXG4gICAgICB2YWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIHVzZXJzOiB1c2Vyc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBjb21wYW5pZXM6IGNvbXBhbmllc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBzZXJ2aWNlczogc2VydmljZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgY2FsbExvZ3M6IGNhbGxMb2dzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIHRyYW5zY3JpcHRzOiB0cmFuc2NyaXB0c1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICB0cmFuc2NyaXB0Q2h1bmtzOiB0cmFuc2NyaXB0Q2h1bmtzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIHNlcnZpY2VCb29raW5nczogc2VydmljZUJvb2tpbmdzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICB9KSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiB0YWJsZSBuYW1lcycsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUZWxlcGhvbnktVGFibGVOYW1lcycsXHJcbiAgICB9KTtcclxuICB9XHJcbn0iXX0=