// SPDX-License-Identifier: MIT
// Google sign-in for Drive sync, using the Google Identity Services *token*
// model: an access token only, valid roughly an hour, with no refresh token
// and no offline access requested.
//
// Nothing durable is stored. The token lives in a module-local variable for the
// session and is gone on reload — there is deliberately no localStorage, no
// cookie, and no IndexedDB copy, so a stolen browser profile yields no Google
// credential. It also sidesteps the 7-day refresh-token expiry that applies
// while the OAuth consent screen is in `testing` status.

import { DRIVE_CLIENT_ID, DRIVE_SCOPE, GSI_CLIENT_URL } from './config';
import { loadExternalScript } from './script-loader';

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}

interface GoogleIdentityNamespace {
  accounts?: { oauth2?: GoogleOauth2 };
}

/** Raised when the user closes or dismisses the Google consent popup. */
export class DriveAuthCancelled extends Error {
  constructor() {
    super('Google sign-in was cancelled');
    this.name = 'DriveAuthCancelled';
  }
}

/** Raised when Google refuses the authorization. */
export class DriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

interface CachedToken {
  token: string;
  /** Epoch milliseconds after which the token is treated as expired. */
  expiresAt: number;
}

let cached: CachedToken | null = null;
let tokenClient: TokenClient | null = null;
let pending: Promise<string> | null = null;

/** Renew a little early so a long upload cannot start on a token about to die. */
const EXPIRY_MARGIN_MS = 60_000;

function oauth2(): GoogleOauth2 {
  const google = (globalThis as { google?: GoogleIdentityNamespace }).google;
  const api = google?.accounts?.oauth2;
  if (!api) throw new DriveAuthError('Google Identity Services did not load');
  return api;
}

/** True when a usable, unexpired access token is already in memory. */
export function isSignedIn(): boolean {
  return cached !== null && cached.expiresAt > Date.now();
}

/**
 * Obtain an access token, prompting the user only when one is not already
 * held. Concurrent callers share a single prompt rather than opening several
 * consent popups.
 */
export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (pending) return pending;

  pending = requestToken().finally(() => {
    pending = null;
  });
  return pending;
}

async function requestToken(): Promise<string> {
  if (!DRIVE_CLIENT_ID) throw new DriveAuthError('no OAuth client id was built in');
  await loadExternalScript(GSI_CLIENT_URL);

  return new Promise<string>((resolve, reject) => {
    const settle = (response: TokenResponse) => {
      if (response.error) {
        // `access_denied` / `interaction_required` mean the user declined or
        // dismissed; anything else is a real failure worth surfacing.
        if (response.error === 'access_denied' || response.error === 'interaction_required') {
          reject(new DriveAuthCancelled());
        } else {
          reject(new DriveAuthError(response.error_description ?? response.error));
        }
        return;
      }
      if (!response.access_token) {
        reject(new DriveAuthError('Google returned no access token'));
        return;
      }
      const lifetimeMs = (response.expires_in ?? 3600) * 1000;
      cached = {
        token: response.access_token,
        expiresAt: Date.now() + Math.max(0, lifetimeMs - EXPIRY_MARGIN_MS),
      };
      resolve(response.access_token);
    };

    try {
      // The client is created once; its callback is rebound per request by
      // recreating it, which is what the GIS token model expects.
      tokenClient = oauth2().initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: settle,
        error_callback: (error) => {
          if (error?.type === 'popup_closed' || error?.type === 'popup_failed_to_open') {
            reject(new DriveAuthCancelled());
          } else {
            reject(new DriveAuthError(error?.message ?? 'Google sign-in failed'));
          }
        },
      });
      // An empty prompt reuses an existing grant silently where Google can.
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      reject(err instanceof Error ? err : new DriveAuthError(String(err)));
    }
  });
}

/**
 * Drop the in-memory token and ask Google to revoke it. Revocation is
 * best-effort: the local token is forgotten either way, which is what actually
 * governs this app's access.
 */
export function signOut(): void {
  const token = cached?.token;
  cached = null;
  tokenClient = null;
  if (!token) return;
  try {
    oauth2().revoke(token);
  } catch {
    // Already revoked, offline, or GIS never loaded — nothing left to do.
  }
}

/** Forget the cached token without contacting Google (used after a 401). */
export function forgetToken(): void {
  cached = null;
}
