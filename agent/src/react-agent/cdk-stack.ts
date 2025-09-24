import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ReactAgentStackProps extends cdk.StackProps {
  bedrockRegion?: string;
  primaryModel?: string;
  langsmithProject?: string;
  langsmithApiKey?: string;
}

export class ReactAgentStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly lambdaFunction: lambda.Function;

  constructor(scope: Construct, id: string, props?: ReactAgentStackProps) {
    super(scope, id, props);

    // Create IAM role for Lambda with Bedrock permissions
    const lambdaRole = new iam.Role(this, 'ReactAgentLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        BedrockPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
                'bedrock:GetFoundationModel',
                'bedrock:ListFoundationModels',
              ],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Create CloudWatch log group with retention
    const logGroup = new logs.LogGroup(this, 'ReactAgentLogGroup', {
      logGroupName: `/aws/lambda/react-agent-${this.stackName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda function
    this.lambdaFunction = new lambda.Function(this, 'ReactAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./dist'), // Compiled TypeScript
      role: lambdaRole,
      timeout: cdk.Duration.seconds(300), // 5 minutes for complex agent workflows
      memorySize: 1024, // Sufficient for LangChain operations
      logGroup: logGroup,
      environment: {
        NODE_ENV: 'production',
        BEDROCK_REGION: props?.bedrockRegion || 'ap-southeast-2',
        PRIMARY_MODEL: props?.primaryModel || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        MAX_TOKENS: '4096',
        TEMPERATURE: '0.1',
        LANGSMITH_PROJECT: props?.langsmithProject || 'electrician-react-agent-prod',
        ...(props?.langsmithApiKey && {
          LANGSMITH_API_KEY: props.langsmithApiKey,
        }),
      },
      deadLetterQueueEnabled: true,
      reservedConcurrentExecutions: 10, // Limit concurrent executions
    });

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'ReactAgentApi', {
      restApiName: 'Electrician React Agent API',
      description: 'API for the Electrician React Agent using LangGraph and Bedrock',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
      deployOptions: {
        stageName: 'prod',
        // throttle: {
        //   rateLimit: 100,
        //   burstLimit: 200,
        // },
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
    });

    // Create Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(this.lambdaFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    // Add routes
    api.root.addMethod('ANY', lambdaIntegration);

    const agentResource = api.root.addResource('agent');
    agentResource.addMethod('POST', lambdaIntegration);
    agentResource.addMethod('OPTIONS', lambdaIntegration);

    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', lambdaIntegration);

    // Store API URL
    this.apiUrl = api.url;

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      description: 'URL of the React Agent API',
      exportName: `${this.stackName}-ApiUrl`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: this.lambdaFunction.functionName,
      description: 'Name of the Lambda function',
      exportName: `${this.stackName}-LambdaName`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: this.lambdaFunction.functionArn,
      description: 'ARN of the Lambda function',
      exportName: `${this.stackName}-LambdaArn`,
    });

    // Tags
    cdk.Tags.of(this).add('Project', 'DispatchAgent');
    cdk.Tags.of(this).add('Component', 'ReactAgent');
    cdk.Tags.of(this).add('Environment', 'Production');
  }
}