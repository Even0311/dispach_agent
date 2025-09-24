#!/usr/bin/env node

/**
 * Simple test script to verify the React Agent works locally
 * Run with: npm run build && node dist/test-agent.js
 */

import { ElectricianReactAgent } from './agent';
import { AgentRequest } from './types';

async function testAgent() {
  console.log('🔧 Testing Electrician React Agent...\n');

  // Set up environment variables for testing
  process.env.BEDROCK_REGION = 'ap-southeast-2';
  process.env.PRIMARY_MODEL = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
  process.env.LANGSMITH_PROJECT = 'electrician-agent-test';
  process.env.NODE_ENV = 'development';

  try {
    const agent = new ElectricianReactAgent();

    // Test 1: Basic service inquiry
    console.log('📋 Test 1: Service Information Inquiry');
    console.log('Query: "What electrical services do you offer?"');

    const test1: AgentRequest = {
      query: "What electrical services do you offer?",
      session_id: "test_session_1"
    };

    const result1 = await agent.execute(test1);
    console.log(`✅ Result: ${result1.result.substring(0, 200)}...`);
    console.log(`⏱️  Execution time: ${result1.execution_time}`);
    console.log(`🔄 Steps: ${result1.steps.length}\n`);

    // Test 2: Emergency service inquiry
    console.log('📋 Test 2: Emergency Service Inquiry');
    console.log('Query: "I have an electrical emergency, can you help?"');

    const test2: AgentRequest = {
      query: "I have an electrical emergency, can you help?",
      session_id: "test_session_2"
    };

    const result2 = await agent.execute(test2);
    console.log(`✅ Result: ${result2.result.substring(0, 200)}...`);
    console.log(`⏱️  Execution time: ${result2.execution_time}`);
    console.log(`🔄 Steps: ${result2.steps.length}\n`);

    // Test 3: Booking attempt (should ask for details)
    console.log('📋 Test 3: Booking Attempt');
    console.log('Query: "I want to book an electrical repair service"');

    const test3: AgentRequest = {
      query: "I want to book an electrical repair service",
      session_id: "test_session_3"
    };

    const result3 = await agent.execute(test3);
    console.log(`✅ Result: ${result3.result.substring(0, 200)}...`);
    console.log(`⏱️  Execution time: ${result3.execution_time}`);
    console.log(`🔄 Steps: ${result3.steps.length}\n`);

    // Test 4: Agent info
    console.log('📋 Test 4: Agent Information');
    const agentInfo = agent.getAgentInfo();
    console.log('Agent Info:', JSON.stringify(agentInfo, null, 2));

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testAgent().catch(console.error);
}

export { testAgent };