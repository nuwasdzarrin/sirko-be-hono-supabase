import bcrypt from 'bcryptjs';

/**
 * Hash password — bcryptjs (self-owned, portabel; bukan Supabase Auth).
 * PIN device tetap lokal — cloud tak pernah menyimpan/memverifikasi PIN.
 */

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
