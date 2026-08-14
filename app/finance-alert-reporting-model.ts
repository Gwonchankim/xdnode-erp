export type FinanceAlertReportItem = {
  id: string; taskId: string; title: string; priority: string;
  status: "OPEN" | "IN_PROGRESS" | "REVIEW" | "CLOSED";
  ownerEmployeeId: string; dueDate: string; destination: string;
  evidenceCount: number; lastActionAt: number; resolutionSummary: string;
};
export type FinanceAlertReportSnapshot = {
  cutoffDate: string; capturedAt: string; totalCount: number; unresolvedCount: number;
  highCriticalUnresolvedCount: number; reviewCount: number; closedCount: number;
  overdueCount: number; items: FinanceAlertReportItem[];
};
export type FinanceAlertCaseSnapshotRow = {
  id: string; task_id: string; title_snapshot: string; priority_snapshot: string;
  owner_employee_id: string; due_date: string; source_destination: string; created_at: number;
  resolution_summary: string; evidence_count: number;
};
export type FinanceAlertEventSnapshotRow = { case_id: string; action: string; created_at: number };

const eventStatus: Record<string, FinanceAlertReportItem["status"]> = {
  ACTION_SAVED: "IN_PROGRESS", REVIEW_REQUESTED: "REVIEW", REVIEW_REJECTED: "IN_PROGRESS",
  CLOSURE_APPROVED: "CLOSED", CASE_REOPENED: "IN_PROGRESS",
};
const priorityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export function deriveFinanceAlertReportSnapshot(
  cases: FinanceAlertCaseSnapshotRow[], events: FinanceAlertEventSnapshotRow[], cutoffDate: string, capturedAt = new Date().toISOString(),
): FinanceAlertReportSnapshot {
  const eventsByCase = new Map<string, FinanceAlertEventSnapshotRow[]>();
  for (const event of events) {
    const current = eventsByCase.get(event.case_id) ?? [];
    current.push(event); eventsByCase.set(event.case_id, current);
  }
  const items = cases.map((row): FinanceAlertReportItem => {
    const caseEvents = (eventsByCase.get(row.id) ?? []).sort((a, b) => a.created_at - b.created_at);
    const status = caseEvents.reduce<FinanceAlertReportItem["status"]>((current, event) => eventStatus[event.action] ?? current, "OPEN");
    return {
      id: row.id, taskId: row.task_id, title: row.title_snapshot, priority: row.priority_snapshot,
      status, ownerEmployeeId: row.owner_employee_id, dueDate: row.due_date,
      destination: row.source_destination, evidenceCount: Number(row.evidence_count ?? 0),
      lastActionAt: caseEvents.at(-1)?.created_at ?? row.created_at,
      resolutionSummary: status === "CLOSED" ? row.resolution_summary : "",
    };
  }).sort((a, b) => {
    if ((a.status === "CLOSED") !== (b.status === "CLOSED")) return a.status === "CLOSED" ? 1 : -1;
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
      || a.dueDate.localeCompare(b.dueDate) || b.lastActionAt - a.lastActionAt;
  });
  const unresolved = items.filter((item) => item.status !== "CLOSED");
  return {
    cutoffDate, capturedAt, totalCount: items.length, unresolvedCount: unresolved.length,
    highCriticalUnresolvedCount: unresolved.filter((item) => ["HIGH", "CRITICAL"].includes(item.priority)).length,
    reviewCount: unresolved.filter((item) => item.status === "REVIEW").length,
    closedCount: items.filter((item) => item.status === "CLOSED").length,
    overdueCount: unresolved.filter((item) => Boolean(item.dueDate) && item.dueDate < cutoffDate).length,
    items,
  };
}
