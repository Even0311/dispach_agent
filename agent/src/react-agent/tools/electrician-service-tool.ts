import { DynamicTool } from "@langchain/core/tools";
import { z } from "zod";
import { CallSkeleton, Service, Company, UserInfo } from '../types';
import { ElectricianServiceInput, BookingInput } from '../types';

// Mock CallSkeleton for electrician services
const createMockCallSkeleton = (serviceType?: string): CallSkeleton => ({
  callSid: `call_${Date.now()}`,
  company: {
    id: "elec_001",
    name: "Sydney Professional Electricians",
    email: "contact@sydneyelectricians.com.au",
    userId: "user_123"
  },
  services: [
    {
      id: "install_001",
      name: "Electrical Installation",
      description: "New home and commercial electrical installations",
      price: 180
    },
    {
      id: "repair_001",
      name: "Electrical Repair",
      description: "Fix electrical faults, outlets, switches, and circuits",
      price: 95
    },
    {
      id: "safety_001",
      name: "Safety Inspection",
      description: "Comprehensive electrical safety check and certification",
      price: 150
    },
    {
      id: "emergency_001",
      name: "Emergency Service",
      description: "24/7 emergency electrical repairs",
      price: 250
    },
    {
      id: "upgrade_001",
      name: "Electrical Upgrade",
      description: "Upgrade electrical panels, wiring, and systems",
      price: 320
    }
  ],
  user: {
    userInfo: {
      name: "",
      phone: "",
      address: ""
    }
  },
  history: [
    {
      speaker: "AI",
      message: "Connected to Sydney Professional Electricians",
      startedAt: new Date().toISOString()
    }
  ],
  servicebooked: false,
  confirmEmailsent: false,
  createdAt: new Date().toISOString()
});

// Get service information tool
export const getElectricianServiceTool = new DynamicTool({
  name: "get_electrician_services",
  description: `Get information about available electrician services including:
  - Electrical installations and repairs
  - Safety inspections and certifications
  - Emergency services
  - Electrical system upgrades
  - Pricing and availability
  Use this when user asks about services, pricing, or what work we can do.`,
  schema: z.object({
    service_type: z.string().optional().describe("Type of service needed: installation, repair, inspection, emergency, upgrade"),
    urgency: z.enum(["low", "medium", "high", "emergency"]).optional().describe("How urgent is the service needed"),
    location: z.string().optional().describe("Location or suburb in Sydney")
  }),
  func: async (input: ElectricianServiceInput) => {
    const skeleton = createMockCallSkeleton(input.service_type);

    let response = "Here are our available electrician services:\n\n";

    if (input.service_type) {
      const matchingServices = skeleton.services.filter(s =>
        s.name.toLowerCase().includes(input.service_type.toLowerCase()) ||
        s.id.toLowerCase().includes(input.service_type.toLowerCase())
      );

      if (matchingServices.length > 0) {
        response += "Matching services:\n";
        matchingServices.forEach(service => {
          response += `• ${service.name}: $${service.price} AUD (${service.duration} mins)\n  ${service.description}\n\n`;
        });
      }
    } else {
      response += "All available services:\n";
      skeleton.services.forEach(service => {
        response += `• ${service.name}: $${service.price} AUD (${service.duration} mins)\n  ${service.description}\n\n`;
      });
    }

    response += `\nCompany: ${skeleton.company.name}\n`;
    response += `Phone: ${skeleton.company.phone}\n`;
    response += `Location: Sydney NSW (we service all Sydney metro areas)\n`;

    if (input.urgency === "emergency") {
      response += `\n🚨 EMERGENCY SERVICE AVAILABLE 24/7\n`;
      response += `Emergency rate: $250 AUD (priority response within 45 minutes)\n`;
    }

    return JSON.stringify({
      services: skeleton.services,
      company: skeleton.company,
      call_skeleton: skeleton,
      response_text: response
    });
  }
});

// Create booking tool
export const createElectricianBookingTool = new DynamicTool({
  name: "create_electrician_booking",
  description: `Create a booking for electrician services. Requires customer details:
  - Customer name and phone number (mandatory)
  - Service address (mandatory)
  - Service type/ID (mandatory)
  - Preferred date/time (optional)
  - Special instructions or notes (optional)
  Use this after getting customer information and confirming service selection.`,
  schema: z.object({
    customer_name: z.string().describe("Customer's full name"),
    phone: z.string().describe("Customer's phone number"),
    address: z.string().describe("Full address where service is needed"),
    service_id: z.string().describe("ID of the selected service (e.g., 'repair_001', 'install_001')"),
    preferred_time: z.string().optional().describe("Preferred date and time for service"),
    notes: z.string().optional().describe("Any special requirements or notes")
  }),
  func: async (input: BookingInput) => {
    const skeleton = createMockCallSkeleton();
    const selectedService = skeleton.services.find(s => s.id === input.service_id);

    if (!selectedService) {
      return JSON.stringify({
        success: false,
        error: "Service not found",
        available_services: skeleton.services.map(s => ({ id: s.id, name: s.name }))
      });
    }

    // Update the skeleton with booking information
    const updatedSkeleton: CallSkeleton = {
      ...skeleton,
      user: {
        ...skeleton.user,
        userInfo: {
          ...skeleton.user.userInfo,
          name: input.customer_name,
          phone: input.phone,
          address: input.address
        },
        service: selectedService,
        serviceBookedTime: input.preferred_time || "TBD"
      },
      servicebooked: true,
      history: [
        ...skeleton.history,
        {
          speaker: "customer",
          message: `Booking requested for ${selectedService.name}`,
          timestamp: new Date().toISOString()
        },
        {
          speaker: "system",
          message: `Booking created for ${input.customer_name} - ${selectedService.name}`,
          timestamp: new Date().toISOString()
        }
      ]
    };

    const bookingId = `BOOK_${Date.now()}`;
    const estimatedArrival = input.preferred_time || "within 2-4 business days";

    const confirmationMessage = `✅ Booking Confirmed!\n\n` +
      `Booking ID: ${bookingId}\n` +
      `Customer: ${input.customer_name}\n` +
      `Phone: ${input.phone}\n` +
      `Address: ${input.address}\n` +
      `Service: ${selectedService.name}\n` +
      `Price: $${selectedService.price} AUD\n` +
      `Duration: ${selectedService.duration} minutes\n` +
      `Scheduled: ${estimatedArrival}\n` +
      (input.notes ? `Notes: ${input.notes}\n` : '') +
      `\nOur electrician will contact you 30 minutes before arrival.\n` +
      `For any changes, call ${skeleton.company.phone}`;

    return JSON.stringify({
      success: true,
      booking_id: bookingId,
      confirmation: confirmationMessage,
      service: selectedService,
      customer: {
        name: input.customer_name,
        phone: input.phone,
        address: input.address
      },
      call_skeleton: updatedSkeleton
    });
  }
});

export const electricianTools = [
  getElectricianServiceTool,
  createElectricianBookingTool
];