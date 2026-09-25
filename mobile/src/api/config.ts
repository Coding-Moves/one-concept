import { publicConfigErrors, validUrl } from '../../public-config.cjs';

// Expo substitutes direct property references while bundling; do not replace
// these with process.env[key] or an object spread.
export const publicConfig = {
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};
export const configurationErrors = publicConfigErrors(publicConfig);
export const API_BASE_URL = (publicConfig.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

export class ApiConfigurationError extends Error {
  constructor() {
    super('App setup is incomplete. Please install the latest app update.');
    this.name = 'ApiConfigurationError';
  }
}

export function isApiConfigured(): boolean {
  return validUrl(publicConfig.EXPO_PUBLIC_API_BASE_URL);
}

export function assertApiConfigured(): void {
  if (!isApiConfigured()) throw new ApiConfigurationError();
}
