import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
export interface TelephonyLambdaEvent extends APIGatewayProxyEvent {
    body: string;
}
export interface TelephonyLambdaResult extends APIGatewayProxyResult {
    statusCode: number;
    headers?: {
        [header: string]: string | number | boolean;
    };
    body: string;
}
//# sourceMappingURL=lambda.d.ts.map