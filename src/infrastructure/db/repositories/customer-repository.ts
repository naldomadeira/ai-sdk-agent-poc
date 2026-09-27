import type { Queryable } from "../pool";

export interface Customer {
  id: number;
  name: string;
  email: string;
}

export const customerRepository = {
  async findById(db: Queryable, id: number): Promise<Customer | null> {
    const { rows } = await db.query<Customer>("SELECT id, name, email FROM customers WHERE id = $1", [id]);
    return rows[0] ?? null;
  },
};
