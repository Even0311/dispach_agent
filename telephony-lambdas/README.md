# Telephony Lambda Functions

This project contains three AWS Lambda functions that handle Twilio telephony webhooks, replacing the original NestJS-based telephony module.

## Architecture

### Lambda Functions
1. **voice-handler**: Handles initial voice calls and welcome messages
2. **gather-handler**: Processes speech input and AI conversations
3. **status-handler**: Manages call status callbacks and data persistence

### Key Features
- **DynamoDB Integration**: Replaces MongoDB with DynamoDB for data persistence
- **Redis Session Management**: Maintains call session state using Redis
- **AI Integration**: Connects to external AI service for conversation processing
- **Email & Calendar**: Sends booking confirmations and calendar invitations
- **Shared Code**: Common utilities and services in the `shared` directory

## Project Structure

```
telephony-lambdas/
├── shared/                    # Shared code library
│   ├── types/                 # TypeScript type definitions
│   ├── services/              # Service classes
│   │   ├── dynamodb/          # DynamoDB data access layer
│   │   ├── redis/             # Redis session management
│   │   ├── ai/                # AI service integration
│   │   └── external/          # External service calls
│   ├── utils/                 # Utility functions
│   ├── constants/             # Application constants
│   └── helpers/               # Helper classes
├── voice-handler/             # Voice webhook Lambda
├── gather-handler/            # Gather webhook Lambda
├── status-handler/            # Status callback Lambda
├── package.json
├── tsconfig.json
└── README.md
```

## Environment Variables

### Required Variables
```bash
# AWS Configuration
AWS_REGION=us-east-1

# DynamoDB Table Names
USERS_TABLE_NAME=Users
COMPANIES_TABLE_NAME=Companies
SERVICES_TABLE_NAME=Services
CALLLOGS_TABLE_NAME=CallLogs
TRANSCRIPTS_TABLE_NAME=Transcripts
TRANSCRIPT_CHUNKS_TABLE_NAME=TranscriptChunks
SERVICE_BOOKINGS_TABLE_NAME=ServiceBookings

# Redis Configuration
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0

# External Services
PUBLIC_URL=https://your-api-gateway-url
AI_SERVICE_URL=https://your-ai-service-url
DISPATCH_SERVICE_URL=https://your-dispatch-service-url
```

## DynamoDB Tables

### Required Tables and Indexes

#### Users Table
- **Primary Key**: `_id` (String)
- **GSI**: `TwilioPhoneNumberIndex` on `twilioPhoneNumber`

#### Companies Table
- **Primary Key**: `_id` (String)
- **GSI**: `UserIdIndex` on `user`

#### Services Table
- **Primary Key**: `_id` (String)
- **GSI**: `UserIdIndex` on `userId`

#### CallLogs Table
- **Primary Key**: `_id` (String)
- **GSI**: `CallSidIndex` on `callSid`
- **GSI**: `UserIdIndex` on `userId`

#### Transcripts Table
- **Primary Key**: `_id` (String)
- **GSI**: `CallSidIndex` on `callSid`

#### TranscriptChunks Table
- **Primary Key**: `_id` (String)
- **GSI**: `TranscriptIdIndex` on `transcriptId`

#### ServiceBookings Table
- **Primary Key**: `_id` (String)
- **GSI**: `CallSidIndex` on `callSid`
- **GSI**: `UserIdIndex` on `userId`

## Development

### Install Dependencies
```bash
npm install
```

### Build
```bash
npm run build
```

### Package for Deployment
```bash
npm run package
```

This creates zip files for each Lambda function in the project root.

### Testing
```bash
npm test
```

## Deployment

### AWS CDK Integration

The Lambda functions are designed to be deployed via AWS CDK. Each function requires:

1. **IAM Permissions**:
   - DynamoDB read/write access to all tables
   - VPC access for Redis connectivity
   - CloudWatch Logs permissions

2. **VPC Configuration**:
   - Access to Redis subnet
   - Internet access for external API calls

3. **Environment Variables**:
   - Set all required environment variables listed above

### API Gateway Integration

Configure API Gateway endpoints:
- `POST /telephony/voice` → voice-handler
- `POST /telephony/gather` → gather-handler
- `POST /telephony/status` → status-handler

## Key Differences from Original

### Database Layer
- **Before**: MongoDB with Mongoose ODM
- **After**: DynamoDB with AWS SDK v3

### Architecture
- **Before**: Single NestJS application
- **After**: Three independent Lambda functions with shared code

### Session Management
- **Before**: Redis with NestJS Redis module
- **After**: Direct Redis connection with ioredis

### Service Dependencies
- **Before**: Dependency injection with NestJS
- **After**: Direct instantiation in Lambda handlers

## Troubleshooting

### Common Issues

1. **Redis Connection Timeouts**
   - Verify VPC configuration
   - Check Redis security groups
   - Ensure Lambda is in correct subnet

2. **DynamoDB Access Errors**
   - Verify IAM permissions
   - Check table names in environment variables
   - Ensure GSI indexes exist

3. **AI Service Failures**
   - Check AI_SERVICE_URL configuration
   - Verify external service connectivity
   - Review timeout settings

### Monitoring

Monitor Lambda functions through:
- CloudWatch Logs for application logs
- CloudWatch Metrics for performance metrics
- X-Ray for distributed tracing (if enabled)

## Migration Notes

When migrating from the original NestJS implementation:

1. **Data Migration**: Migrate existing MongoDB data to DynamoDB tables
2. **Environment Variables**: Update all service URLs and configuration
3. **Testing**: Thoroughly test all three Lambda functions with real Twilio webhooks
4. **Monitoring**: Set up CloudWatch alarms for error rates and timeouts