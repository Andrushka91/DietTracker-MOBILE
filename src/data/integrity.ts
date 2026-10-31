// Integrity checker (spec 5.9) - read-only, exposed in Settings ->
// "Check integrity". Verifies:
//   (a) all five categories exist
//   (b) one slot per profile/date/category (unique index sanity)
//   (c) no orphaned photographs
//   (d) completion state consistency (CompletedAt <-> Status)
//   (e) row/index sanity (PRAGMA integrity_check)
// Reports OK or a count plus stable issue codes.

import { queryAll, queryOne } from './database';
import { getCategories } from './repositories';
import { findMissingSlots } from '../domain/rules/mealSlotRules';

export interface IntegrityIssue {
  /** Stable code, surfaced as-is when localized text is not needed. */
  code: string;
  description: string;
  entityId?: string;
}

export interface IntegrityReport {
  ok: boolean;
  issues: IntegrityIssue[];
}

export async function checkIntegrity(): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];

  // (a) the five permanent slots exist.
  const categories = await getCategories();
  for (const key of findMissingSlots(categories)) {
    issues.push({
      code: 'integrity.category.missing',
      description: `Permanent meal slot ${key} has no category row.`,
    });
  }

  // (b) duplicate slot rows (only possible if the unique index was lost).
  const duplicates = await queryAll(
    `SELECT LocalProfileId, Date, MealCategoryKey, COUNT(*) AS c
     FROM MealEntry
     GROUP BY LocalProfileId, Date, MealCategoryKey
     HAVING c > 1;`,
    [],
    (r) => ({
      entityId: `${String(r.LocalProfileId)}/${String(r.Date)}/${String(r.MealCategoryKey)}`,
    }),
  );
  for (const duplicate of duplicates) {
    issues.push({
      code: 'integrity.slot.duplicate',
      description: 'More than one entry exists for the same profile/date/slot.',
      entityId: duplicate.entityId,
    });
  }

  // (c) orphaned photographs (parent meal missing).
  const orphans = await queryAll(
    `SELECT p.Id AS photoId FROM MealPhoto p
     LEFT JOIN MealEntry e ON e.Id = p.MealEntryId
     WHERE e.Id IS NULL;`,
    [],
    (r) => ({ photoId: String(r.photoId) }),
  );
  for (const orphan of orphans) {
    issues.push({
      code: 'integrity.photo.orphan',
      description: 'A photograph references a meal that does not exist.',
      entityId: orphan.photoId,
    });
  }

  // (d) completion state consistency.
  const inconsistent = await queryAll(
    `SELECT Id FROM MealEntry
     WHERE (Status = 1 AND CompletedAt IS NULL)
        OR (Status <> 1 AND CompletedAt IS NOT NULL);`,
    [],
    (r) => ({ id: String(r.Id) }),
  );
  for (const entry of inconsistent) {
    issues.push({
      code: 'integrity.completion.mismatch',
      description: 'Completion timestamp does not match the stored status.',
      entityId: entry.id,
    });
  }

  // (e) SQLite's own row/index sanity check.
  const check = await queryOne('PRAGMA integrity_check;', [], (r) => {
    const first = Object.values(r)[0];
    return typeof first === 'string' ? first : String(first);
  });
  if (check !== null && check !== 'ok') {
    issues.push({
      code: 'integrity.sqlite.failed',
      description: `PRAGMA integrity_check: ${check}`,
    });
  }

  return { ok: issues.length === 0, issues };
}