import * as cdk from 'aws-cdk-lib';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class MinimalInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
    redisSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Lambda functions to connect to Redis'
    );

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