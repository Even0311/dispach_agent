"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceBookingStatus = exports.EUserRole = exports.UserStatus = void 0;
// User Model
var UserStatus;
(function (UserStatus) {
    UserStatus["active"] = "active";
    UserStatus["inactive"] = "inactive";
    UserStatus["suspended"] = "suspended";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
var EUserRole;
(function (EUserRole) {
    EUserRole["admin"] = "admin";
    EUserRole["user"] = "user";
})(EUserRole || (exports.EUserRole = EUserRole = {}));
// ServiceBooking Model
var ServiceBookingStatus;
(function (ServiceBookingStatus) {
    ServiceBookingStatus["Cancelled"] = "Cancelled";
    ServiceBookingStatus["Confirmed"] = "Confirmed";
    ServiceBookingStatus["Done"] = "Done";
})(ServiceBookingStatus || (exports.ServiceBookingStatus = ServiceBookingStatus = {}));
//# sourceMappingURL=models.js.map