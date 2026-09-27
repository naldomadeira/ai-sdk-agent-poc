/**
 * Fase 12 — roda a matriz de avaliação e grava os resultados normalizados.
 *   pnpm eval               # modo mock (sem LLM, reproduzível)
 *   pnpm eval:real          # LLM real (consome tokens)
 *   pnpm eval -- EVAL-04    # só alguns casos
 *   pnpm eval:real --repeat 5   # taxa de aprovação por caso (o modelo real não é determinístico)
 * Usa o banco de teste (commerce_test), recriado no início. Nunca toca o banco de dev.
 * Saída: evaluation/results/<modo>.json e <modo>.md
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

// Redireciona para o banco de teste ANTES de qualquer import que leia env().
const toTestDb = (url: string) => Object.assign(new URL(url), { pathname: "/commerce_test" }).toString();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? toTestDb(process.env.DATABASE_URL!);
process.env.DATABASE_READONLY_URL = process.env.TEST_DATABASE_READONLY_URL ?? toTestDb(process.env.DATABASE_READONLY_URL!);

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appPool, closePools } from "../src/infrastructure/db/pool";
import { dropAll, migrate } from "../src/infrastructure/db/migrate";
import { EVALUATION_CASES } from "../evaluation/cases";
import { runAll, toMarkdown } from "../evaluation/harness";
import type { EvalMode } from "../evaluation/types";

async function main() {
  const args = process.argv.slice(2);
  const mode: EvalMode = args.includes("--real") ? "real" : "mock";
  const only = args.filter((a) => a.startsWith("EVAL-"));
  const cases = only.length ? EVALUATION_CASES.filter((c) => only.includes(c.id)) : EVALUATION_CASES;
  if (mode === "real" && !process.env.ANTHROPIC_API_KEY) throw new Error("modo real exige ANTHROPIC_API_KEY");
  // Quieta o audit logger no console durante a avaliação.
  console.info = () => {};
  // Erros esperados (ex.: assinatura inválida no EVAL-09) viram uma linha, sem stack.
  const logError = console.error;
  console.error = (...a: unknown[]) => logError("     [log]", ...a.map((x) => (x instanceof Error ? `${x.name}: ${x.message.slice(0, 120)}` : x)));

  await dropAll(appPool());
  await migrate(appPool(), process.env.DATABASE_READONLY_URL!, () => {});

  const repeatIndex = args.indexOf("--repeat");
  const repeat = repeatIndex >= 0 ? Math.max(1, Number(args[repeatIndex + 1]) || 1) : 1;

  console.log(`Fase 12 — ${cases.length} caso(s), modo ${mode}${mode === "real" ? ` (${process.env.AI_MODEL})` : ""}${repeat > 1 ? `, ${repeat} rodadas` : ""}\n`);
  const rounds: Awaited<ReturnType<typeof runAll>>[] = [];
  for (let round = 1; round <= repeat; round++) {
    if (repeat > 1) console.log(`— rodada ${round}/${repeat}`);
    rounds.push(await runAll(cases, mode, (r) => {
      const failed = r.checks.filter((c) => c.status === "fail").map((c) => c.name);
      console.log(`${r.passed ? "✅" : r.error ? "💥" : "❌"} ${r.caseId} ${r.category} (${r.durationMs}ms)${failed.length ? `\n     falhou: ${failed.join("; ")}` : ""}${r.error ? `\n     erro: ${r.error.split("\n")[0]}` : ""}`);
    }));
  }
  const results = rounds[rounds.length - 1];
  const passRate = cases.map((c) => ({
    caseId: c.id,
    passed: rounds.filter((round) => round.find((r) => r.caseId === c.id)?.passed).length,
    runs: rounds.length,
  }));

  const dir = path.join(process.cwd(), "evaluation", "results");
  await mkdir(dir, { recursive: true });
  const suffix = only.length ? `-${only.join("_")}` : "";
  const meta = { generatedAt: new Date().toISOString(), mode, model: mode === "real" ? process.env.AI_MODEL : "scripted-mock", repeat };
  const rateTable = repeat > 1
    ? `\n\n## Taxa de aprovação (${repeat} rodadas)\n\n| Caso | Aprovado |\n| --- | --- |\n${passRate.map((p) => `| ${p.caseId} | ${p.passed}/${p.runs} |`).join("\n")}\n\nTabela acima: última rodada.`
    : "";
  await writeFile(path.join(dir, `${mode}${suffix}.json`), JSON.stringify({ ...meta, passRate, results, rounds: repeat > 1 ? rounds : undefined }, null, 2));
  await writeFile(path.join(dir, `${mode}${suffix}.md`), `# Resultado — modo ${mode}\n\nGerado em ${meta.generatedAt} · modelo: ${meta.model}${rateTable}\n\n${toMarkdown(results)}\n`);
  console.log(`\n${results.filter((r) => r.passed).length}/${results.length} aprovados → evaluation/results/${mode}${suffix}.{json,md}`);
  await closePools();
}

main().catch(async (error) => {
  console.error(error);
  await closePools();
  process.exit(1);
});
