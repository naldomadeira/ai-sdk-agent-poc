import type { Database } from "@/infrastructure/db/pool";

/** Dependências dos use cases. `now` é injetável para testes determinísticos. */
export interface AppContext {
  db: Database;
  now: () => Date;
}
