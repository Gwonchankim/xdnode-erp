import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinanceAlertReportSnapshot } from "../app/finance-alert-reporting-model.ts";

const row = (id, priority, dueDate, resolution = "") => ({
  id, task_id: `task-${id}`, title_snapshot: `경보 ${id}`, priority_snapshot: priority,
  owner_employee_id: "gc.kim", due_date: dueDate, source_destination: "finance:quality",
  created_at: 100, resolution_summary: resolution, evidence_count: 1,
});

test("alert reporting reconstructs review, closure and reopen state from append-only events", () => {
  const snapshot = deriveFinanceAlertReportSnapshot(
    [row("high-review", "HIGH", "2026-08-13"), row("normal-closed", "NORMAL", "2026-08-15", "종료 확인"), row("critical-reopened", "CRITICAL", "2026-08-10")],
    [
      { case_id: "high-review", action: "ACTION_SAVED", created_at: 200 },
      { case_id: "high-review", action: "REVIEW_REQUESTED", created_at: 300 },
      { case_id: "normal-closed", action: "CLOSURE_APPROVED", created_at: 250 },
      { case_id: "critical-reopened", action: "CLOSURE_APPROVED", created_at: 220 },
      { case_id: "critical-reopened", action: "CASE_REOPENED", created_at: 350 },
    ],
    "2026-08-14", "2026-08-14T12:00:00.000Z",
  );
  assert.equal(snapshot.totalCount, 3);
  assert.equal(snapshot.unresolvedCount, 2);
  assert.equal(snapshot.highCriticalUnresolvedCount, 2);
  assert.equal(snapshot.reviewCount, 1);
  assert.equal(snapshot.closedCount, 1);
  assert.equal(snapshot.overdueCount, 2);
  assert.deepEqual(snapshot.items.map((item) => [item.id, item.status]), [
    ["critical-reopened", "IN_PROGRESS"], ["high-review", "REVIEW"], ["normal-closed", "CLOSED"],
  ]);
  assert.equal(snapshot.items.find((item) => item.id === "normal-closed")?.resolutionSummary, "종료 확인");
  assert.equal(snapshot.items.find((item) => item.id === "critical-reopened")?.resolutionSummary, "");
});

test("an alert due on the cutoff date is not classified as overdue", () => {
  const snapshot = deriveFinanceAlertReportSnapshot([row("today", "LOW", "2026-08-14")], [], "2026-08-14");
  assert.equal(snapshot.overdueCount, 0);
  assert.equal(snapshot.items[0].status, "OPEN");
});
