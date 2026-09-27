"use client";

import { switchUser } from "@/app/actions";
import type { Principal } from "@/domain/auth/principal";

export function UserSwitcher({ current, staff }: { current: string; staff: Principal[] }) {
  return (
    <form action={switchUser} className="flex items-center gap-2 text-sm">
      <label htmlFor="userId" className="text-muted">
        Usuário (simulado)
      </label>
      <select
        id="userId"
        name="userId"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-border bg-surface px-2 py-1"
      >
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </form>
  );
}
