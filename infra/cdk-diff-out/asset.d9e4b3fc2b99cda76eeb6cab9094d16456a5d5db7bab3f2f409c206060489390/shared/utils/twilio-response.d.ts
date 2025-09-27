export declare enum NextAction {
    GATHER = "GATHER",
    HANGUP = "HANGUP"
}
export declare enum IvrLanguage {
    EN_AU = "en-AU",
    EN_US = "en-US"
}
export interface SayOptions {
    text: string;
    next: NextAction;
    sid: string;
    publicUrl: string;
    language?: IvrLanguage;
}
export declare function buildSayResponse({ text, next, sid, publicUrl, language, }: SayOptions): string;
//# sourceMappingURL=twilio-response.d.ts.map