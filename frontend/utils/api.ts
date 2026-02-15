/**
 * API Configuration Utility
 * Centralized API URL configuration for SafeGuard app
 */

import { Platform } from 'react-native';

/**
 * Get the backend URL based on the platform
 * - On web: Use relative URL (empty string) since backend is on same domain
 * - On native: Use the environment variable
 */
export const getBackendUrl = (): string => {
  if (Platform.OS === 'web') {
    // On web, use relative URL since backend is on same domain via proxy
    return '';
  }
  // For native, use the environment variable
  return process.env.EXPO_PUBLIC_BACKEND_URL || '';
};

export const BACKEND_URL = getBackendUrl();
