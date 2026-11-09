import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * Short-lived signed tokens (HS256, SESSION_SECRET) for stateless use cases:
 * signed download links (receipts), email verification, payment return URLs.
 * NOT used for sessions (sessions are opaque random tokens stored hashed in DB).
 */

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (>= 32 chars)');
  return new TextEncoder().encode(s);
}

export async function signToken<T extends JWTPayload>(
  payload: T,
  opts: { purpose: string; expiresIn: string | number; subject?: string },
): Promise<string> {
  const jwt = new SignJWT({ ...payload, pur: opts.purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('doom')
    .setExpirationTime(opts.expiresIn);
  if (opts.subject) jwt.setSubject(opts.subject);
  return jwt.sign(secret());
}

/** Returns the payload, or null when invalid/expired/wrong purpose. */
export async function verifyToken<T extends JWTPayload>(token: string, purpose: string): Promise<(T & { pur: string }) | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'doom', algorithms: ['HS256'] });
    if (payload.pur !== purpose) return null;
    return payload as T & { pur: string };
  } catch {
    return null;
  }
}
