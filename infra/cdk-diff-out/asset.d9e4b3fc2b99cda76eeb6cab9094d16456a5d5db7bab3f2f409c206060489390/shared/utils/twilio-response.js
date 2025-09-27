"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IvrLanguage = exports.NextAction = void 0;
exports.buildSayResponse = buildSayResponse;
const twilio_1 = require("twilio");
var NextAction;
(function (NextAction) {
    NextAction["GATHER"] = "GATHER";
    NextAction["HANGUP"] = "HANGUP";
})(NextAction || (exports.NextAction = NextAction = {}));
var IvrLanguage;
(function (IvrLanguage) {
    IvrLanguage["EN_AU"] = "en-AU";
    IvrLanguage["EN_US"] = "en-US";
})(IvrLanguage || (exports.IvrLanguage = IvrLanguage = {}));
function assertUnreachable(value) {
    throw new Error(`Unreachable case: ${value}`);
}
function buildSayResponse({ text, next, sid, publicUrl, language = IvrLanguage.EN_AU, }) {
    const vr = new twilio_1.twiml.VoiceResponse();
    vr.say({ language }, text);
    switch (next) {
        case NextAction.GATHER: {
            vr.gather({
                input: ['speech'],
                language,
                speechTimeout: 'auto',
                action: publicUrl,
                method: 'POST',
            });
            break;
        }
        case NextAction.HANGUP: {
            vr.hangup();
            break;
        }
        default: {
            assertUnreachable(next);
        }
    }
    return vr.toString();
}
//# sourceMappingURL=twilio-response.js.map