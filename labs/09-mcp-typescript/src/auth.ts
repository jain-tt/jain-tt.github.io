// Token verification for the HTTP transport.
// Production: verify RS256/ES256 JWTs against your IdP's JWKS (e.g. with the `jose` library).
// This lab ships an HS256 verifier using only node:crypto so the tests have no external IdP.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server';

// [START verifier]
export function hs256Verifier(secret: string, issuer: string, audience: string) {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const [h, p, s] = token.split('.');
      if (!h || !p || !s) throw new OAuthError(OAuthErrorCode.InvalidToken, 'malformed token');
      const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
      if (expected.length !== s.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(s)))
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'bad signature');
      const c = JSON.parse(Buffer.from(p, 'base64url').toString());
      if (c.iss !== issuer) throw new OAuthError(OAuthErrorCode.InvalidToken, 'wrong issuer');
      if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now()) throw new OAuthError(OAuthErrorCode.InvalidToken, 'expired');
      return {
        token, clientId: String(c.azp ?? 'unknown'), scopes: String(c.scope ?? '').split(' ').filter(Boolean),
        expiresAt: c.exp, resource: new URL(c.aud),        // compared with expectedResource by the SDK
        extra: { sub: c.sub, namespaces: c.namespaces ?? [] },
      };
    },
  };
}
// [END verifier]
