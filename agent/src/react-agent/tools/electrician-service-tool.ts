import { DynamicTool } from "@langchain/core/tools";
import { CallSkeleton } from '../types';
import { ElectricianServiceInput, BookingInput } from '../types';

// Mock CallSkeleton for electrician services
const createMockCallSkeleton = (): CallSkeleton => ({
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

  Input should be a JSON string with optional fields:
  - service_type: Type of service needed (installation, repair, inspection, emergency, upgrade)
  - urgency: How urgent (low, medium, high, emergency)
  - location: Location or suburb in Sydney

  Use this when user asks about services, pricing, or what work we can do.`,
  func: async (input: string) => {
    const parsedInput: ElectricianServiceInput = JSON.parse(input);
    const skeleton = createMockCallSkeleton();

    let response = "Here are our available electrician services:\n\n";

    if (parsedInput.service_type) {
      const matchingServices = skeleton.services.filter(s =>
        s.name.toLowerCase().includes(parsedInput.service_type!.toLowerCase()) ||
        s.id.toLowerCase().includes(parsedInput.service_type!.toLowerCase())
      );

      if (matchingServices.length > 0) {
        response += "Matching services:\n";
        matchingServices.forEach(service => {
          response += `• ${service.name}: $${service.price} AUD${service.duration ? ` (${service.duration} mins)` : ''}\n  ${service.description}\n\n`;
        });
      }
    } else {
      response += "All available services:\n";
      skeleton.services.forEach(service => {
        response += `• ${service.name}: $${service.price} AUD${service.duration ? ` (${service.duration} mins)` : ''}\n  ${service.description}\n\n`;
      });
    }

    response += `\nCompany: ${skeleton.company.name}\n`;
    response += `Phone: ${skeleton.company.phone || '+61-2-9876-5432'}\n`;
    response += `Location: Sydney NSW (we service all Sydney metro areas)\n`;

    if (parsedInput.urgency === "emergency") {
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
  description: `Create a booking for electrician services.

  Input should be a JSON string with required fields:
  - customer_name: Customer's full name (required)
  - phone: Customer's phone number (required)
  - address: Full address where service is needed (required)
  - service_id: ID of the selected service like 'repair_001', 'install_001' (required)
  - preferred_time: Preferred date and time for service (optional)
  - notes: Any special requirements or notes (optional)

  Use this after getting customer information and confirming service selection.`,
  func: async (input: string) => {
    const parsedInput: BookingInput = JSON.parse(input);
    const skeleton = createMockCallSkeleton();
    const selectedService = skeleton.services.find(s => s.id === parsedInput.service_id);

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
          name: parsedInput.customer_name,
          phone: parsedInput.phone,
          address: parsedInput.address
        },
        service: selectedService,
        serviceBookedTime: parsedInput.preferred_time || "TBD"
      },
      servicebooked: true,
      history: [
        ...skeleton.history,
        {
          speaker: "customer",
          message: `Booking requested for ${selectedService.name}`,
          startedAt: new Date().toISOString()
        },
        {
          speaker: "system",
          message: `Booking created for ${parsedInput.customer_name} - ${selectedService.name}`,
          startedAt: new Date().toISOString()
        }
      ]
    };

    const bookingId = `BOOK_${Date.now()}`;
    const estimatedArrival = parsedInput.preferred_time || "within 2-4 business days";

    const confirmationMessage = `✅ Booking Confirmed!\n\n` +
      `Booking ID: ${bookingId}\n` +
      `Customer: ${parsedInput.customer_name}\n` +
      `Phone: ${parsedInput.phone}\n` +
      `Address: ${parsedInput.address}\n` +
      `Service: ${selectedService.name}\n` +
      `Price: $${selectedService.price} AUD\n` +
      `Duration: ${selectedService.duration || 'TBD'} minutes\n` +
      `Scheduled: ${estimatedArrival}\n` +
      (parsedInput.notes ? `Notes: ${parsedInput.notes}\n` : '') +
      `\nOur electrician will contact you 30 minutes before arrival.\n` +
      `For any changes, call ${skeleton.company.phone || '+61-2-9876-5432'}`;

    return JSON.stringify({
      success: true,
      booking_id: bookingId,
      confirmation: confirmationMessage,
      service: selectedService,
      customer: {
        name: parsedInput.customer_name,
        phone: parsedInput.phone,
        address: parsedInput.address
      },
      call_skeleton: updatedSkeleton
    });
  }
});

export const electricianTools = [
  getElectricianServiceTool,
  createElectricianBookingTool
];