"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appPool } from "@/infrastructure/db/pool";
import { staffRepository } from "@/infrastructure/db/repositories/staff-repository";
import { USER_COOKIE } from "./session";

/** Troca o usuário simulado. Só aceita ids existentes em staff_users. */
export async function switchUser(formData: FormData) {
  const id = String(formData.get("userId") ?? "");
  const user = await staffRepository.findById(appPool(), id);
  if (!user) throw new Error("Usuário inexistente");
  (await cookies()).set(USER_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}
