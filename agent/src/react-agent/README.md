# Electrician React Agent

A sophisticated AI agent built with LangGraph and AWS Bedrock that provides intelligent customer service for electrical services. The agent uses Claude 3.5 Sonnet v2 to understand customer needs, provide service information, and handle bookings for electrical work.

## 🏗️ Architecture

- **LangGraph**: Orchestrates the ReAct (Reasoning and Acting) workflow
- **AWS Bedrock**: Provides Claude 3.5 Sonnet v2 for natural language understanding
- **LangSmith**: Comprehensive observability and tracing
- **AWS Lambda**: Serverless execution environment
- **API Gateway**: RESTful API interface

## 🔧 Features

### Core Capabilities
- **Service Information**: Provides detailed information about electrical services and pricing
- **Emergency Support**: Prioritizes urgent electrical issues with 24/7 emergency services
- **Booking Management**: Collects customer information and creates service appointments
- **Professional Guidance**: Offers electrical safety advice and recommendations

### Services Offered
- Electrical Installation ($180 AUD, 2 hours)
- Electrical Repair ($95 AUD, 1 hour)
- Safety Inspection ($150 AUD, 1.5 hours)
- Emergency Service ($250 AUD, 45 minutes)
- Electrical Upgrade ($320 AUD, 3 hours)

### Technical Features
- **ReAct Loop**: Thought → Action → Observation → Final Answer
- **Tool Integration**: Mock tools for service information and booking creation
- **Session Management**: Maintains conversation context across interactions
- **Error Handling**: Graceful degradation with helpful error messages
- **Observability**: Full tracing with LangSmith integration

## 🚀 Quick Start

### Prerequisites
```bash
# AWS credentials configured
aws configure

# Node.js 18+ installed
node --version

# Optional: LangSmith API key for tracing
export LANGSMITH_API_KEY="your-api-key-here"
```

### Local Development
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run local test
node dist/test-agent.js
```

### Deploy to AWS
```bash
# Make deploy script executable
chmod +x deploy.sh

# Deploy to Lambda
./deploy.sh
```

## 📡 API Usage

### Health Check
```bash
curl -X GET https://your-api-gateway-url/health
```

### Chat with Agent
```bash
curl -X POST https://your-api-gateway-url/agent \
  -H "Content-Type: application/json" \
  -d '{
    "query": "I need an emergency electrician",
    "session_id": "user-123"
  }'
```

### Example Conversations

**Service Inquiry:**
```json
{
  "query": "What electrical services do you offer?"
}
```

**Emergency Request:**
```json
{
  "query": "I have a power outage in my home, can you help?"
}
```

**Booking Request:**
```json
{
  "query": "I want to book an electrical safety inspection for my office"
}
```

## 🔍 Response Format

```json
{
  "result": "Final agent response to the user",
  "steps": [
    {
      "type": "thought|action|observation|final_answer",
      "content": "Step description",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "tool_name": "optional_tool_name",
      "tool_input": {},
      "tool_output": "optional_tool_result"
    }
  ],
  "execution_time": "2.3s",
  "session_id": "session_123",
  "request_id": "aws-request-id",
  "processing_time": "2.5s"
}
```

## 🛠️ Tools

### get_electrician_services
Retrieves information about available electrical services, pricing, and company details.

**Parameters:**
- `service_type` (optional): Type of service needed
- `urgency` (optional): Service urgency level
- `location` (optional): Service location

### create_electrician_booking
Creates a service booking after collecting customer information.

**Required Parameters:**
- `customer_name`: Customer's full name
- `phone`: Customer's phone number
- `address`: Service address
- `service_id`: Selected service ID

## 🎯 Configuration

### Environment Variables
```bash
BEDROCK_REGION=ap-southeast-2
PRIMARY_MODEL=anthropic.claude-3-5-sonnet-20241022-v2:0
MAX_TOKENS=4096
TEMPERATURE=0.1
LANGSMITH_PROJECT=electrician-agent
LANGSMITH_API_KEY=your-key-here
NODE_ENV=production
```

### AWS Permissions
The Lambda function requires:
- `bedrock:InvokeModel`
- `bedrock:GetFoundationModel`
- `bedrock:ListFoundationModels`
- CloudWatch Logs permissions

## 📊 Monitoring

### LangSmith Integration
- Real-time trace visualization
- Performance metrics
- Conversation analytics
- Error tracking

### CloudWatch Metrics
- Function duration
- Error rates
- Memory usage
- Concurrent executions

## 🧪 Testing

### Local Testing
```bash
# Run comprehensive tests
npm test

# Run individual test scenarios
node dist/test-agent.js
```

### API Testing
```bash
# Test health endpoint
curl https://your-api-url/health

# Test service inquiry
curl -X POST https://your-api-url/agent \
  -H "Content-Type: application/json" \
  -d '{"query": "Hello, what services do you offer?"}'
```

## 🔧 Development

### Project Structure
```
agent/src/react-agent/
├── index.ts           # Lambda handler
├── agent.ts           # Main agent class
├── types.ts           # TypeScript definitions
├── prompts.ts         # System prompts
├── tools/             # Agent tools
│   └── electrician-service-tool.ts
├── test-agent.ts      # Local testing
├── cdk-stack.ts       # CDK deployment
└── deploy.sh          # Deployment script
```

### Key Classes
- `ElectricianReactAgent`: Main agent orchestrator
- `getElectricianServiceTool`: Service information retrieval
- `createElectricianBookingTool`: Booking creation

## 🚀 Deployment Options

### Option 1: CDK (Recommended)
```bash
cd infra/
npx cdk deploy ReactAgentStack --require-approval never
```

### Option 2: Manual Lambda Upload
1. Run `./deploy.sh` to create `react-agent-lambda.zip`
2. Upload to AWS Lambda Console
3. Configure environment variables
4. Set up API Gateway manually

### Option 3: Serverless Framework
Add to `serverless.yml`:
```yaml
functions:
  reactAgent:
    handler: index.handler
    runtime: nodejs18.x
    memorySize: 1024
    timeout: 300
```

## 🔐 Security

- Input validation on all requests
- Rate limiting via API Gateway
- IAM role with minimal permissions
- CORS configuration for web integration
- Error message sanitization

## 📈 Performance

- **Cold Start**: ~2-3 seconds
- **Warm Execution**: ~500-1500ms
- **Memory Usage**: 256-512MB
- **Concurrent Limit**: 10 executions

## 🐛 Troubleshooting

### Common Issues
1. **Bedrock Access Denied**: Check IAM permissions and model availability
2. **Timeout Errors**: Increase Lambda timeout or optimize prompts
3. **Memory Issues**: Increase Lambda memory allocation
4. **Tool Errors**: Check tool input validation

### Debug Mode
Set `NODE_ENV=development` for detailed error information.

### Logs
```bash
aws logs tail /aws/lambda/react-agent-YourStackName --follow
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

---

Built with ❤️ by the Dispatch Agent Team