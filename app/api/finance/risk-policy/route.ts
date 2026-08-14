import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { buildAccountRiskModel } from "../../../finance-decision-model";
import { financeCurrentData } from "../../../finance-current-data";
import { ensureFinanceRiskPolicySchema, loadFinanceRiskPolicy } from "../../../finance-risk-policy-server";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

function preview(policy: Awaited<ReturnType<typeof loadFinanceRiskPolicy>>) {
  return buildAccountRiskModel(financeCurrentData.accountSummary, financeCurrentData.accounts, financeCurrentData.balanceTrend, policy);
}

export async function GET() {
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const policy = await loadFinanceRiskPolicy(db);
  return Response.json({ policy, preview: preview(policy) });
}

export async function PUT(request: Request) {
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  await ensureFinanceRiskPolicySchema(db);
  const before = await loadFinanceRiskPolicy(db);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "재무정책 입력값을 읽을 수 없습니다." }, { status: 400 });
  }
  const minimumOperatingCash = Number(body.minimumOperatingCash);
  const minimumDebtCoverageBps = Number(body.minimumDebtCoverageBps);
  const maximumFxConcentrationBps = Number(body.maximumFxConcentrationBps);
  const warningDrawdownBps = Number(body.warningDrawdownBps);
  const criticalDrawdownBps = Number(body.criticalDrawdownBps);
  const lowBalanceThreshold = Number(body.lowBalanceThreshold);
  const changeReason = typeof body.changeReason === "string" ? body.changeReason.trim().slice(0, 300) : "";
  const integerInputs = [minimumOperatingCash, minimumDebtCoverageBps, maximumFxConcentrationBps,
    warningDrawdownBps, criticalDrawdownBps, lowBalanceThreshold];
  if (integerInputs.some((value) => !Number.isSafeInteger(value))
    || minimumOperatingCash < 0 || minimumOperatingCash > 100_000_000_000_000
    || minimumDebtCoverageBps < 10_000 || minimumDebtCoverageBps > 30_000
    || maximumFxConcentrationBps < 0 || maximumFxConcentrationBps > 10_000
    || warningDrawdownBps < 500 || warningDrawdownBps > 8_000
    || criticalDrawdownBps <= warningDrawdownBps || criticalDrawdownBps > 10_000
    || lowBalanceThreshold < 0 || lowBalanceThreshold > 100_000_000) {
    return Response.json({ error: "정책 금액과 비율 범위, 주의·위험 감소율의 순서를 확인해 주세요." }, { status: 400 });
  }
  if (changeReason.length < 2) return Response.json({ error: "정책 변경 사유를 2자 이상 입력해 주세요." }, { status: 400 });
  const now = Date.now();
  const version = before.version + 1;
  await db.prepare(`UPDATE finance_cash_forecast_settings SET minimum_cash_balance = ?,
    risk_policy_configured = 1, risk_policy_version = ?, minimum_debt_coverage_bps = ?,
    maximum_fx_concentration_bps = ?, warning_drawdown_bps = ?, critical_drawdown_bps = ?,
    low_balance_threshold = ?, updated_by = ?, updated_at = ? WHERE id = 'default'`)
    .bind(minimumOperatingCash, version, minimumDebtCoverageBps, maximumFxConcentrationBps,
      warningDrawdownBps, criticalDrawdownBps, lowBalanceThreshold,
      authorization.principal.employeeId, now).run();
  const policy = await loadFinanceRiskPolicy(db);
  await writeErpAudit(db, {
    principal: authorization.principal, module: "settings", action: "FINANCE_RISK_POLICY_UPDATED",
    entityType: "financeRiskPolicy", entityId: "default", before, after: policy, reason: changeReason,
  });
  return Response.json({ policy, preview: preview(policy) });
}
