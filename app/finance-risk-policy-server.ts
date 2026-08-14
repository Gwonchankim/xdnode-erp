import { DEFAULT_FINANCE_RISK_POLICY, type FinanceRiskPolicy } from "./finance-decision-model";

type PolicyRow = {
  minimum_cash_balance: number;
  risk_policy_configured: number;
  risk_policy_version: number;
  minimum_debt_coverage_bps: number;
  maximum_fx_concentration_bps: number;
  warning_drawdown_bps: number;
  critical_drawdown_bps: number;
  low_balance_threshold: number;
  updated_by: string;
  updated_at: number;
};

const addedColumns = [
  ["risk_policy_configured", "INTEGER NOT NULL DEFAULT 0"],
  ["risk_policy_version", "INTEGER NOT NULL DEFAULT 1"],
  ["minimum_debt_coverage_bps", "INTEGER NOT NULL DEFAULT 12500"],
  ["maximum_fx_concentration_bps", "INTEGER NOT NULL DEFAULT 5000"],
  ["warning_drawdown_bps", "INTEGER NOT NULL DEFAULT 2000"],
  ["critical_drawdown_bps", "INTEGER NOT NULL DEFAULT 3500"],
  ["low_balance_threshold", "INTEGER NOT NULL DEFAULT 100000"],
] as const;

export async function ensureFinanceRiskPolicySchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS finance_cash_forecast_settings (
    id TEXT PRIMARY KEY NOT NULL, minimum_cash_balance INTEGER NOT NULL DEFAULT 0,
    include_fx INTEGER NOT NULL DEFAULT 0, default_scenario TEXT NOT NULL DEFAULT 'BASE',
    collection_probability INTEGER NOT NULL DEFAULT 85, updated_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    risk_policy_configured INTEGER NOT NULL DEFAULT 0, risk_policy_version INTEGER NOT NULL DEFAULT 1,
    minimum_debt_coverage_bps INTEGER NOT NULL DEFAULT 12500,
    maximum_fx_concentration_bps INTEGER NOT NULL DEFAULT 5000,
    warning_drawdown_bps INTEGER NOT NULL DEFAULT 2000,
    critical_drawdown_bps INTEGER NOT NULL DEFAULT 3500,
    low_balance_threshold INTEGER NOT NULL DEFAULT 100000
  )`).run();
  const columns = await db.prepare("PRAGMA table_info(finance_cash_forecast_settings)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const missing = addedColumns.filter(([name]) => !existing.has(name));
  if (missing.length) {
    await db.batch(missing.map(([name, definition]) => db.prepare(
      `ALTER TABLE finance_cash_forecast_settings ADD COLUMN ${name} ${definition}`,
    )));
  }
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO finance_cash_forecast_settings
    (id, minimum_cash_balance, include_fx, default_scenario, collection_probability,
      updated_by, created_at, updated_at, risk_policy_configured, risk_policy_version,
      minimum_debt_coverage_bps, maximum_fx_concentration_bps, warning_drawdown_bps,
      critical_drawdown_bps, low_balance_threshold)
    VALUES ('default', 0, 0, 'BASE', 85, '', ?, ?, 0, 1, 12500, 5000, 2000, 3500, 100000)`)
    .bind(now, now).run();
}

function toPolicy(row: PolicyRow | null): FinanceRiskPolicy {
  if (!row) return DEFAULT_FINANCE_RISK_POLICY;
  return {
    configured: Boolean(row.risk_policy_configured),
    version: Number(row.risk_policy_version) || 1,
    minimumOperatingCash: Number(row.minimum_cash_balance) || 0,
    minimumDebtCoverageBps: Number(row.minimum_debt_coverage_bps) || DEFAULT_FINANCE_RISK_POLICY.minimumDebtCoverageBps,
    maximumFxConcentrationBps: Number(row.maximum_fx_concentration_bps),
    warningDrawdownBps: Number(row.warning_drawdown_bps) || DEFAULT_FINANCE_RISK_POLICY.warningDrawdownBps,
    criticalDrawdownBps: Number(row.critical_drawdown_bps) || DEFAULT_FINANCE_RISK_POLICY.criticalDrawdownBps,
    lowBalanceThreshold: Number(row.low_balance_threshold) || DEFAULT_FINANCE_RISK_POLICY.lowBalanceThreshold,
    updatedBy: row.updated_by || "",
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function loadFinanceRiskPolicy(db: D1Database): Promise<FinanceRiskPolicy> {
  await ensureFinanceRiskPolicySchema(db);
  const row = await db.prepare(`SELECT minimum_cash_balance, risk_policy_configured, risk_policy_version,
    minimum_debt_coverage_bps, maximum_fx_concentration_bps, warning_drawdown_bps,
    critical_drawdown_bps, low_balance_threshold, updated_by, updated_at
    FROM finance_cash_forecast_settings WHERE id = 'default'`).first<PolicyRow>();
  return toPolicy(row);
}
