"""Access-token verification for the remote (Streamable HTTP) transport.

Protocol facts (MCP authorization spec, revisions 2025-11-25 and 2026-07-28):
* The MCP server is an OAuth 2.1 *resource server*. It does not issue tokens.
* It MUST validate that a token was issued for it (audience / RFC 8707 resource).
* It MUST NOT accept tokens meant for other services, and MUST NOT pass the
  client's token through to upstream APIs.
* stdio servers do not use this flow; they take credentials from the environment.

This module verifies JWT access tokens from any OIDC/OAuth provider that
publishes a JWKS (Keycloak, Entra ID, Okta, Auth0, Cognito ...).
"""
from __future__ import annotations

import os

import jwt
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings


# [START verifier]
class JWTVerifier(TokenVerifier):
    """Validates signature, issuer, audience and expiry; maps scope + claims."""

    def __init__(self, issuer: str, audience: str, jwks_url: str | None = None,
                 hs256_secret: str | None = None) -> None:
        self.issuer, self.audience = issuer, audience
        self._jwks = jwt.PyJWKClient(jwks_url, cache_keys=True) if jwks_url else None
        self._secret = hs256_secret  # ONLY for local tests; never in production

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            if self._jwks:
                key = self._jwks.get_signing_key_from_jwt(token).key
                algs = ["RS256", "ES256"]
            else:
                key, algs = self._secret, ["HS256"]
            claims = jwt.decode(token, key, algorithms=algs, audience=self.audience, issuer=self.issuer,
                                options={"require": ["exp", "iss", "aud", "sub"]})
        except jwt.PyJWTError:
            return None  # SDK answers 401 + WWW-Authenticate pointing at our metadata
        return AccessToken(
            token=token,
            client_id=str(claims.get("azp") or claims.get("client_id") or "unknown"),
            scopes=str(claims.get("scope", "")).split(),
            expires_at=int(claims["exp"]),
            resource=self.audience,       # we checked aud == our canonical URL above
            subject=str(claims["sub"]),
            claims=claims,                # e.g. tenant, namespaces -> used by policy.py
        )
# [END verifier]


# [START settings]
def auth_kwargs() -> dict:
    """MCPServer(...) keyword arguments when ATLAS_AUTH=jwt, else {} (local / stdio)."""
    if os.environ.get("ATLAS_AUTH") != "jwt":
        return {}
    public_url = os.environ["ATLAS_PUBLIC_URL"]            # e.g. https://mcp.example.com/mcp
    issuer = os.environ["ATLAS_OAUTH_ISSUER"]              # e.g. https://login.example.com/realms/atlas
    return {
        "token_verifier": JWTVerifier(issuer=issuer, audience=public_url,
                                      jwks_url=os.environ.get("ATLAS_OAUTH_JWKS_URL"),
                                      hs256_secret=os.environ.get("ATLAS_DEV_HS256_SECRET")),
        "auth": AuthSettings(
            issuer_url=issuer,               # advertised in Protected Resource Metadata (RFC 9728)
            resource_server_url=public_url,  # canonical resource identifier
            required_scopes=["atlas.read"],  # every request needs at least this scope
            validate_token_resource=False,   # our verifier already enforces aud
        ),
    }
# [END settings]
