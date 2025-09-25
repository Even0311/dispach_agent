import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
export declare class AgentLambdaStack extends cdk.Stack {
    readonly agentFunction: lambda.Function;
    readonly agentFunctionUrl: lambda.FunctionUrl;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
