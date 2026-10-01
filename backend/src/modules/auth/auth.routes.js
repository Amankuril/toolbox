import { Router } from 'express';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { authController } from './auth.controller.js';
import {
  adminLoginSchema,
  audienceParams,
  registerUserSchema,
  registerVendorSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from './auth.validation.js';

const router = Router();

// Per-phone limits live in the OTP service; these cap abuse from a single IP.
const otpSendLimit = rateLimit({
  keyPrefix: 'otp-send-ip',
  points: 20,
  duration: 60 * 60,
  message: 'Too many OTP requests from this network',
});
const otpVerifyLimit = rateLimit({ keyPrefix: 'otp-verify-ip', points: 30, duration: 10 * 60 });
const adminLoginLimit = rateLimit({ keyPrefix: 'admin-login-ip', points: 20, duration: 15 * 60 });
const refreshLimit = rateLimit({ keyPrefix: 'refresh-ip', points: 120, duration: 60 });

router.post('/otp/send', otpSendLimit, validate(sendOtpSchema), authController.sendOtp);
router.post('/otp/verify', otpVerifyLimit, validate(verifyOtpSchema), authController.verifyOtp);

router.post('/user/register', otpVerifyLimit, validate(registerUserSchema), authController.registerUser);
router.post('/vendor/register', otpVerifyLimit, validate(registerVendorSchema), authController.registerVendor);

router.post('/admin/login', adminLoginLimit, validate(adminLoginSchema), authController.adminLogin);

router.post('/:audience/refresh', refreshLimit, validate(audienceParams), authController.refresh);
router.post('/:audience/logout', validate(audienceParams), authController.logout);

export default router;
