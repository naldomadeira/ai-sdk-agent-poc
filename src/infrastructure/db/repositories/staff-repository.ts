import type { Principal } from "@/domain/auth/principal";
import type { Queryable } from "../pool";

export const staffRepository = {
  async findById(db: Queryable, id: string): Promise<Principal | null> {
    const { rows } = await db.query<Principal>("SELECT id, name, role FROM staff_users WHERE id = $1", [id]);
    return rows[0] ?? null;
  },

  async list(db: Queryable): Promise<Principal[]> {
    const { rows } = await db.query<Principal>("SELECT id, name, role FROM staff_users ORDER BY id");
    return rows;
  },
};
