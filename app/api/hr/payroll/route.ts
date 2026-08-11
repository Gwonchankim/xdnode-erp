import { env } from "cloudflare:workers";
import { companyEmployees } from "../../../hr-company-data";
import { payrollSeedRecords } from "../../../payroll-seed-data";

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
  ]);
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
  await seedPayrollRecords();

  const month = new URL(request.url).searchParams.get("month")?.trim();
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: "급여월 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const [recordsResult, summary] = await Promise.all([
      db.prepare(`SELECT * FROM hr_payroll_records
        WHERE year_month = ? ORDER BY employee_name`).bind(month).all<PayrollRow>(),
      db.prepare(`SELECT year_month, COUNT(*) AS employee_count,
        COALESCE(SUM(gross_pay), 0) AS gross_pay,
        COALESCE(SUM(deductions), 0) AS deductions,
        COALESCE(SUM(net_pay), 0) AS net_pay
        FROM hr_payroll_records WHERE year_month = ? GROUP BY year_month`).bind(month).first<PayrollSummaryRow>(),
    ]);
    return Response.json({
      summary: summary ? {
        yearMonth: summary.year_month,
        employeeCount: summary.employee_count,
        grossPay: summary.gross_pay,
        deductions: summary.deductions,
        netPay: summary.net_pay,
      } : null,
      records: recordsResult.results.map(toRecord),
    });
  }

  const result = await db.prepare(`SELECT year_month, COUNT(*) AS employee_count,
    COALESCE(SUM(gross_pay), 0) AS gross_pay,
    COALESCE(SUM(deductions), 0) AS deductions,
    COALESCE(SUM(net_pay), 0) AS net_pay
    FROM hr_payroll_records GROUP BY year_month ORDER BY year_month DESC`).all<PayrollSummaryRow>();

  return Response.json({ summaries: result.results.map((summary) => ({
    yearMonth: summary.year_month,
    employeeCount: summary.employee_count,
    grossPay: summary.gross_pay,
    deductions: summary.deductions,
    netPay: summary.net_pay,
  })) });
}
