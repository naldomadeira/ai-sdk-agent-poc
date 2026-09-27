import { cancelOrder, refundPayment, sendCustomerNotification } from "./actions/action-capabilities";
import type { Capability } from "./capability";
import { inspectSchema, queryDatabase } from "./database/read-capabilities";
import { prepareLateOrderNotifications, sendPreparedNotifications } from "./workflows/workflow-capabilities";

/**
 * Todas as capabilities da aplicação. É a única lista que os adaptadores (AI SDK, MCP) leem:
 * adicionar uma capability aqui a expõe a todos os canais, com a mesma autorização e auditoria.
 */
export const capabilities: readonly Capability[] = [
  // leitura genérica
  inspectSchema,
  queryDatabase,
  // domain actions
  cancelOrder,
  refundPayment,
  sendCustomerNotification,
  // workflows
  prepareLateOrderNotifications,
  sendPreparedNotifications,
];
