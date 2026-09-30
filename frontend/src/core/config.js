export const API_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const AUDIENCES = ['user', 'vendor', 'admin']

export const LOGIN_PATHS = {
  user: '/login',
  vendor: '/vendor/login',
  admin: '/admin/login',
}
