/**
 * AuthManager
 *
 * Handles authentication for the YIC CMS author environment.
 * Supports local credentials, SSO/SAML, OAuth2/OIDC, and API key auth.
 * Issues short-lived JWTs with refresh token rotation.
 */

const crypto = require('crypto');

class AuthManager {
  constructor(opts = {}) {
    this._secret = opts.secret ?? crypto.randomBytes(32).toString('hex');
    this._tokenTTL = opts.tokenTTL ?? 3600;        // seconds
    this._refreshTTL = opts.refreshTTL ?? 86_400 * 7; // 7 days
    this._providers = new Map();
    this._sessions = new Map();
    this._apiKeys = new Map();
    this._rateLimiter = new Map();  // ip → { count, window }
  }

  // ── Provider registration ─────────────────────────────────────────────────────

  /** Register an auth provider plugin (e.g. SAMLProvider, OIDCProvider). */
  addProvider(name, provider) {
    if (typeof provider.authenticate !== 'function') {
      throw new TypeError('Auth provider must implement authenticate(credentials): Promise<Principal>');
    }
    this._providers.set(name, provider);
    return this;
  }

  // ── API keys ──────────────────────────────────────────────────────────────────

  issueApiKey(principal, opts = {}) {
    const key = 'yic_' + crypto.randomBytes(24).toString('hex');
    this._apiKeys.set(key, {
      principal,
      scopes: opts.scopes ?? ['read'],
      expiresAt: opts.expiresAt ?? null,
      description: opts.description ?? '',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    return key;
  }

  revokeApiKey(key) {
    return this._apiKeys.delete(key);
  }

  validateApiKey(key) {
    const entry = this._apiKeys.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > new Date(entry.expiresAt).getTime()) {
      this._apiKeys.delete(key);
      return null;
    }
    entry.lastUsedAt = new Date().toISOString();
    return entry.principal;
  }

  // ── JWT ───────────────────────────────────────────────────────────────────────

  _sign(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', this._secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  _verify(token) {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expected = crypto.createHmac('sha256', this._secret).update(`${header}.${body}`).digest('base64url');
    if (expected !== sig) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (payload.exp && Date.now() / 1000 > payload.exp) return null;
      return payload;
    } catch { return null; }
  }

  issueToken(principal) {
    const now = Math.floor(Date.now() / 1000);
    const token = this._sign({
      sub: principal.id,
      email: principal.email,
      roles: principal.roles,
      iat: now,
      exp: now + this._tokenTTL,
    });
    const refreshToken = crypto.randomBytes(32).toString('hex');
    this._sessions.set(refreshToken, {
      principal,
      expiresAt: Date.now() + this._refreshTTL * 1000,
      createdAt: Date.now(),
    });
    return { token, refreshToken, expiresIn: this._tokenTTL };
  }

  refresh(refreshToken) {
    const session = this._sessions.get(refreshToken);
    if (!session || Date.now() > session.expiresAt) {
      this._sessions.delete(refreshToken);
      throw new Error('Invalid or expired refresh token');
    }
    // Rotate refresh token
    this._sessions.delete(refreshToken);
    return this.issueToken(session.principal);
  }

  // ── Authentication ────────────────────────────────────────────────────────────

  /**
   * Authenticate a request using the first matching strategy:
   * Bearer JWT → API key → provider-specific credentials.
   * @param {object} req  { headers, body, ip }
   * @returns {Promise<Principal | null>}
   */
  async authenticate(req) {
    // Rate limiting
    if (this._isRateLimited(req.ip)) throw Object.assign(new Error('Too many requests'), { status: 429 });

    const authHeader = req.headers?.['authorization'] ?? '';

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      // Check API key first (they start with 'yic_')
      if (token.startsWith('yic_')) {
        const principal = this.validateApiKey(token);
        if (principal) return principal;
        return null;
      }

      // JWT
      const payload = this._verify(token);
      return payload ? { id: payload.sub, email: payload.email, roles: payload.roles } : null;
    }

    // Provider-based auth (e.g. username/password, SSO)
    if (req.body?.provider) {
      const provider = this._providers.get(req.body.provider);
      if (!provider) throw new Error(`Unknown auth provider: ${req.body.provider}`);
      return provider.authenticate(req.body.credentials);
    }

    return null;
  }

  _isRateLimited(ip) {
    if (!ip) return false;
    const now = Date.now();
    const entry = this._rateLimiter.get(ip) ?? { count: 0, window: now };
    if (now - entry.window > 60_000) { entry.count = 0; entry.window = now; }
    entry.count++;
    this._rateLimiter.set(ip, entry);
    return entry.count > 100;
  }
}

module.exports = new AuthManager();
