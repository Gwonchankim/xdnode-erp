import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { applyDueRetirements } from "../../../hr-retirements";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type RunRow = {
  period: string; status: string; version: number; employee_count: number; gross_pay: number;
  settings_json: string;
  created_by: string; confirmed_by: string; confirmed_at: number | null; created_at: number; updated_at: number;
};

type LineRow = { employee_id: string; snapshot_json: string; gross_pay: number };
type EmployeeRow = {
  employee_id: string; name: string; birth: string; department: string; position: string; job_title: string;
  join_date: string; retirement_json: string | null; base_pay: number; meal_allowance: number;
  childcare_allowance: number; vehicle_allowance: number; annual_salary: number;
};

const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const safeJson = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const money = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
};
const normalizeSettings = (value: unknown) => {
  const settings = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rounding = ["round", "up", "down"].includes(String(settings.rounding)) ? String(settings.rounding) : "round";
  const columns = settings.columns && typeof settings.columns === "object" ? settings.columns as Record<string, unknown> : {};
  const standards = settings.standards && typeof settings.standards === "object" ? settings.standards as Record<string, unknown> : {};
  const columnDefaults: Record<string, boolean> = { research: true, extra: true, welfare: false, severance: true };
  const standardDefaults: Record<string, number> = { meal: 200_000, car: 200_000, child: 200_000 };
  return {
    rounding,
    columns: Object.fromEntries(["research", "extra", "welfare", "severance"].map((field) => [field,
      typeof columns[field] === "boolean" ? columns[field] : columnDefaults[field]])),
    standards: Object.fromEntries(["meal", "car", "child"].map((field) => [field,
      standards[field] === undefined ? standardDefaults[field] : money(standards[field]) ?? standardDefaults[field]])),
  };
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_compensation_runs (
      period TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', version INTEGER NOT NULL DEFAULT 1,
      employee_count INTEGER NOT NULL DEFAULT 0, gross_pay INTEGER NOT NULL DEFAULT 0,
      settings_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL,
      confirmed_by TEXT NOT NULL DEFAULT '', confirmed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_compensation_lines (
      period TEXT NOT NULL, employee_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, gross_pay INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, PRIMARY KEY (period, employee_id))`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_compensation_lines_period ON hr_compensation_lines(period, employee_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_records (
      id TEXT PRIMARY KEY, year_month TEXT NOT NULL, employee_id TEXT, employee_name TEXT NOT NULL, department TEXT,
      annual_salary INTEGER NOT NULL, base_pay INTEGER NOT NULL, meal_allowance INTEGER NOT NULL,
      childcare_allowance INTEGER NOT NULL, vehicle_allowance INTEGER NOT NULL, incentive INTEGER NOT NULL,
      bonus INTEGER NOT NULL, annual_leave_pay INTEGER NOT NULL, retirement_pay INTEGER NOT NULL, deductions INTEGER NOT NULL,
      gross_pay INTEGER NOT NULL, net_pay INTEGER NOT NULL, card_allowance INTEGER NOT NULL, card_usage INTEGER NOT NULL,
      personal_purchase INTEGER NOT NULL, non_taxable INTEGER NOT NULL, welfare_fund INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL, source_row INTEGER NOT NULL, imported_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_runs (
      period TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', employee_count INTEGER NOT NULL DEFAULT 0,
      gross_pay INTEGER NOT NULL DEFAULT 0, deductions INTEGER NOT NULL DEFAULT 0, net_pay INTEGER NOT NULL DEFAULT 0,
      prepared_by TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '',
      locked_at INTEGER, reopened_reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
  ]);
  const columns = await db.prepare("PRAGMA table_info(hr_employee_records)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  for (const [name, definition] of [
    ["annual_salary", "INTEGER NOT NULL DEFAULT 0"],
    ["base_pay", "INTEGER NOT NULL DEFAULT 0"], ["meal_allowance", "INTEGER NOT NULL DEFAULT 0"],
    ["childcare_allowance", "INTEGER NOT NULL DEFAULT 0"], ["vehicle_allowance", "INTEGER NOT NULL DEFAULT 0"],
  ].filter(([name]) => !existing.has(name))) await db.prepare(`ALTER TABLE hr_employee_records ADD COLUMN ${name} ${definition}`).run();
  const runColumns = await db.prepare("PRAGMA table_info(hr_compensation_runs)").all<{ name: string }>();
  if (!runColumns.results.some((column) => column.name === "settings_json")) {
    await db.prepare("ALTER TABLE hr_compensation_runs ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'").run();
  }
}

function runJson(row: RunRow | null, lines: LineRow[]) {
  if (!row) return null;
  return {
    period: row.period, status: row.status, version: row.version, employeeCount: row.employee_count,
    grossPay: row.gross_pay, settings: normalizeSettings(safeJson(row.settings_json, {})),
    createdBy: row.created_by, confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at, createdAt: row.created_at, updatedAt: row.updated_at,
    employees: lines.map((line) => safeJson<Record<string, unknown>>(line.snapshot_json, {})),
  };
}

async function readRun(period: string) {
  const [run, lines] = await Promise.all([
    db.prepare("SELECT * FROM hr_compensation_runs WHERE period = ?").bind(period).first<RunRow>(),
    db.prepare("SELECT employee_id, snapshot_json, gross_pay FROM hr_compensation_lines WHERE period = ? ORDER BY employee_id").bind(period).all<LineRow>(),
  ]);
  return { run: run ?? null, lines: lines.results };
}

async function hrPayrollSnapshots(period: string) {
  const [year, month] = period.split("-").map(Number);
  const start = `${period}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const employees = await db.prepare(`SELECT employee_id, name, birth, department, position, job_title, join_date,
    retirement_json, annual_salary, base_pay, meal_allowance, childcare_allowance, vehicle_allowance FROM hr_employee_records
    WHERE NULLIF(replace(join_date, '.', '-'), '') IS NOT NULL
      AND replace(join_date, '.', '-') <= ?
      AND (
        (COALESCE(status, '재직') <> '퇴직' AND (retirement_json IS NULL OR json_valid(retirement_json) = 0
          OR NULLIF(json_extract(retirement_json, '$.date'), '') IS NULL
          OR replace(json_extract(retirement_json, '$.date'), '.', '-') >= ?))
        OR (json_valid(retirement_json) = 1
          AND replace(json_extract(retirement_json, '$.date'), '.', '-') BETWEEN ? AND ?)
      )
    ORDER BY department, name`).bind(end, start, start, end).all<EmployeeRow>();
  return employees.results.map((employee) => ({
    id: employee.employee_id, name: employee.name, department: employee.department,
    title: employee.job_title || employee.position, birthDate: employee.birth === "미입력" ? "" : employee.birth.replaceAll(".", "-"),
    joinDate: employee.join_date.replaceAll(".", "-"),
    leaveDate: safeJson<{ date?: string }>(employee.retirement_json ?? "", {}).date?.replaceAll(".", "-") ?? "",
    probationMonths: 0, annualSalary: employee.annual_salary, basePay: employee.base_pay, manualBasic: true,
    meal: employee.meal_allowance, car: employee.vehicle_allowance, child: employee.childcare_allowance, monthly: {},
  }));
}

function validateDraft(body: Record<string, unknown>) {
  if (!Array.isArray(body.employees) || !Array.isArray(body.rows)) return { error: "임금 대상자와 계산 결과가 필요합니다." } as const;
  const employees = body.employees as Array<Record<string, unknown>>;
  const rows = body.rows as Array<Record<string, unknown>>;
  if (employees.length !== rows.length || employees.length > 500) return { error: "임금 대상자와 계산 결과의 인원 수가 일치하지 않습니다." } as const;
  const employeeIds = new Set<string>();
  const normalizedRows: Array<Record<string, number | string>> = [];
  for (const [index, employee] of employees.entries()) {
    const employeeId = String(employee.id ?? "").trim();
    const name = String(employee.name ?? "").trim();
    if (!employeeId || !name || employeeIds.has(employeeId)) return { error: "직원 ID와 이름을 확인해 주세요." } as const;
    employeeIds.add(employeeId);
    const row = rows[index];
    if (String(row.employeeId ?? "") !== employeeId) return { error: "직원과 계산 결과의 순서가 일치하지 않습니다." } as const;
    const fields = ["basic", "meal", "car", "child", "incentive", "bonus", "extra", "research", "severance", "welfare", "total"] as const;
    const values = Object.fromEntries(fields.map((field) => [field, money(row[field])])) as Record<(typeof fields)[number], number | null>;
    if (Object.values(values).some((value) => value === null)) return { error: `${name}의 임금 항목은 0원 이상이어야 합니다.` } as const;
    const expected = values.basic! + values.meal! + values.car! + values.child! + values.incentive! + values.bonus! + values.extra! + values.research! + values.severance!;
    if (expected !== values.total) return { error: `${name}의 지급총액이 세부 항목 합계와 일치하지 않습니다.` } as const;
    normalizedRows.push({ employeeId, name, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value!])) });
  }
  return { employees, rows: normalizedRows } as const;
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "read");
  if (authorization.response) return authorization.response;
  await applyDueRetirements(db);
  const period = new URL(request.url).searchParams.get("period")?.trim() ?? "";
  if (!periodPattern.test(period)) return Response.json({ error: "급여월 형식이 올바르지 않습니다." }, { status: 400 });
  const { run, lines } = await readRun(period);
  return Response.json({ run: runJson(run, lines) });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "write");
  if (authorization.response) return authorization.response;
  await applyDueRetirements(db);
  const body = await request.json() as Record<string, unknown>;
  const period = String(body.period ?? "").trim();
  const action = String(body.action ?? "").trim();
  if (!periodPattern.test(period)) return Response.json({ error: "급여월 형식이 올바르지 않습니다." }, { status: 400 });
  const now = Date.now();
  const beforeState = await readRun(period);

  if (["CREATE", "LOAD_HR"].includes(action)) {
    if (action === "CREATE" && beforeState.run) return Response.json({ run: runJson(beforeState.run, beforeState.lines), reused: true });
    if (action === "LOAD_HR" && beforeState.run?.status === "CONFIRMED") {
      return Response.json({ error: "확정된 임금안은 수정하기를 먼저 눌러 주세요." }, { status: 409 });
    }
    let snapshots: Array<Record<string, unknown>>;
    let grossPayByEmployee: number[];
    const hasClientDraft = action === "CREATE" && Array.isArray(body.employees) && body.employees.length > 0;
    if (hasClientDraft) {
      const draft = validateDraft(body);
      if ("error" in draft) return Response.json({ error: draft.error }, { status: 400 });
      snapshots = draft.employees;
      grossPayByEmployee = draft.rows.map((row) => Number(row.total));
    } else {
      snapshots = await hrPayrollSnapshots(period);
      grossPayByEmployee = snapshots.map(() => 0);
    }
    const grossPay = grossPayByEmployee.reduce((sum, amount) => sum + amount, 0);
    if (!beforeState.run) {
      await db.batch([
        db.prepare(`INSERT INTO hr_compensation_runs
          (period, status, version, employee_count, gross_pay, settings_json, created_by, confirmed_by, confirmed_at, created_at, updated_at)
          VALUES (?, 'DRAFT', 1, ?, ?, ?, ?, '', NULL, ?, ?)`).bind(period, snapshots.length, grossPay,
          JSON.stringify(normalizeSettings(body.settings)), authorization.principal.employeeId, now, now),
        ...snapshots.map((snapshot, index) => db.prepare(`INSERT INTO hr_compensation_lines
          (period, employee_id, snapshot_json, gross_pay, updated_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(period, String(snapshot.id), JSON.stringify(snapshot), grossPayByEmployee[index], now)),
      ]);
    } else {
      const expectedVersion = Number(body.version ?? 0);
      if (expectedVersion !== beforeState.run.version) return Response.json({ error: "다른 사용자가 임금안을 변경했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
      const nextVersion = expectedVersion + 1;
      const results = await db.batch([
        db.prepare(`UPDATE hr_compensation_runs SET version=version+1, employee_count=?, gross_pay=?, settings_json=?, updated_at=?
          WHERE period=? AND status='DRAFT' AND version=?`).bind(snapshots.length, grossPay,
          JSON.stringify(normalizeSettings(body.settings)), now, period, expectedVersion),
        db.prepare(`DELETE FROM hr_compensation_lines WHERE period = ? AND EXISTS (
          SELECT 1 FROM hr_compensation_runs WHERE period = ? AND status='DRAFT' AND version=? AND updated_at=?)`)
          .bind(period, period, nextVersion, now),
        ...snapshots.map((snapshot, index) => db.prepare(`INSERT INTO hr_compensation_lines
          (period, employee_id, snapshot_json, gross_pay, updated_at)
          SELECT ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM hr_compensation_runs WHERE period = ? AND status='DRAFT' AND version=? AND updated_at=?)`)
          .bind(period, String(snapshot.id), JSON.stringify(snapshot), grossPayByEmployee[index], now,
            period, nextVersion, now)),
      ]);
      if ((results[0]?.meta.changes ?? 0) < 1) return Response.json({ error: "임금안 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    const afterState = await readRun(period);
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: action === "LOAD_HR" ? "COMPENSATION_HR_DRAFT_LOADED" : "COMPENSATION_DRAFT_CREATED", entityType: "compensationRun", entityId: period, before: beforeState.run ? runJson(beforeState.run, beforeState.lines) : undefined, after: runJson(afterState.run, afterState.lines) });
    return Response.json({ run: runJson(afterState.run, afterState.lines) }, { status: 201 });
  }

  if (!beforeState.run) return Response.json({ error: "먼저 해당 월 임금안을 작성해 주세요." }, { status: 404 });
  const expectedVersion = Number(body.version ?? 0);
  if (expectedVersion !== beforeState.run.version) return Response.json({ error: "다른 사용자가 임금안을 변경했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });

  if (action === "REOPEN") {
    if (beforeState.run.status !== "CONFIRMED") return Response.json({ error: "확정된 임금안만 수정 상태로 전환할 수 있습니다." }, { status: 409 });
    const payroll = await db.prepare("SELECT status FROM hr_payroll_runs WHERE period = ?").bind(period).first<{ status: string }>();
    if (payroll && payroll.status !== "DRAFT") return Response.json({ error: "HR 급여관리에서 검토·승인·마감이 진행된 급여월은 먼저 작성 중으로 되돌려야 합니다." }, { status: 409 });
    await db.prepare(`UPDATE hr_compensation_runs SET status='DRAFT', version=version+1, confirmed_by='', confirmed_at=NULL, updated_at=?
      WHERE period=? AND status='CONFIRMED' AND version=?`).bind(now, period, expectedVersion).run();
  } else if (["SAVE", "CONFIRM"].includes(action)) {
    if (beforeState.run.status !== "DRAFT") return Response.json({ error: "확정된 임금안은 수정하기를 먼저 눌러 주세요." }, { status: 409 });
    if (action === "CONFIRM") {
      const payroll = await db.prepare("SELECT status FROM hr_payroll_runs WHERE period = ?").bind(period).first<{ status: string }>();
      if (payroll && payroll.status !== "DRAFT") return Response.json({ error: "HR 급여관리에서 검토·승인·마감이 진행된 급여월은 임금안으로 덮어쓸 수 없습니다." }, { status: 409 });
    }
    const draft = validateDraft(body);
    if ("error" in draft) return Response.json({ error: draft.error }, { status: 400 });
    const lineStatements = draft.employees.map((employee, index) => db.prepare(`INSERT INTO hr_compensation_lines
      (period, employee_id, snapshot_json, gross_pay, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(period, employee_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, gross_pay=excluded.gross_pay, updated_at=excluded.updated_at`)
      .bind(period, String(employee.id), JSON.stringify(employee), Number(draft.rows[index].total), now));
    const employeeIds = draft.employees.map((employee) => String(employee.id));
    const deleteRemoved = employeeIds.length
      ? db.prepare(`DELETE FROM hr_compensation_lines WHERE period = ? AND employee_id NOT IN (${employeeIds.map(() => "?").join(",")})`).bind(period, ...employeeIds)
      : db.prepare("DELETE FROM hr_compensation_lines WHERE period = ?").bind(period);
    const grossPay = draft.rows.reduce((sum, row) => sum + Number(row.total), 0);
    const nextStatus = action === "CONFIRM" ? "CONFIRMED" : "DRAFT";
    const statements = [
      ...lineStatements, deleteRemoved,
      db.prepare(`UPDATE hr_compensation_runs SET status=?, version=version+1, employee_count=?, gross_pay=?, settings_json=?,
        confirmed_by=?, confirmed_at=?, updated_at=? WHERE period=? AND status='DRAFT' AND version=?`)
        .bind(nextStatus, draft.employees.length, grossPay, JSON.stringify(normalizeSettings(body.settings)),
          action === "CONFIRM" ? authorization.principal.employeeId : "", action === "CONFIRM" ? now : null, now, period, expectedVersion),
    ];
    if (action === "CONFIRM") {
      // Re-confirming an already-CONFIRMED wage plan (via REOPEN → edit → CONFIRM) rebuilds hr_payroll_records
      // from this draft's snapshot alone. Any sales incentive already merged in via APPLY_PAYROLL
      // (app/api/sales/incentives/route.ts) lives only in the DB row, not in this snapshot, so it must be
      // re-added here or it silently disappears while sales_incentive_results still shows PAYROLL_APPLIED.
      let appliedByRecordId = new Map<string, number>();
      let totalAppliedIncentive = 0;
      try {
        const appliedIncentives = await db.prepare(`SELECT payroll_record_id, COALESCE(SUM(applied_amount), 0) AS amount
          FROM sales_incentive_payroll_links WHERE payroll_period = ? GROUP BY payroll_record_id`)
          .bind(period).all<{ payroll_record_id: string; amount: number }>();
        appliedByRecordId = new Map(appliedIncentives.results.map((row) => [row.payroll_record_id, row.amount]));
        totalAppliedIncentive = appliedIncentives.results.reduce((sum, row) => sum + row.amount, 0);
      } catch {
        // sales_incentive_payroll_links may not exist yet if the incentive workflow route has never run.
      }
      statements.push(db.prepare("DELETE FROM hr_payroll_records WHERE year_month = ?").bind(period));
      draft.rows.forEach((row, index) => {
        const employee = draft.employees[index];
        const combinedBonus = Number(row.bonus) + Number(row.extra) + Number(row.research);
        const recordId = `compensation:${period}:${String(employee.id)}`;
        const appliedIncentiveAmount = appliedByRecordId.get(recordId) ?? 0;
        const incentiveTotal = Number(row.incentive) + appliedIncentiveAmount;
        const payTotal = Number(row.total) + appliedIncentiveAmount;
        statements.push(db.prepare(`INSERT INTO hr_payroll_records
          (id, year_month, employee_id, employee_name, department, annual_salary, base_pay, meal_allowance,
            childcare_allowance, vehicle_allowance, incentive, bonus, annual_leave_pay, retirement_pay, deductions,
            gross_pay, net_pay, card_allowance, card_usage, personal_purchase, non_taxable, welfare_fund,
            notes, source_sheet, source_row, imported_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, 0, 0, 0, ?, ?, ?, 'ERP 임금계산', ?, ?)`)
          .bind(recordId, period, String(employee.id), String(employee.name), String(employee.department ?? ""),
            money(employee.annualSalary) ?? 0, Number(row.basic), Number(row.meal), Number(row.child), Number(row.car), incentiveTotal, combinedBonus,
            Number(row.severance), payTotal, payTotal, Number(row.meal) + Number(row.child) + Number(row.car), Number(row.welfare),
            String((employee.monthly as Record<string, Record<string, unknown>> | undefined)?.[period]?.note ?? ""), index + 1, now));
      });
      statements.push(db.prepare(`INSERT INTO hr_payroll_runs
        (period, status, employee_count, gross_pay, deductions, net_pay, prepared_by, reviewed_by, approved_by,
          locked_at, reopened_reason, created_at, updated_at) VALUES (?, 'DRAFT', ?, ?, 0, ?, ?, '', '', NULL, '', ?, ?)
        ON CONFLICT(period) DO UPDATE SET employee_count=excluded.employee_count, gross_pay=excluded.gross_pay,
          deductions=0, net_pay=excluded.net_pay, prepared_by=excluded.prepared_by, reviewed_by='', approved_by='',
          locked_at=NULL, reopened_reason='', updated_at=excluded.updated_at WHERE hr_payroll_runs.status='DRAFT'`)
        .bind(period, draft.employees.length, grossPay + totalAppliedIncentive, grossPay + totalAppliedIncentive, authorization.principal.employeeId, now, now));
    }
    const results = await db.batch(statements);
    const runResult = results[lineStatements.length + 1];
    if ((runResult.meta.changes ?? 0) < 1) return Response.json({ error: "임금안 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  } else {
    return Response.json({ error: "지원하지 않는 임금안 작업입니다." }, { status: 400 });
  }

  const afterState = await readRun(period);
  await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: `COMPENSATION_${action}`, entityType: "compensationRun", entityId: period, before: runJson(beforeState.run, beforeState.lines), after: runJson(afterState.run, afterState.lines) });
  return Response.json({ run: runJson(afterState.run, afterState.lines) });
}
