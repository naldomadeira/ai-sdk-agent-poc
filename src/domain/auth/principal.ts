import { DomainError } from "../shared/errors";

export type Role = "viewer" | "support" | "manager";

/** Quem está agindo. Sempre vem da sessão autenticada no servidor — nunca do LLM. */
export interface Principal {
  id: string;
  name: string;
  role: Role;
}

export type Permission =
  | "data:read"
  | "orders:cancel"
  | "notifications:send"
  | "workflows:late-orders"
  | "payments:refund";

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: ["data:read"],
  support: ["data:read", "orders:cancel", "notifications:send", "workflows:late-orders"],
  manager: ["data:read", "orders:cancel", "notifications:send", "workflows:late-orders", "payments:refund"],
};

export function can(principal: Principal, permission: Permission): boolean {
  return ROLE_PERMISSIONS[principal.role]?.includes(permission) ?? false;
}

export function assertCan(principal: Principal, permission: Permission): void {
  if (!can(principal, permission)) {
    throw new DomainError(
      "FORBIDDEN",
      `${principal.name} (${principal.role}) não tem a permissão ${permission}`,
      { permission, role: principal.role },
    );
  }
}
