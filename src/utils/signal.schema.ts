import { z } from 'zod';
import { labelsOf, type SignalEntry } from './guidance.schema.ts';
import { HISTORY_SUPPORT, MISSING_INFORMATION, PERSONAL_RISK, PURPOSE_CLARITY } from './signal.ts';

/**
 * The signal enums, derived from the tables in `signal.ts` — same pattern as
 * the account codes: the value the model may emit and the instruction for
 * when to emit it come from one array and cannot drift apart.
 */

export const HistorySupportSchema = z.enum(labelsOf(HISTORY_SUPPORT));
export type HistorySupport = z.infer<typeof HistorySupportSchema>;

export const PurposeClaritySchema = z.enum(labelsOf(PURPOSE_CLARITY));
export type PurposeClarity = z.infer<typeof PurposeClaritySchema>;

export const PersonalRiskSchema = z.enum(labelsOf(PERSONAL_RISK));
export type PersonalRisk = z.infer<typeof PersonalRiskSchema>;

export const MissingInformationSchema = z.enum(labelsOf(MISSING_INFORMATION));
export type MissingInformation = z.infer<typeof MissingInformationSchema>;

/**
 * The entry behind a selected label — how `triage.ts` reads the policy flags
 * off a model-reported value.
 */
export const signalEntry = <T extends readonly SignalEntry[]>(
  table: T,
  label: T[number]['label'],
): SignalEntry => {
  const entry = table.find((candidate) => candidate.label === label);
  if (entry === undefined) throw new Error(`Unknown signal label: ${label}`);
  return entry;
};
