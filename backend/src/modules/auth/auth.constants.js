import { API_PREFIX } from '#config/constants.js';

export const AUDIENCES = ['user', 'vendor', 'admin'];
/** Audiences that sign in with mobile OTP. Admins use email + password. */
export const OTP_AUDIENCES = ['user', 'vendor'];

export const refreshCookieName = (audience) => `tb_rt_${audience}`;
/** Refresh cookies are scoped to their audience's auth routes so they're never sent elsewhere. */
export const refreshCookiePath = (audience) => `${API_PREFIX}/auth/${audience}`;
