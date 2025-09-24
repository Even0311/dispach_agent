// Local type definitions
export interface Message {
  speaker: 'AI' | 'customer';
  message: string;
  startedAt: string;
}

export interface Service {
  id: string;
  name: string;
  price: number | null;
  description?: string;
}

export interface UserInfo {
  name?: string;
  phone?: string;
  address?: string;
}

export interface Company {
  id: string;
  name: string;
  email: string;
  userId: string;
  calendar_access_token?: string;
}

export interface CallSkeleton {
  callSid: string;
  services: readonly Service[];
  company: Company;
  user: {
    service?: Service;
    serviceBookedTime?: string;
    userInfo: Partial<UserInfo>;
  };
  history: Message[];
  servicebooked: boolean;
  confirmEmailsent: boolean;
  createdAt?: string;
}

export interface AgentState {
  messages: any[];
  next: string;
  input: string;
  chat_history: any[];
  intermediate_steps: any[];
  agent_outcome?: any;
}

export interface AgentRequest {
  query: string;
  session_id?: string;
}

export interface AgentResponse {
  result: string;
  steps: AgentStep[];
  execution_time: string;
  session_id: string;
}

export interface AgentStep {
  type: 'thought' | 'action' | 'observation' | 'final_answer';
  content: string;
  timestamp: string;
  tool_name?: string;
  tool_input?: any;
  tool_output?: any;
}

export interface ElectricianServiceInput {
  service_type: string;
  urgency?: 'low' | 'medium' | 'high' | 'emergency';
  location?: string;
  description?: string;
}

export interface BookingInput {
  customer_name: string;
  phone: string;
  address: string;
  service_id: string;
  preferred_time?: string;
  notes?: string;
}