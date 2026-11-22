export * from "./schemas";
export * from "./config";
export * from "./quizzes";
export * from "./glossary";
export * from "./commerce";
export * from "./lessons";
import { FEE_CONFIGS, SCENARIOS } from "./config";
import { QUIZZES } from "./quizzes";
import { GLOSSARY } from "./glossary";
import { feeConfigSchema, glossarySchema, quizSchema, scenarioSchema, validateAll } from "./schemas";

/** Validate the whole content layer (run in tests / at boot in dev). */
export function validateContent(): { scenarios: number; quizzes: number; glossary: number } {
  const s = validateAll(scenarioSchema, SCENARIOS, "scenario");
  const q = validateAll(quizSchema, QUIZZES, "quiz");
  const g = validateAll(glossarySchema, GLOSSARY, "glossary");
  for (const f of FEE_CONFIGS) feeConfigSchema.parse(f);
  return { scenarios: s.length, quizzes: q.length, glossary: g.length };
}

export function scenariosFor(moduleId: string) {
  return SCENARIOS.filter((s) => s.moduleId === moduleId);
}

export function quizzesFor(moduleId: string) {
  return QUIZZES.filter((q) => q.moduleId === moduleId);
}

export function conceptDef(id: string | undefined) {
  if (!id) return undefined;
  return GLOSSARY.find((g) => g.id === id);
}
