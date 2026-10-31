import { requireNativeModule } from 'expo-modules-core';

/**
 * Native module (modules/google-auth, Android) wrapping the Google Identity
 * Services authorization stack - auth.api.identity.AuthorizationClient.
 * No client secret exists in this flow (native RFC 8252 client).
 */
interface NativeGoogleAuthModule {
  playServicesAvailable(showDialog: boolean): boolean;
  /**
   * Resolves { accessToken, grantedScopes } when a token is available.
   * Rejects with code AUTH_CANCELLED | AUTH_REQUIRED | AUTH_ERROR |
   * NO_ACTIVITY | NO_CONTEXT | AUTH_EMPTY.
   */
  authorize(
    scopes: string[],
    accountName: string | null,
    selectAccount: boolean,
    interactive: boolean,
  ): Promise<{ accessToken: string; grantedScopes: string[] }>;
}

export const GoogleAuth = requireNativeModule<NativeGoogleAuthModule>('GoogleAuth');
