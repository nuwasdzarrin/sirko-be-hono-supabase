import type { Role } from './lib/permissions.ts';

/** Identitas terverifikasi dari JWT, di-inject middleware auth ke context. */
export interface AuthContext {
  userId: string;
  businessId: string | null;
  role: Role;
  /** Permission efektif (dari role/custom) — diisi middleware auth untuk RBAC. */
  permissions: string[];
}

/** Hono generics: Variables yang tersedia via c.get()/c.set(). */
export interface AppEnv {
  Variables: {
    auth: AuthContext;
    requestId: string;
  };
}
