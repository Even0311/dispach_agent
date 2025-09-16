import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';
import * as path from 'path';

export class DispatchAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC for Redis and ECS
    const vpc = new ec2.Vpc(this, 'DispatchAgentVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Security group for Redis
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security group for Redis ElastiCache',
      allowAllOutbound: false,
    });

    // Security group for ECS tasks (MCP Server)
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Security group for ECS tasks',
      allowAllOutbound: true,
    });

    // Allow ECS to connect to Redis
    redisSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow ECS tasks to connect to Redis'
    );

    // Redis Subnet Group
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
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
      securityGroups: [ecsSecurityGroup],
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
      securityGroups: [ecsSecurityGroup],
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

    // Output Redis endpoint
    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redisCluster.attrPrimaryEndPointAddress,
      description: 'Redis ElastiCache endpoint',
    });

    // Output MCP Service Load Balancer DNS
    new cdk.CfnOutput(this, 'McpServiceUrl', {
      value: `http://${mcpService.loadBalancer.loadBalancerDnsName}`,
      description: 'MCP Session Service URL',
    });
  }
}