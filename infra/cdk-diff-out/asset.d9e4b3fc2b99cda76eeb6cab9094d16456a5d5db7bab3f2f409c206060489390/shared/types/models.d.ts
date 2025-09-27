export declare enum UserStatus {
    active = "active",
    inactive = "inactive",
    suspended = "suspended"
}
export declare enum EUserRole {
    admin = "admin",
    user = "user"
}
export interface User {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    password?: string;
    twilioPhoneNumber: string;
    fullPhoneNumber: string;
    receivedAdverts: boolean;
    status: UserStatus;
    statusReason?: string;
    position?: string;
    role: EUserRole;
    createdAt: Date;
    updatedAt: Date;
}
export interface CompanyAddress {
    unitAptPOBox?: string;
    streetAddress: string;
    suburb: string;
    state: string;
    postcode: string;
}
export interface CompanyGreeting {
    message: string;
    isCustom: boolean;
}
export interface Company {
    _id: string;
    businessName: string;
    address: CompanyAddress;
    abn: string;
    user: string;
    twilioPhoneNumber?: string;
    greeting: CompanyGreeting;
    createdAt: Date;
    updatedAt: Date;
}
export interface Service {
    _id: string;
    userId: string;
    name: string;
    description?: string;
    price: number;
    isAvailable: boolean;
    isDeleted?: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface CallLog {
    _id: string;
    callSid: string;
    userId: string;
    serviceBookedId?: string;
    callerNumber: string;
    callerName?: string;
    startAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface Transcript {
    _id: string;
    callSid: string;
    summary: string;
    keyPoints?: string[];
    createdAt: Date;
    updatedAt: Date;
}
export interface TranscriptChunk {
    _id: string;
    transcriptId: string;
    speaker: 'AI' | 'customer';
    message: string;
    startedAt: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare enum ServiceBookingStatus {
    Cancelled = "Cancelled",
    Confirmed = "Confirmed",
    Done = "Done"
}
export interface ServiceBookingClient {
    name: string;
    phoneNumber: string;
    address: string;
}
export interface ServiceFormValue {
    serviceFieldId: string;
    answer: string;
}
export interface ServiceBooking {
    _id: string;
    serviceId: string;
    client: ServiceBookingClient;
    serviceFormValues: ServiceFormValue[];
    status: ServiceBookingStatus;
    note: string;
    bookingTime: Date;
    userId: string;
    callSid?: string;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=models.d.ts.map