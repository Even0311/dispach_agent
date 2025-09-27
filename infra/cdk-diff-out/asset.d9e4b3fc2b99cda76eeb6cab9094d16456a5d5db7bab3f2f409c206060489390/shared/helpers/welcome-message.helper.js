"use strict";
/**
 * Welcome Message Helper
 *
 * Pure utility functions for building welcome messages.
 * No dependencies, easy to test and maintain.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WelcomeMessageHelper = void 0;
exports.WelcomeMessageHelper = {
    /**
     * Build welcome message based on company info and user preferences
     */
    buildWelcomeMessage(companyName, services, greeting) {
        // If user has chosen a custom welcome message, use it and add professional follow-up
        if (greeting?.isCustom === true && greeting.message) {
            return `${greeting.message} May I have your name to begin with the process?`;
        }
        // Default behavior: use system-generated welcome message
        if (companyName !== undefined && services && services.length > 0) {
            const serviceList = services.map(s => s.name).join(', ');
            return `Welcome! We are ${companyName}. We provide ${serviceList}. May I get your name please?`;
        }
        return 'Welcome! May I get your name please?';
    },
    /**
     * Build service list string for welcome messages
     */
    buildServiceList(services) {
        if (services.length === 0) {
            return '';
        }
        return services.map(s => s.name).join(', ');
    },
    /**
     * Get appropriate greeting prompt based on message type
     */
    getGreetingPrompt(isCustomMessage) {
        return isCustomMessage
            ? 'May I have your name to begin with the process?'
            : 'May I get your name please?';
    },
};
//# sourceMappingURL=welcome-message.helper.js.map