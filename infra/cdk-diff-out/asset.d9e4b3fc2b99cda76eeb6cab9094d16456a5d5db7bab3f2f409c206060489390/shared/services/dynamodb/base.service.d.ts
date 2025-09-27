import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
export declare abstract class BaseDynamoDBService {
    protected client: DynamoDBDocumentClient;
    constructor();
    protected get(tableName: string, key: Record<string, any>): Promise<any>;
    protected put(tableName: string, item: Record<string, any>): Promise<any>;
    protected query(tableName: string, keyCondition: string, expressionValues: Record<string, any>, indexName?: string, expressionAttributeNames?: Record<string, string>): Promise<any[]>;
    protected scan(tableName: string, filterExpression?: string, expressionValues?: Record<string, any>): Promise<any[]>;
    protected update(tableName: string, key: Record<string, any>, updateExpression: string, expressionValues: Record<string, any>, expressionAttributeNames?: Record<string, string>): Promise<any>;
}
//# sourceMappingURL=base.service.d.ts.map