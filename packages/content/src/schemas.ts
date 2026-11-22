import { z } from "zod";

/** All content schemas. Scenarios/quizzes/glossary are validated at load. */

export const scenarioSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  titleKey: z.string(),
  objectivesKeys: z.array(z.string()),
  preset: z.object({
    params: z.record(z.unknown()).default({}),
    seed: z.number().int()
  }),
  expectedEvents: z.array(z.string()),
  talkingPointsKeys: z.array(z.string()),
  discussionKeys: z.array(z.string())
});
export type ScenarioDef = z.infer<typeof scenarioSchema>;

const i18nText = z.object({
  en: z.string(),
  fr: z.string().optional(),
  ar: z.string().optional()
});

export const quizSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  kind: z.enum(["mcq", "prediction", "ordering", "match"]),
  questionKey: z.string(),
  optionsKeys: z.array(z.string()).default([]),
  answerKey: z.string(),
  explanationKey: z.string(),
  /** Inline EN text (FR/AR filled for Tier A UI strings; quizzes fall back to EN) */
  text: z.object({
    q: i18nText,
    options: z.array(i18nText).default([]),
    answer: z.string(),
    explanation: i18nText
  })
});
export type QuizDef = z.infer<typeof quizSchema>;

export const glossarySchema = z.object({
  id: z.string(),
  termKey: z.string(),
  defKey: z.string(),
  term: i18nText,
  def: i18nText
});
export type GlossaryDef = z.infer<typeof glossarySchema>;

export const feeConfigSchema = z.object({
  moduleId: z.string(),
  illustrative: z.literal(true),
  rules: z.array(
    z.object({
      id: z.string(),
      labelKey: z.string(),
      fixedMinor: z.number().int().min(0),
      pctBps: z.number().int().min(0),
      payer: z.string(),
      payee: z.string()
    })
  )
});

export function validateAll<T>(schema: z.ZodType<T>, items: unknown[], label: string): T[] {
  return items.map((x, i) => {
    const r = schema.safeParse(x);
    if (!r.success) throw new Error(`${label}[${i}]: ${r.error.message}`);
    return r.data;
  });
}
