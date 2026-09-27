export type DomainErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "APPROVAL_REQUIRED";

/**
 * Erro de regra de negócio. A camada de capabilities o converte em resultado estruturado
 * para o agente — que então explica ao usuário por que a ação não aconteceu.
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (entity: string, id: unknown) =>
  new DomainError("NOT_FOUND", `${entity} ${String(id)} não encontrado`, { entity, id });

export const invalidState = (message: string, details?: Record<string, unknown>) =>
  new DomainError("INVALID_STATE", message, details);

export const invalidInput = (message: string, details?: Record<string, unknown>) =>
  new DomainError("INVALID_INPUT", message, details);
