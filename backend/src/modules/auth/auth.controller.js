import { created, noContent, ok } from '#core/utils/response.js';
import { authService } from './auth.service.js';

export const authController = {
  async sendOtp(req, res) {
    ok(res, await authService.sendOtp(req.body));
  },

  async verifyOtp(req, res) {
    ok(res, await authService.verifyOtp(req.body, req, res));
  },

  async registerUser(req, res) {
    created(res, await authService.registerUser(req.body, req, res));
  },

  async registerVendor(req, res) {
    created(res, await authService.registerVendor(req.body, req, res));
  },

  async adminLogin(req, res) {
    ok(res, await authService.adminLogin(req.body, req, res));
  },

  async refresh(req, res) {
    ok(res, await authService.refresh(req.params.audience, req, res));
  },

  async logout(req, res) {
    await authService.logout(req.params.audience, req, res);
    noContent(res);
  },
};
