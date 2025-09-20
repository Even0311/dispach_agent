import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

export abstract class BaseDynamoDBService {
  protected client: DynamoDBDocumentClient;

  constructor() {
    const dynamoClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  protected async get(tableName: string, key: Record<string, any>): Promise<any> {
    const command = new GetCommand({
      TableName: tableName,
      Key: key,
    });

    const result = await this.client.send(command);
    return result.Item;
  }

  protected async put(tableName: string, item: Record<string, any>): Promise<any> {
    const command = new PutCommand({
      TableName: tableName,
      Item: {
        ...item,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    await this.client.send(command);
    return item;
  }

  protected async query(
    tableName: string,
    keyCondition: string,
    expressionValues: Record<string, any>,
    indexName?: string,
    expressionAttributeNames?: Record<string, string>
  ): Promise<any[]> {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionValues,
      IndexName: indexName,
      ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames }),
    });

    const result = await this.client.send(command);
    return result.Items || [];
  }

  protected async scan(
    tableName: string,
    filterExpression?: string,
    expressionValues?: Record<string, any>
  ): Promise<any[]> {
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionValues,
    });

    const result = await this.client.send(command);
    return result.Items || [];
  }

  protected async update(
    tableName: string,
    key: Record<string, any>,
    updateExpression: string,
    expressionValues: Record<string, any>,
    expressionAttributeNames?: Record<string, string>
  ): Promise<any> {
    const command = new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: {
        ...expressionValues,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
      ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames }),
    });

    const result = await this.client.send(command);
    return result.Attributes;
  }
}