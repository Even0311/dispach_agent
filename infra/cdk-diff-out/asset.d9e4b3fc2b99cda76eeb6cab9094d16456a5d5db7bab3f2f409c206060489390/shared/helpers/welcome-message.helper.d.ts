/**
 * Welcome Message Helper
 *
 * Pure utility functions for building welcome messages.
 * No dependencies, easy to test and maintain.
 */
export declare const WelcomeMessageHelper: {
    /**
     * Build welcome message based on company info and user preferences
     */
    readonly buildWelcomeMessage: (companyName?: string, services?: readonly {
        name: string;
    }[], greeting?: {
        message: string;
        isCustom: boolean;
    }) => string;
    /**
     * Build service list string for welcome messages
     */
    readonly buildServiceList: (services: readonly {
        name: string;
    }[]) => string;
    /**
     * Get appropriate greeting prompt based on message type
     */
    readonly getGreetingPrompt: (isCustomMessage: boolean) => string;
};
//# sourceMappingURL=welcome-message.helper.d.ts.map