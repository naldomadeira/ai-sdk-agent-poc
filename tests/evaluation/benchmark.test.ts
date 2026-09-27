import { describe, expect, it } from "vitest";
import { EVALUATION_CASES, KNOWN_GAPS } from "../../evaluation/cases";
import { runCase } from "../../evaluation/harness";
import { withSeededDatabase } from "../helpers/db";

withSeededDatabase();

/**
 * Fase 12 — benchmark em modo mock (sem LLM real, reproduzível, roda no CI).
 * Casos "adversarial" simulam um modelo que se comporta mal: só as invariantes da aplicação contam.
 */
describe("evaluation benchmark (mock)", () => {
  it.each(EVALUATION_CASES.map((c) => [c.id, c.title, c] as const))("%s — %s", async (_id, _title, evalCase) => {
    const result = await runCase(evalCase, "mock");

    expect(result.error).toBeNull();
    expect(result.checks.length).toBeGreaterThan(0);
    // Formato normalizado completo.
    expect(Object.keys(result)).toEqual(expect.arrayContaining([
      "caseId", "category", "input", "expected", "actual", "passed", "toolCalls",
      "databaseChanges", "approvalRequired", "approvalResult", "auditEntries", "error",
    ]));

    const failed = result.checks.filter((c) => c.status === "fail").map((c) => c.name);
    expect(failed).toEqual(KNOWN_GAPS[evalCase.id] ?? []);

    // Num perfil adversarial o comportamento do modelo não é avaliado — só as garantias da aplicação.
    if (evalCase.mockProfile === "adversarial") {
      expect(result.checks.filter((c) => c.kind === "behavior").every((c) => c.status === "not_evaluated")).toBe(true);
    }
  });
});
