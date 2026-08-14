import { ensureFinanceAlertActionSchema } from "./finance-alert-actions-server";
import { deriveFinanceAlertReportSnapshot } from "./finance-alert-reporting-model";
import type { FinanceAlertCaseSnapshotRow, FinanceAlertEventSnapshotRow, FinanceAlertReportSnapshot } from "./finance-alert-reporting-model";
export type { FinanceAlertReportItem, FinanceAlertReportSnapshot } from "./finance-alert-reporting-model";

function cutoffTimestamp(cutoffDate: string) {
  return new Date(`${cutoffDate}T23:59:59.999+09:00`).getTime();
}

export async function buildFinanceAlertReportSnapshot(db: D1Database, cutoffDate: string): Promise<FinanceAlertReportSnapshot> {
  await ensureFinanceAlertActionSchema(db);
  const cutoffAt = cutoffTimestamp(cutoffDate);
  const [cases, events] = await Promise.all([
    db.prepare(`SELECT alert.id, alert.task_id, alert.title_snapshot, alert.priority_snapshot,
      alert.owner_employee_id, alert.due_date, alert.source_destination, alert.created_at,
      alert.resolution_summary, (SELECT COUNT(*) FROM erp_documents document
        WHERE document.module = 'finance' AND document.entity_type = 'financeAlertCase'
          AND document.entity_id = alert.id AND document.deleted_at IS NULL
          AND document.created_at <= ?) AS evidence_count
      FROM finance_alert_cases alert WHERE alert.created_at <= ?`)
      .bind(cutoffAt, cutoffAt).all<FinanceAlertCaseSnapshotRow>(),
    db.prepare(`SELECT case_id, action, created_at FROM finance_alert_case_events
      WHERE created_at <= ? ORDER BY created_at`).bind(cutoffAt).all<FinanceAlertEventSnapshotRow>(),
  ]);
  return deriveFinanceAlertReportSnapshot(cases.results, events.results, cutoffDate);
}
