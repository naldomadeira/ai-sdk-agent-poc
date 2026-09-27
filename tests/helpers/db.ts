import { afterAll, beforeEach } from "vitest";
import type { AppContext } from "@/application/context";
import type { Principal } from "@/domain/auth/principal";
import { appPool, closePools, createDatabase } from "@/infrastructure/db/pool";
import { seed, STAFF } from "@/infrastructure/db/seed";

/** Instante fixo usado pelo seed e pelos use cases nos testes. */
export const NOW = new Date();

export const db = createDatabase(appPool());
export const ctx: AppContext = { db, now: () => NOW };

export const principals: Record<"manager" | "support" | "viewer", Principal> = {
  manager: { ...STAFF[0] },
  support: { ...STAFF[1] },
  viewer: { ...STAFF[2] },
};

/** Reseed antes de cada teste: cada teste parte do mesmo estado conhecido. */
export function withSeededDatabase() {
  beforeEach(async () => {
    await seed(db, NOW);
  });
  // Pools vivem em globalThis (compartilhado entre arquivos no mesmo worker): fecha e esquece.
  afterAll(async () => {
    await closePools();
  });
}
