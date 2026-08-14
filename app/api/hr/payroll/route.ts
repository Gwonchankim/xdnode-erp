import { env } from "cloudflare:workers";
import { companyEmployees } from "../../../hr-company-data";
import { payrollSeedRecords } from "../../../payroll-seed-data";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type HrBindings = { DB: D1Database };
const db = (env as unknown as HrBindings).DB;

type PayrollRow = {
  id: string;
  year_month: string;
  employee_id: string | null;
  employee_name: string;
  department: string | null;
  annual_salary: number;
  base_pay: number;
  meal_allowance: number;
  childcare_allowance: number;
  vehicle_allowance: number;
  incentive: number;
  bonus: number;
  annual_leave_pay: number;
  retirement_pay: number;
  deductions: number;
  gross_pay: number;
  net_pay: number;
  card_allowance: number;
  card_usage: number;
  personal_purchase: number;
  non_taxable: number;
  welfare_fund: number;
  notes: string;
  source_sheet: string;
  source_row: number;
};

type PayrollSummaryRow = {
  year_month: string;
  employee_count: number;
  gross_pay: number;
  deductions: number;
  net_pay: number;
  status: string;
  prepared_by: string;
  reviewed_by: string;
  approved_by: string;
  locked_at: number | null;
};

const employeeAliases: Record<string, string> = {
  조수종: "sjcho",
  민경윤: "ky.min",
};

const employeeByName = new Map(companyEmployees.map((employee) => [employee.name, employee]));
const employeeById = new Map(companyEmployees.map((employee) => [employee.id, employee]));

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_records (
      id TEXT PRIMARY KEY,
      year_month TEXT NOT NULL,
      employee_id TEXT,
      employee_name TEXT NOT NULL,
      department TEXT,
      annual_salary INTEGER NOT NULL,
      base_pay INTEGER NOT NULL,
      meal_allowance INTEGER NOT NULL,
      childcare_allowance INTEGER NOT NULL,
      vehicle_allowance INTEGER NOT NULL,
      incentive INTEGER NOT NULL,
      bonus INTEGER NOT NULL,
      annual_leave_pay INTEGER NOT NULL,
      retirement_pay INTEGER NOT NULL,
      deductions INTEGER NOT NULL,
      gross_pay INTEGER NOT NULL,
      net_pay INTEGER NOT NULL,
      card_allowance INTEGER NOT NULL,
      card_usage INTEGER NOT NULL,
      personal_purchase INTEGER NOT NULL,
      non_taxable INTEGER NOT NULL,
      welfare_fund INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      source_sheet TEXT NOT NULL,
      source_row INTEGER NOT NULL,
      imported_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_payroll_records_month_name
      ON hr_payroll_records(year_month, employee_name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_runs (
      period TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', employee_count INTEGER NOT NULL DEFAULT 0,
      gross_pay INTEGER NOT NULL DEFAULT 0, deductions INTEGER NOT NULL DEFAULT 0, net_pay INTEGER NOT NULL DEFAULT 0,
      prepared_by TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '',
      locked_at INTEGER, reopened_reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
  ]);
}

async function syncPayrollRuns() {
  const now = Date.now();
  await db.prepare(`INSERT INTO hr_payroll_runs
    (period, status, employee_count, gross_pay, deductions, net_pay, prepared_by, reviewed_by, approved_by,
      locked_at, reopened_reason, created_at, updated_at)
    SELECT year_month, 'DRAFT', COUNT(*), COALESCE(SUM(gross_pay), 0), COALESCE(SUM(deductions), 0),
      COALESCE(SUM(net_pay), 0), '', '', '', NULL, '', ?, ? FROM hr_payroll_records GROUP BY year_month
    ON CONFLICT(period) DO UPDATE SET employee_count = excluded.employee_count, gross_pay = excluded.gross_pay,
      deductions = excluded.deductions, net_pay = excluded.net_pay, updated_at = excluded.updated_at`)
    .bind(now, now).run();
}

async function seedPayrollRecords() {
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM hr_payroll_records").first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;

  const importedAt = Date.now();
  const statements = payrollSeedRecords.map((record) => {
    const aliasId = employeeAliases[record.employeeName];
    const employee = aliasId ? employeeById.get(aliasId) : employeeByName.get(record.employeeName);
    return db.prepare(`INSERT INTO hr_payroll_records (
      id, year_month, employee_id, employee_name, department, annual_salary, base_pay,
      meal_allowance, childcare_allowance, vehicle_allowance, incentive, bonus,
      annual_leave_pay, retirement_pay, deductions, gross_pay, net_pay,
      card_allowance, card_usage, personal_purchase, non_taxable, welfare_fund,
      notes, source_sheet, source_row, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`).bind(
      record.id,
      record.yearMonth,
      employee?.id ?? null,
      record.employeeName,
      employee?.department ?? null,
      record.annualSalary,
      record.basePay,
      record.mealAllowance,
      record.childcareAllowance,
      record.vehicleAllowance,
      record.incentive,
      record.bonus,
      record.annualLeavePay,
      record.retirementPay,
      record.deductions,
      record.grossPay,
      record.netPay,
      record.cardAllowance,
      record.cardUsage,
      record.personalPurchase,
      record.nonTaxable,
      record.welfareFund,
      record.notes,
      record.sourceSheet,
      record.sourceRow,
      importedAt,
    );
  });

  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

function toRecord(row: PayrollRow) {
  return {
    id: row.id,
    yearMonth: row.year_month,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    department: row.department,
    annualSalary: row.annual_salary,
    basePay: row.base_pay,
    mealAllowance: row.meal_allowance,
    childcareAllowance: row.childcare_allowance,
    vehicleAllowance: row.vehicle_allowance,
    incentive: row.incentive,
    bonus: row.bonus,
    annualLeavePay: row.annual_leave_pay,
    retirementPay: row.retirement_pay,
    deductions: row.deductions,
    grossPay: row.gross_pay,
    netPay: row.net_pay,
    cardAllowance: row.card_allowance,
    cardUsage: row.card_usage,
    personalPurchase: row.personal_purchase,
    nonTaxable: row.non_taxable,
    welfareFund: row.welfare_fund,
    notes: row.notes,
    sourceSheet: row.source_sheet,
    sourceRow: row.source_row,
  };
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "read");
  if (authorization.response) return authorization.response;
  await seedPayrollRecords();
  await syncPayrollRuns();

  const month = new URL(request.url).searchParams.get("month")?.trim();
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: "급여월 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const [recordsResult, summary] = await Promise.all([
      db.prepare(`SELECT * FROM hr_payroll_records
        WHERE year_month = ? ORDER BY employee_name`).bind(month).all<PayrollRow>(),
      db.prepare(`SELECT r.year_month, COUNT(*) AS employee_count,
        COALESCE(SUM(r.gross_pay), 0) AS gross_pay, COALESCE(SUM(r.deductions), 0) AS deductions,
        COALESCE(SUM(r.net_pay), 0) AS net_pay, p.status, p.prepared_by, p.reviewed_by, p.approved_by, p.locked_at
        FROM hr_payroll_records r JOIN hr_payroll_runs p ON p.period = r.year_month
        WHERE r.year_month = ? GROUP BY r.year_month, p.status, p.prepared_by, p.reviewed_by, p.approved_by, p.locked_at`).bind(month).first<PayrollSummaryRow>(),
    ]);
    return Response.json({
      summary: summary ? {
        yearMonth: summary.year_month,
        employeeCount: summary.employee_count,
        grossPay: summary.gross_pay,
        deductions: summary.deductions,
        netPay: summary.net_pay,
        status: summary.status,
        preparedBy: summary.prepared_by,
        reviewedBy: summary.reviewed_by,
        approvedBy: summary.approved_by,
        lockedAt: summary.locked_at,
      } : null,
      records: recordsResult.results.map(toRecord),
    });
  }

  const result = await db.prepare(`SELECT r.year_month, COUNT(*) AS employee_count,
    COALESCE(SUM(r.gross_pay), 0) AS gross_pay, COALESCE(SUM(r.deductions), 0) AS deductions,
    COALESCE(SUM(r.net_pay), 0) AS net_pay, p.status, p.prepared_by, p.reviewed_by, p.approved_by, p.locked_at
    FROM hr_payroll_records r JOIN hr_payroll_runs p ON p.period = r.year_month
    GROUP BY r.year_month, p.status, p.prepared_by, p.reviewed_by, p.approved_by, p.locked_at ORDER BY r.year_month DESC`).all<PayrollSummaryRow>();

  return Response.json({ summaries: result.results.map((summary) => ({
    yearMonth: summary.year_month,
    employeeCount: summary.employee_count,
    grossPay: summary.gross_pay,
    deductions: summary.deductions,
    netPay: summary.net_pay,
    status: summary.status,
    preparedBy: summary.prepared_by,
    reviewedBy: summary.reviewed_by,
    approvedBy: summary.approved_by,
    lockedAt: summary.locked_at,
  })) });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const body = await request.json() as { period?: unknown; status?: unknown; reopenedReason?: unknown };
  const period = typeof body.period === "string" ? body.period.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!/^\d{4}-\d{2}$/.test(period) || !["DRAFT", "REVIEW", "APPROVED", "LOCKED"].includes(status)) {
    return Response.json({ error: "급여월과 처리 상태를 확인해 주세요." }, { status: 400 });
  }
  const action = status === "LOCKED" ? "approve" : "write";
  const authorization = await authorizeErpRequest(db, "hr", action);
  if (authorization.response) return authorization.response;
  await syncPayrollRuns();
  const before = await db.prepare("SELECT * FROM hr_payroll_runs WHERE period = ?").bind(period).first<Record<string, unknown>>();
  if (!before) return Response.json({ error: "급여월을 찾을 수 없습니다." }, { status: 404 });
  const now = Date.now();
  if (status === "APPROVED" && before.status !== "APPROVED") {
    if (before.status !== "REVIEW") return Response.json({ error: "검토 요청 상태의 급여월만 승인 결재를 요청할 수 있습니다." }, { status: 409 });
    const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
      WHERE target_entity_type = 'PAYROLL_RUN' AND target_entity_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(period).first<{ id: string; status: string }>();
    if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) return Response.json({ item: before, approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
    const netPay = Number(before.net_pay ?? 0);
    const approval = await createApprovalRequest(db, authorization.principal, {
      module: "hr", requestType: "PAYROLL_RUN", title: `${period} 급여 승인`,
      description: `${Number(before.employee_count ?? 0)}명 · 기록상 지급액 ${netPay.toLocaleString("ko-KR")}원`,
      targetEntityType: "PAYROLL_RUN", targetEntityId: period, amount: netPay,
      metadata: { period, employeeCount: Number(before.employee_count ?? 0), grossPay: Number(before.gross_pay ?? 0), deductions: Number(before.deductions ?? 0), netPay },
    });
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "PAYROLL_APPROVAL_SUBMITTED", entityType: "payrollRun", entityId: period, before, after: approval });
    return Response.json({ item: before, approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
  }
  if (status === "LOCKED" && before.status !== "APPROVED") return Response.json({ error: "승인 완료된 급여월만 마감 잠금할 수 있습니다." }, { status: 409 });
  await db.prepare(`UPDATE hr_payroll_runs SET status = ?, prepared_by = CASE WHEN ? IN ('REVIEW','APPROVED','LOCKED') THEN ? ELSE prepared_by END,
    reviewed_by = CASE WHEN ? IN ('APPROVED','LOCKED') THEN ? ELSE reviewed_by END,
    approved_by = CASE WHEN ? IN ('APPROVED','LOCKED') THEN ? ELSE '' END,
    locked_at = CASE WHEN ? = 'LOCKED' THEN ? ELSE NULL END,
    reopened_reason = CASE WHEN ? = 'DRAFT' THEN ? ELSE reopened_reason END, updated_at = ? WHERE period = ?`)
    .bind(status, status, authorization.principal.employeeId, status, authorization.principal.employeeId,
      status, authorization.principal.employeeId, status, now, status,
      typeof body.reopenedReason === "string" ? body.reopenedReason.trim() : "", now, period).run();
  const after = await db.prepare("SELECT * FROM hr_payroll_runs WHERE period = ?").bind(period).first<Record<string, unknown>>();
  await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "PAYROLL_RUN_STATUS_UPDATED", entityType: "payrollRun", entityId: period, before, after, reason: typeof body.reopenedReason === "string" ? body.reopenedReason : "" });
  return Response.json({ item: after });
}
