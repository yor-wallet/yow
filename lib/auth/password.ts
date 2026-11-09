import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | null = null;

/** Compare against a throwaway hash so unknown emails take as long as wrong passwords (no user enumeration by timing). */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= bcrypt.hash('doom-timing-equaliser', BCRYPT_COST);
  await bcrypt.compare(plain, await dummyHash);
}
