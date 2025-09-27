"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseDynamoDBService = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
class BaseDynamoDBService {
    constructor() {
        const dynamoClient = new client_dynamodb_1.DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1',
        });
        this.client = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
    }
    async get(tableName, key) {
        const command = new lib_dynamodb_1.GetCommand({
            TableName: tableName,
            Key: key,
        });
        const result = await this.client.send(command);
        return result.Item;
    }
    async put(tableName, item) {
        const command = new lib_dynamodb_1.PutCommand({
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
    async query(tableName, keyCondition, expressionValues, indexName, expressionAttributeNames) {
        const command = new lib_dynamodb_1.QueryCommand({
            TableName: tableName,
            KeyConditionExpression: keyCondition,
            ExpressionAttributeValues: expressionValues,
            IndexName: indexName,
            ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames }),
        });
        const result = await this.client.send(command);
        return result.Items || [];
    }
    async scan(tableName, filterExpression, expressionValues) {
        const command = new lib_dynamodb_1.ScanCommand({
            TableName: tableName,
            FilterExpression: filterExpression,
            ExpressionAttributeValues: expressionValues,
        });
        const result = await this.client.send(command);
        return result.Items || [];
    }
    async update(tableName, key, updateExpression, expressionValues, expressionAttributeNames) {
        const command = new lib_dynamodb_1.UpdateCommand({
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
exports.BaseDynamoDBService = BaseDynamoDBService;
//# sourceMappingURL=base.service.js.map