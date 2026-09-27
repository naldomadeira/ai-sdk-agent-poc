import "server-only";
import { cookies } from "next/headers";
import type { Principal } from "@/domain/auth/principal";
import { appPool } from "@/infrastructure/db/pool";
import { staffRepository } from "@/infrastructure/db/repositories/staff-repository";

export const USER_COOKIE = "poc_user";
const DEFAULT_USER = "u_bruno";

/**
 * Autenticação SIMULADA da POC: o usuário é escolhido num seletor e guardado em cookie.
 * Em produção isto vem da sessão real (Auth.js, SSO...). O que importa para a arquitetura:
 * o principal é resolvido no servidor e carregado do banco — nunca informado pelo LLM.
 */
export async function currentPrincipal(): Promise<Principal | null> {
  const id = (await cookies()).get(USER_COOKIE)?.value ?? DEFAULT_USER;
  return staffRepository.findById(appPool(), id);
}
