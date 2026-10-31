// Google authentication coordinator (spec 7.1) - NATIVE Android
// implementation. Replaces the earlier expo-auth-session browser flow (which
// Google rejects with `redirect_uri` errors for custom schemes on web-type
// clients) with the current Google Identity Services stack:
//
//  - `AuthorizationClient` (play-services-auth, auth.api.identity) performs
//    account selection + consent for the scopes below through the local
//    Expo module `modules/google-auth`. When a saved grant still covers the
//    scopes the access token is returned SILENTLY; a missing grant yields a
//    PendingIntent that only INTERACTIVE flows launch. Background sync
//    refuses to launch UI and raises AuthenticationRequired instead
//    (spec 7.1.2 - never delete local records on auth failure).
//  - The OAuth client is the "Android" registration identified by package
//    name + SHA-1 (RFC 8252 native client) - no client secret exists in this
//    flow and none is embedded in the build.
//  - Identity (sub/email/name) comes from the OpenID Connect userinfo
//    endpoint using the granted access token - no separate authentication
//    flow is needed.
//  - Tokens live in the OS keystore via expo-secure-store (Keychain/
//    Keystore equivalent), never in AsyncStorage or SQLite.
//  - GIS access tokens last ~1h; the stored expiry carries a conservative
//    55-minute lifetime and renewals happen with the 5-minute pre-expiry
//    margin via a silent re-authorize.

import { Platform } from 'react-native';

import * as SecureStore from 'expo-secure-store';

import { GoogleAuth } from '../../modules/google-auth';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.appdata',
];

const TOKENS_KEY = 'diettracker.google.tokens';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
/** Refresh this long before expiry (spec 7.1.2). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** GIS access tokens last ~1h; keep a conservative stored lifetime. */
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

/** Stable localizable auth failure codes (spec 7.1.5). */
export type AuthErrorCode =
  | 'Auth_Cancelled'
  | 'Auth_Unknown'
  | 'Auth_auth_no_account'
  | 'Auth_auth_interaction_required'
  | 'Auth_auth_silent_failed'
  | 'Auth_google_unauthorized'
  | 'Auth_google_insufficient_permissions'
  | 'Auth_google_refresh_rejected'
  | 'Auth_google_state_mismatch'
  | 'Auth_google_code_exchange_failed'
  | 'Auth_google_identity_unavailable'
  | 'Auth_google_network_error'
  | 'Auth_google_access_denied'
  | 'Auth_google_authorization_cancelled'
  | 'Auth_google_invalid_token_response'
  | 'Auth_google_refresh_failed'
  | 'Auth_google_refresh_token_missing'
  | 'Auth_google_not_configured';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface StoredTokens {
  accessToken: string;
  /** Epoch millis; 0 when the SDK manages refresh itself. */
  expiresAt: number;
  idToken: string;
  /**
   * Always null with GIS: the SDK renews tokens by silently re-authorizing
   * while the saved grant covers the scopes (see renewTokens).
   */
  refreshToken: string | null;
  email: string;
  displayName: string;
  userId: string;
  /** Google profile photo URL ('' when the account has none). */
  photoUrl: string;
}

/**
 * True once the platform's native client id exists (spec 7.1.4 fail-fast).
 * Android uses the "Android" OAuth client (package + SHA-1 registration);
 * iOS native sign-in is future work and fails fast until configured.
 */
export function isGoogleConfigured(): boolean {
  const config = getClientConfig();
  if (Platform.OS === 'ios') {
    return config.iosClientId !== '';
  }
  return config.androidClientId !== '';
}

export interface GoogleClientConfig {
  /** Android OAuth client id (package com.diettracker.app + debug SHA-1). */
  androidClientId: string;
  /**
   * Optional Web client id - reserved for a future Credential Manager flow.
   * A Web client SECRET must NEVER be embedded in the build or the config.
   */
  webClientId: string;
  /** iOS OAuth client id (future native iOS sign-in). */
  iosClientId: string;
}

let clientConfig: GoogleClientConfig = {
  androidClientId: '',
  webClientId: '',
  iosClientId: '',
};

/** Called once at startup with the values from the bundled runtime config. */
export function configureGoogle(config: Partial<GoogleClientConfig>): void {
  clientConfig = { ...clientConfig, ...config };
}

function getClientConfig(): GoogleClientConfig {
  return clientConfig;
}

/** Throws Auth_google_not_configured before any UI attempts a sign-in. */
export function assertConfigured(): void {
  if (!isGoogleConfigured()) {
    throw new AuthError('Auth_google_not_configured');
  }
}

/** Only Android has a wired native flow so far (spec 7.1.2 - iOS to follow). */
function assertAndroid(): void {
  if (Platform.OS !== 'android') {
    throw new AuthError('Auth_google_not_configured');
  }
}

/**
 * Interactive sign-in with consent (spec 8.1 / 8.8): the GIS flow shows the
 * account chooser and (when not yet granted) the drive.appdata consent, then
 * the identity is read from the userinfo endpoint. Returns the stored token
 * bundle; throws a localized AuthError on failure.
 */
export async function signIn(): Promise<StoredTokens> {
  assertConfigured();
  assertAndroid();
  try {
    const authorization = await GoogleAuth.authorize(GOOGLE_SCOPES, null, true, true);
    const identity = await fetchIdentity(authorization.accessToken);
    const tokens: StoredTokens = {
      accessToken: authorization.accessToken,
      expiresAt: Date.now() + TOKEN_LIFETIME_MS,
      idToken: '',
      refreshToken: null,
      email: identity.email,
      displayName: identity.name,
      userId: identity.sub,
      photoUrl: identity.picture,
    };
    await storeTokens(tokens);
    return tokens;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw mapNativeError(error);
  }
}

/** Reads the OpenID Connect identity for the granted access token. */
async function fetchIdentity(
  accessToken: string,
): Promise<{ sub: string; email: string; name: string; picture: string }> {
  try {
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new AuthError('Auth_google_identity_unavailable');
    }
    const body = (await response.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    if (body.sub === undefined || body.email === undefined) {
      throw new AuthError('Auth_google_identity_unavailable');
    }
    return { sub: body.sub, email: body.email, name: body.name ?? '', picture: body.picture ?? '' };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Auth_google_network_error');
  }
}

/**
 * Silent token renewal: GIS returns a fresh token while the saved grant
 * covers the scopes; otherwise the module refuses (AUTH_REQUIRED) because
 * background paths must never open UI.
 */
async function renewTokens(stored: StoredTokens): Promise<StoredTokens> {
  const authorization = await GoogleAuth.authorize(
    GOOGLE_SCOPES,
    stored.email !== '' ? stored.email : null,
    false,
    false,
  );
  const renewed: StoredTokens = {
    ...stored,
    accessToken: authorization.accessToken,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  };
  await storeTokens(renewed);
  return renewed;
}

/** Silent restore on start; never throws - returns null when no session. */
export async function signInSilently(): Promise<StoredTokens | null> {
  if (!isGoogleConfigured() || Platform.OS !== 'android') {
    return null;
  }
  try {
    const stored = await readTokens();
    if (stored === null) {
      return null;
    }
    if (stored.expiresAt > Date.now() + REFRESH_MARGIN_MS) {
      return stored;
    }
    return await renewTokens(stored);
  } catch {
    return null;
  }
}

/**
 * Returns a usable access token, renewing when within the 5-minute margin
 * (spec 7.1.2). Throws Auth_google_refresh_* codes the caller turns into
 * AuthenticationRequired - local records are never touched.
 */
export async function getValidAccessToken(): Promise<string> {
  assertConfigured();
  assertAndroid();
  const stored = await readTokens();
  if (stored === null) {
    throw new AuthError('Auth_google_refresh_token_missing');
  }
  if (stored.expiresAt > Date.now() + REFRESH_MARGIN_MS) {
    return stored.accessToken;
  }
  try {
    const renewed = await renewTokens(stored);
    return renewed.accessToken;
  } catch (error) {
    // The stale token may still be accepted server-side; if not, the Drive
    // call fails with Auth_google_unauthorized (AuthenticationRequired).
    if (stored.accessToken !== '') {
      return stored.accessToken;
    }
    throw error;
  }
}

/** Local sign-out: wipe the keystore token bundle (server sessions untouched). */
export async function signOutLocal(): Promise<void> {
  await clearTokens();
  // The GIS device-level grant is intentionally kept: the next interactive
  // sign-in reuses it silently - the same behaviour as the Windows browser
  // flow. No revokeAccess call is ever made.
}

/** Persists the token bundle in the Keychain/Keystore (never plain storage). */
async function storeTokens(tokens: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** Reads the stored bundle; token reads precede any UI signed-in decision. */
export async function readTokens(): Promise<StoredTokens | null> {
  try {
    const value = await SecureStore.getItemAsync(TOKENS_KEY);
    if (value === null || value === '') {
      return null;
    }
    return JSON.parse(value) as StoredTokens;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKENS_KEY);
  } catch {
    // already gone - nothing to do
  }
}

/** Maps native module rejections onto the stable taxonomy (spec 7.1.5). */
function mapNativeError(error: unknown): AuthError {
  const code = String((error as { code?: string })?.code ?? '');
  const message = String((error as Error)?.message ?? '');
  if (code === 'AUTH_CANCELLED') {
    return new AuthError('Auth_google_authorization_cancelled');
  }
  if (code === 'AUTH_REQUIRED' || code === 'NO_ACTIVITY' || code === 'NO_CONTEXT') {
    return new AuthError('Auth_google_refresh_rejected');
  }
  if (/access_denied|insufficient/i.test(message)) {
    return new AuthError('Auth_google_access_denied');
  }
  if (/network|io exception|timed? ?out|socket|unreachable/i.test(message)) {
    return new AuthError('Auth_google_network_error');
  }
  return new AuthError('Auth_Unknown');
}

export type { StoredTokens as GoogleTokens };


