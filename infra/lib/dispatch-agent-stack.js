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
const path = require("path");
class DispatchAgentStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        redisSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(6379), 'Allow ECS tasks to connect to Redis');
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
exports.DispatchAgentStack = DispatchAgentStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzcGF0Y2gtYWdlbnQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkaXNwYXRjaC1hZ2VudC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELHlEQUF5RDtBQUN6RCwyREFBMkQ7QUFDM0QsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw0REFBNEQ7QUFFNUQsNkJBQTZCO0FBRTdCLE1BQWEsa0JBQW1CLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDL0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QiwrQkFBK0I7UUFDL0IsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUNoRCxNQUFNLEVBQUUsQ0FBQztZQUNULFdBQVcsRUFBRSxDQUFDO1lBQ2QsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07aUJBQ2xDO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxTQUFTO29CQUNmLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtpQkFDL0M7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILDJCQUEyQjtRQUMzQixNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDM0UsR0FBRztZQUNILFdBQVcsRUFBRSxzQ0FBc0M7WUFDbkQsZ0JBQWdCLEVBQUUsS0FBSztTQUN4QixDQUFDLENBQUM7UUFFSCw0Q0FBNEM7UUFDNUMsTUFBTSxnQkFBZ0IsR0FBRyxJ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QVksQ0FBQywwQkFBMEI7WUFDOUMsV0FBVyxFQUFFLDRCQUE0QjtTQUMxQyxDQUFDLENBQUM7UUFFSCx1Q0FBdUM7UUFDdkMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLFVBQVUsVUFBVSxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsRUFBRTtZQUM5RCxXQUFXLEVBQUUseUJBQXlCO1NBQ3ZDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQS9MRCxnREErTEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBlbGFzdGljYWNoZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2FjaGUnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWNzUGF0dGVybnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcy1wYXR0ZXJucyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBjbGFzcyBEaXNwYXRjaEFnZW50U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDcmVhdGUgVlBDIGZvciBSZWRpcyBhbmQgRUNTXG4gICAgY29uc3QgdnBjID0gbmV3IGVjMi5WcGModGhpcywgJ0Rpc3BhdGNoQWdlbnRWcGMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBuYXRHYXRld2F5czogMSxcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAnUHVibGljJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ1ByaXZhdGUnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gU2VjdXJpdHkgZ3JvdXAgZm9yIFJlZGlzXG4gICAgY29uc3QgcmVkaXNTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdSZWRpc1NlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBSZWRpcyBFbGFzdGlDYWNoZScsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIC8vIFNlY3VyaXR5IGdyb3VwIGZvciBFQ1MgdGFza3MgKE1DUCBTZXJ2ZXIpXG4gICAgY29uc3QgZWNzU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnRWNzU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIEVDUyB0YXNrcycsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQWxsb3cgRUNTIHRvIGNvbm5lY3QgdG8gUmVkaXNcbiAgICByZWRpc1NlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlY3NTZWN1cml0eUdyb3VwLFxuICAgICAgZWMyLlBvcnQudGNwKDYzNzkpLFxuICAgICAgJ0FsbG93IEVDUyB0YXNrcyB0byBjb25uZWN0IHRvIFJlZGlzJ1xuICAgICk7XG5cbiAgICAvLyBSZWRpcyBTdWJuZXQgR3JvdXBcbiAgICBjb25zdCByZWRpc1N1Ym5ldEdyb3VwID0gbmV3IGVsYXN0aWNhY2hlLkNmblN1Ym5ldEdyb3VwKHRoaXMsICdSZWRpc1N1Ym5ldEdyb3VwJywge1xuICAgICAgZGVzY3JpcHRpb246ICdTdWJuZXQgZ3JvdXAgZm9yIFJlZGlzJyxcbiAgICAgIHN1Ym5ldElkczogdnBjLnByaXZhdGVTdWJuZXRzLm1hcChzdWJuZXQgPT4gc3VibmV0LnN1Ym5ldElkKSxcbiAgICB9KTtcblxuICAgIC8vIFJlZGlzIEVsYXN0aUNhY2hlIENsdXN0ZXJcbiAgICBjb25zdCByZWRpc0NsdXN0ZXIgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuUmVwbGljYXRpb25Hcm91cCh0aGlzLCAnUmVkaXNDbHVzdGVyJywge1xuICAgICAgcmVwbGljYXRpb25Hcm91cERlc2NyaXB0aW9uOiAnUmVkaXMgY2x1c3RlciBmb3Igc2Vzc2lvbiBzdG9yYWdlJyxcbiAgICAgIHJlcGxpY2F0aW9uR3JvdXBJZDogJ2Rpc3BhdGNoLWFnZW50LXJlZGlzJyxcbiAgICAgIG51bUNhY2hlQ2x1c3RlcnM6IDEsXG4gICAgICBjYWNoZU5vZGVUeXBlOiAnY2FjaGUudDMubWljcm8nLFxuICAgICAgZW5naW5lOiAncmVkaXMnLFxuICAgICAgZW5naW5lVmVyc2lvbjogJzcuMCcsXG4gICAgICBwb3J0OiA2Mzc5LFxuICAgICAgY2FjaGVTdWJuZXRHcm91cE5hbWU6IHJlZGlzU3VibmV0R3JvdXAucmVmLFxuICAgICAgc2VjdXJpdHlHcm91cElkczogW3JlZGlzU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRdLFxuICAgICAgYXRSZXN0RW5jcnlwdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgICB0cmFuc2l0RW5jcnlwdGlvbkVuYWJsZWQ6IGZhbHNlLCAvLyBTaW1wbGlmeSBmb3Igbm93XG4gICAgICBhdXRvbWF0aWNGYWlsb3ZlckVuYWJsZWQ6IGZhbHNlLCAvLyBTaW5nbGUgbm9kZSBjbHVzdGVyXG4gICAgfSk7XG5cbiAgICByZWRpc0NsdXN0ZXIuYWRkRGVwZW5kZW5jeShyZWRpc1N1Ym5ldEdyb3VwKTtcblxuICAgIC8vIEVDUyBDbHVzdGVyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnTWNwU2Vzc2lvbkNsdXN0ZXInLCB7XG4gICAgICB2cGMsXG4gICAgfSk7XG5cbiAgICAvLyBFQ1MgVGFzayBEZWZpbml0aW9uIGZvciBNQ1AgU2Vzc2lvbiBTZXJ2ZXJcbiAgICBjb25zdCBtY3BUYXNrRGVmaW5pdGlvbiA9IG5ldyBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uKHRoaXMsICdNY3BTZXNzaW9uVGFza0RlZicsIHtcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXG4gICAgICBjcHU6IDI1NixcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb250YWluZXIgdG8gdGFzayBkZWZpbml0aW9uXG4gICAgY29uc3QgbWNwQ29udGFpbmVyID0gbWNwVGFza0RlZmluaXRpb24uYWRkQ29udGFpbmVyKCdNY3BTZXNzaW9uQ29udGFpbmVyJywge1xuICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL21jcC9zZXNzaW9uJykpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcbiAgICAgICAgUE9SVDogJzMwMDAnLFxuICAgICAgICBSRURJU19IT1NUOiByZWRpc0NsdXN0ZXIuYXR0clByaW1hcnlFbmRQb2ludEFkZHJlc3MsXG4gICAgICAgIFJFRElTX1BPUlQ6ICc2Mzc5JyxcbiAgICAgIH0sXG4gICAgICBsb2dnaW5nOiBlY3MuTG9nRHJpdmVycy5hd3NMb2dzKHtcbiAgICAgICAgc3RyZWFtUHJlZml4OiAnbWNwLXNlc3Npb24nLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBtY3BDb250YWluZXIuYWRkUG9ydE1hcHBpbmdzKHtcbiAgICAgIGNvbnRhaW5lclBvcnQ6IDMwMDAsXG4gICAgICBwcm90b2NvbDogZWNzLlByb3RvY29sLlRDUCxcbiAgICB9KTtcblxuICAgIC8vIEVDUyBTZXJ2aWNlIHdpdGggQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlclxuICAgIGNvbnN0IG1jcFNlcnZpY2UgPSBuZXcgZWNzUGF0dGVybnMuQXBwbGljYXRpb25Mb2FkQmFsYW5jZWRGYXJnYXRlU2VydmljZSh0aGlzLCAnTWNwU2Vzc2lvblNlcnZpY2UnLCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgdGFza0RlZmluaXRpb246IG1jcFRhc2tEZWZpbml0aW9uLFxuICAgICAgcHVibGljTG9hZEJhbGFuY2VyOiBmYWxzZSwgLy8gSW50ZXJuYWwgbG9hZCBiYWxhbmNlclxuICAgICAgbGlzdGVuZXJQb3J0OiA4MCxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbZWNzU2VjdXJpdHlHcm91cF0sXG4gICAgICBkZXNpcmVkQ291bnQ6IDEsXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgZnVuY3Rpb25cbiAgICBjb25zdCBhc3Npc3RMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBc3Npc3RMYW1iZGEnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYWdlbnQvZGlzdCcpKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbZWNzU2VjdXJpdHlHcm91cF0sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICBNQ1BfU0VTU0lPTl9VUkw6IGBodHRwOi8vJHttY3BTZXJ2aWNlLmxvYWRCYWxhbmNlci5sb2FkQmFsYW5jZXJEbnNOYW1lfWAsXG4gICAgICAgIFJFRElTX0hPU1Q6IHJlZGlzQ2x1c3Rlci5hdHRyUHJpbWFyeUVuZFBvaW50QWRkcmVzcyxcbiAgICAgICAgUkVESVNfUE9SVDogJzYzNzknLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnRGlzcGF0Y2hBZ2VudEFwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiAnRGlzcGF0Y2ggQWdlbnQgQVBJJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGZvciBEaXNwYXRjaCBBZ2VudCBzZXJ2aWNlJyxcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUyxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnQXV0aG9yaXphdGlvbiddLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSAvdjEgcmVzb3VyY2VcbiAgICBjb25zdCB2MVJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3YxJyk7XG5cbiAgICAvLyBDcmVhdGUgL3YxL2Fzc2lzdCByZXNvdXJjZVxuICAgIGNvbnN0IGFzc2lzdFJlc291cmNlID0gdjFSZXNvdXJjZS5hZGRSZXNvdXJjZSgnYXNzaXN0Jyk7XG5cbiAgICAvLyBBZGQgUE9TVCBtZXRob2QgdG8gL3YxL2Fzc2lzdFxuICAgIGFzc2lzdFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGFzc2lzdExhbWJkYSksIHtcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6IHRydWUsXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzQwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnNTAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXQgdGhlIEFQSSBVUkxcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywge1xuICAgICAgdmFsdWU6IGFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IFVSTCcsXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXQgdGhlIExhbWJkYSBmdW5jdGlvbiBuYW1lXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xhbWJkYUZ1bmN0aW9uTmFtZScsIHtcbiAgICAgIHZhbHVlOiBhc3Npc3RMYW1iZGEuZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZnVuY3Rpb24gbmFtZScsXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXQgUmVkaXMgZW5kcG9pbnRcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiByZWRpc0NsdXN0ZXIuYXR0clByaW1hcnlFbmRQb2ludEFkZHJlc3MsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JlZGlzIEVsYXN0aUNhY2hlIGVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCBNQ1AgU2VydmljZSBMb2FkIEJhbGFuY2VyIEROU1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNY3BTZXJ2aWNlVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwOi8vJHttY3BTZXJ2aWNlLmxvYWRCYWxhbmNlci5sb2FkQmFsYW5jZXJEbnNOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ01DUCBTZXNzaW9uIFNlcnZpY2UgVVJMJyxcbiAgICB9KTtcbiAgfVxufSJdfQ==