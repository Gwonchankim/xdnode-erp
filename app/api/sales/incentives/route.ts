import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
const requiredValidations = ["POLICY", "EXAMPLE", "HISTORICAL"];
const validPeriod = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const objectJson = (value: string) => { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; } };

type Rule = { id: string; name: string; version: number; effective_from: string; effective_to: string; rules_json: string;
  status: string; approved_by: string; approved_at: number | null; created_at: number; updated_at: number };
type Result = { id: string; period: string; employee_id: string; opportunity_id: string; rule_id: string; rule_version: number;
  recognized_revenue: number; recognized_cost: number; payout_amount: number; calculation_json: string; status: string;
  sales_confirmed_at: number | null; finance_reviewed_at: number | null; representative_approved_at: number | null;
  payroll_ref: string; created_at: number; updated_at: number; opportunity_title?: string; account_name?: string; employee_name?: string };

async function ensureSchema() {
  await db.batch([
    // 이 두 테이블은 아래 인덱스가 참조하는데, 예전에는 여기서 만들지 않고 다른 라우트가
    // 먼저 실행되기를 기대하고 있었다. D1 배치는 원자적이라 테이블이 없으면 배치 전체가
    // 실패했고, 그래서 인센티브 화면과 이를 참조하는 월마감 화면이 통째로 500 을 냈다.
    // sales_incentive_results 는 애초에 어떤 라우트도 만들지 않았다(정의는
    // drizzle/0009_greedy_gravity.sql 에만 있었다).
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_incentive_rules (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'DRAFT',
      effective_from TEXT NOT NULL DEFAULT '', effective_to TEXT NOT NULL DEFAULT '', rules_json TEXT NOT NULL DEFAULT '{}',
      approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_incentive_results (
      id TEXT PRIMARY KEY NOT NULL, period TEXT NOT NULL, employee_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
      rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL, recognized_revenue INTEGER NOT NULL,
      recognized_cost INTEGER NOT NULL, payout_amount INTEGER NOT NULL, calculation_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', sales_confirmed_at INTEGER, finance_reviewed_at INTEGER,
      representative_approved_at INTEGER, payroll_ref TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_incentive_period_employee ON sales_incentive_results(period, employee_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_incentive_status ON sales_incentive_results(status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_incentive_validations (
      id TEXT PRIMARY KEY NOT NULL, rule_id TEXT NOT NULL, validation_type TEXT NOT NULL, result TEXT NOT NULL,
      evidence_document_id TEXT NOT NULL, note TEXT NOT NULL, reviewed_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_incentive_notes (
      id TEXT PRIMARY KEY NOT NULL, result_id TEXT NOT NULL, note_type TEXT NOT NULL, note TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_incentive_payroll_links (
      id TEXT PRIMARY KEY NOT NULL, result_id TEXT NOT NULL, payroll_period TEXT NOT NULL, payroll_record_id TEXT NOT NULL,
      applied_amount INTEGER NOT NULL, applied_by TEXT NOT NULL, applied_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_incentive_rule_name_version ON sales_incentive_rules(name, version)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_incentive_result_source ON sales_incentive_results(period, employee_id, opportunity_id, rule_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_incentive_validation_type ON sales_incentive_validations(rule_id, validation_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_incentive_validation_result ON sales_incentive_validations(result, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_incentive_note_result ON sales_incentive_notes(result_id, created_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_incentive_payroll_result ON sales_incentive_payroll_links(result_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_incentive_payroll_period ON sales_incentive_payroll_links(payroll_period, payroll_record_id)"),
  ]);
}

const parseRule = (row: Rule) => {
  const formula = objectJson(row.rules_json);
  return { id: row.id, name: row.name, version: row.version, effectiveFrom: row.effective_from, effectiveTo: row.effective_to,
    formula, status: row.status, approvedBy: row.approved_by, approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at };
};

async function readState(period = "") {
  const [rules, validations, documents, results, notes, links] = await Promise.all([
    db.prepare("SELECT * FROM sales_incentive_rules ORDER BY version DESC, created_at DESC").all<Rule>(),
    db.prepare("SELECT * FROM sales_incentive_validations ORDER BY created_at DESC").all<Record<string, string | number>>(),
    db.prepare(`SELECT id, entity_id, category, version, file_name, uploaded_by, created_at FROM erp_documents
      WHERE module = 'sales' AND entity_type = 'salesIncentiveRule' AND deleted_at IS NULL
      ORDER BY entity_id, category, version DESC`).all<Record<string, string | number>>(),
    db.prepare(`SELECT result.*, opportunity.title AS opportunity_title, account.name AS account_name,
        COALESCE(employee.name, result.employee_id) AS employee_name
      FROM sales_incentive_results result
      LEFT JOIN sales_opportunities opportunity ON opportunity.id = result.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      LEFT JOIN hr_employee_records employee ON employee.employee_id = result.employee_id
      WHERE (? = '' OR result.period = ?) ORDER BY result.period DESC, employee_name, opportunity_title`)
      .bind(period, period).all<Result>(),
    db.prepare("SELECT * FROM sales_incentive_notes ORDER BY created_at DESC").all<Record<string, string | number>>(),
    db.prepare("SELECT * FROM sales_incentive_payroll_links ORDER BY applied_at DESC").all<Record<string, string | number>>(),
  ]);
  return {
    rules: rules.results.map((row) => ({ ...parseRule(row),
      validations: validations.results.filter((item) => item.rule_id === row.id),
      documents: documents.results.filter((item) => item.entity_id === row.id).map((item) => ({ ...item,
        downloadUrl: `/api/documents?downloadId=${encodeURIComponent(String(item.id))}` })) })),
    results: results.results.map((row) => ({ id: row.id, period: row.period, employeeId: row.employee_id,
      employeeName: row.employee_name || row.employee_id, opportunityId: row.opportunity_id,
      opportunityTitle: row.opportunity_title || "", accountName: row.account_name || "", ruleId: row.rule_id,
      ruleVersion: row.rule_version, recognizedRevenue: row.recognized_revenue, recognizedCost: row.recognized_cost,
      payoutAmount: row.payout_amount, calculation: objectJson(row.calculation_json), status: row.status,
      salesConfirmedAt: row.sales_confirmed_at, financeReviewedAt: row.finance_reviewed_at,
      representativeApprovedAt: row.representative_approved_at, payrollRef: row.payroll_ref,
      notes: notes.results.filter((item) => item.result_id === row.id), payrollLink: links.results.find((item) => item.result_id === row.id) ?? null })),
  };
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const period = new URL(request.url).searchParams.get("period")?.trim() ?? "";
  if (period && !validPeriod(period)) return Response.json({ error: "정산월 형식을 확인해 주세요." }, { status: 400 });
  return Response.json(await readState(period));
}

function formulaInput(body: Record<string, unknown>) {
  const thresholdMarginBps = Math.round(Number(body.thresholdMarginPercent ?? 0) * 100);
  const payoutRateBps = Math.round(Number(body.payoutRatePercent ?? 0) * 100);
  const eligibleLeadTypes = Array.isArray(body.eligibleLeadTypes)
    ? body.eligibleLeadTypes.map(String).filter((value) => ["OUTBOUND", "INBOUND", "RAM"].includes(value)) : [];
  if (!Number.isInteger(thresholdMarginBps) || thresholdMarginBps < 0 || thresholdMarginBps > 10000
    || !Number.isInteger(payoutRateBps) || payoutRateBps < 0 || payoutRateBps > 10000 || !eligibleLeadTypes.length) return null;
  return { recognitionBasis: "CUMULATIVE_COLLECTED_PAYMENT_TRUE_UP", costBasis: "PROJECT_ALLOCATED_ACTUAL_COST_WITH_DRAFT_FALLBACK",
    thresholdMarginBps, payoutRateBps, eligibleLeadTypes, exceptionsNote: String(body.exceptionsNote ?? "").trim() };
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? "");
  const permission = ["FINANCE_REVIEW", "VOID_RESULT"].includes(action) ? ["finance", "approve"] as const
    : action === "APPLY_PAYROLL" ? ["hr", "approve"] as const : ["sales", action.includes("SUBMIT") ? "approve" : "write"] as const;
  const authorization = await authorizeErpRequest(db, permission[0], permission[1]);
  if (authorization.response) return authorization.response;
  const now = Date.now();

  if (action === "CREATE_RULE") {
    const name = String(body.name ?? "").trim(); const effectiveFrom = String(body.effectiveFrom ?? "").trim();
    const effectiveTo = String(body.effectiveTo ?? "").trim(); const formula = formulaInput(body);
    if (name.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo))
      || (effectiveTo && effectiveTo < effectiveFrom) || !formula) return Response.json({ error: "규정명·적용기간·대상유형·기준마진율·지급률을 확인해 주세요." }, { status: 400 });
    const latest = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM sales_incentive_rules WHERE name = ?").bind(name).first<{ version: number }>();
    const id = crypto.randomUUID(); const version = Number(latest?.version ?? 0) + 1;
    await db.prepare(`INSERT INTO sales_incentive_rules
      (id, name, version, effective_from, effective_to, rules_json, status, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', '', NULL, ?, ?)`).bind(id, name, version, effectiveFrom, effectiveTo, JSON.stringify(formula), now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "INCENTIVE_RULE_CREATED", entityType: "salesIncentiveRule", entityId: id, after: { name, version, effectiveFrom, effectiveTo, formula } });
    return Response.json({ id, version }, { status: 201 });
  }

  if (action === "VALIDATE_RULE") {
    const ruleId = String(body.ruleId ?? "").trim(); const validationType = String(body.validationType ?? "");
    const result = String(body.result ?? ""); const documentId = String(body.evidenceDocumentId ?? "").trim(); const note = String(body.note ?? "").trim();
    const [rule, document] = await Promise.all([
      db.prepare("SELECT * FROM sales_incentive_rules WHERE id = ?").bind(ruleId).first<Rule>(),
      db.prepare(`SELECT id FROM erp_documents WHERE id = ? AND module = 'sales' AND entity_type = 'salesIncentiveRule'
        AND entity_id = ? AND deleted_at IS NULL`).bind(documentId, ruleId).first(),
    ]);
    if (!rule || rule.status !== "DRAFT" || !requiredValidations.includes(validationType) || !["PASS", "FAIL"].includes(result) || !document || note.length < 10)
      return Response.json({ error: "초안 규정, 검증 종류, 결과, 근거문서와 10자 이상의 검토 의견이 필요합니다." }, { status: 400 });
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO sales_incentive_validations
      (id, rule_id, validation_type, result, evidence_document_id, note, reviewed_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rule_id, validation_type) DO UPDATE SET result = excluded.result, evidence_document_id = excluded.evidence_document_id,
        note = excluded.note, reviewed_by = excluded.reviewed_by, updated_at = excluded.updated_at`)
      .bind(id, ruleId, validationType, result, documentId, note, authorization.principal.employeeId, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "INCENTIVE_RULE_VALIDATED", entityType: "salesIncentiveRule", entityId: ruleId, after: { validationType, result, documentId, note } });
    return Response.json({ ruleId, validationType, result });
  }

  if (action === "SUBMIT_RULE") {
    const ruleId = String(body.ruleId ?? "").trim();
    const rule = await db.prepare("SELECT * FROM sales_incentive_rules WHERE id = ?").bind(ruleId).first<Rule>();
    const validation = await db.prepare(`SELECT validation_type, result FROM sales_incentive_validations WHERE rule_id = ?`).bind(ruleId).all<{ validation_type: string; result: string }>();
    const passed = new Set(validation.results.filter((item) => item.result === "PASS").map((item) => item.validation_type));
    const openApproval = await db.prepare(`SELECT id FROM erp_approval_requests WHERE target_entity_type = 'INCENTIVE_RULE'
      AND target_entity_id = ? AND status IN ('SUBMITTED','IN_REVIEW','CHANGES_REQUESTED') LIMIT 1`).bind(ruleId).first<{ id: string }>();
    if (!rule || rule.status !== "DRAFT" || requiredValidations.some((type) => !passed.has(type)))
      return Response.json({ error: "규정 원문·예시 계산·과거 지급내역의 세 차례 검증이 모두 PASS여야 합니다." }, { status: 409 });
    if (openApproval) return Response.json({ approvalId: openApproval.id, submitted: true }, { status: 202 });
    const approval = await createApprovalRequest(db, authorization.principal, { module: "sales", requestType: "INCENTIVE_RULE",
      title: `${rule.name} v${rule.version} 인센티브 규정 승인`, description: "세 차례 교차검증 완료 · 누적 수금·프로젝트 실제원가 기준 정산 규칙",
      targetEntityType: "INCENTIVE_RULE", targetEntityId: rule.id, metadata: { version: rule.version, requiredValidations } });
    await db.prepare("UPDATE sales_incentive_rules SET status = 'SUBMITTED', updated_at = ? WHERE id = ? AND status = 'DRAFT'").bind(now, ruleId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "INCENTIVE_RULE_SUBMITTED", entityType: "salesIncentiveRule", entityId: ruleId, before: parseRule(rule), after: approval });
    return Response.json({ approvalId: approval.id, submitted: true }, { status: 202 });
  }

  if (action === "CALCULATE_PERIOD") {
    const period = String(body.period ?? "").trim(); if (!validPeriod(period)) return Response.json({ error: "정산월을 확인해 주세요." }, { status: 400 });
    const start = `${period}-01`; const endDate = new Date(`${start}T00:00:00Z`); endDate.setUTCMonth(endDate.getUTCMonth() + 1); const end = endDate.toISOString().slice(0, 10);
    const rule = await db.prepare(`SELECT * FROM sales_incentive_rules WHERE status IN ('ACTIVE','RETIRED') AND approved_at IS NOT NULL
      AND effective_from < ? AND (effective_to = '' OR effective_to >= ?)
      ORDER BY effective_from DESC, approved_at DESC, version DESC LIMIT 1`).bind(end, start).first<Rule>();
    if (!rule) return Response.json({ error: "해당 정산월에 적용되는 승인된 인센티브 규정이 없습니다." }, { status: 409 });
    const rawFormula = objectJson(rule.rules_json); const formula = {
      thresholdMarginBps: Number(rawFormula.thresholdMarginBps), payoutRateBps: Number(rawFormula.payoutRateBps),
      eligibleLeadTypes: Array.isArray(rawFormula.eligibleLeadTypes) ? rawFormula.eligibleLeadTypes.map(String) : [],
    };
    if (!Number.isInteger(formula.thresholdMarginBps) || !Number.isInteger(formula.payoutRateBps) || !formula.eligibleLeadTypes.length)
      return Response.json({ error: "활성 규정의 산식 데이터가 손상되었습니다. 규정 버전을 재검토해 주세요." }, { status: 409 });
    const ruleStartPeriod = rule.effective_from.slice(0, 7); const recognitionStart = rule.effective_from > start ? rule.effective_from : start;
    const sources = await db.prepare(`WITH source_rows AS (
      SELECT opportunity.id, opportunity.title, opportunity.owner_employee_id, opportunity.lead_type,
        opportunity.expected_cost, account.name AS account_name, center.id AS cost_center_id, center.status AS cost_center_status,
        COALESCE((SELECT SUM(payment.amount) FROM sales_documents payment WHERE payment.opportunity_id = opportunity.id
          AND payment.document_type = 'PAYMENT' AND payment.status IN ('ACCEPTED','COMPLETED')
          AND payment.issued_date >= ? AND payment.issued_date < ?), 0) AS period_collected,
        COALESCE((SELECT SUM(payment.amount) FROM sales_documents payment WHERE payment.opportunity_id = opportunity.id
          AND payment.document_type = 'PAYMENT' AND payment.status IN ('ACCEPTED','COMPLETED')
          AND payment.issued_date >= ? AND payment.issued_date < ?), 0) AS cumulative_collected,
        COALESCE((SELECT SUM(invoice.amount) FROM sales_documents invoice WHERE invoice.opportunity_id = opportunity.id
          AND invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED')), 0) AS invoiced,
        COALESCE((SELECT SUM(allocation.amount) FROM finance_project_allocations allocation
          WHERE allocation.cost_center_id = center.id AND allocation.direction = 'COST' AND allocation.period >= ? AND allocation.period <= ?), 0) AS actual_project_cost,
        COALESCE((SELECT COUNT(*) FROM finance_project_allocations allocation
          WHERE allocation.cost_center_id = center.id AND allocation.direction = 'COST' AND allocation.period >= ? AND allocation.period <= ?), 0) AS cost_allocation_count,
        COALESCE((SELECT COUNT(*) FROM finance_project_allocations allocation
          WHERE allocation.cost_center_id = center.id AND allocation.direction = 'COST' AND allocation.period = ?), 0) AS period_cost_allocation_count,
        COALESCE((SELECT MAX(allocation.updated_at) FROM finance_project_allocations allocation
          WHERE allocation.cost_center_id = center.id AND allocation.direction = 'COST' AND allocation.period >= ? AND allocation.period <= ?), 0) AS cost_allocation_updated_at,
        COALESCE((SELECT SUM(prior.payout_amount) FROM sales_incentive_results prior
          WHERE prior.opportunity_id = opportunity.id AND prior.rule_id = ? AND prior.period < ?
            AND prior.status IN ('APPROVED','PAYROLL_APPLIED')), 0) AS prior_payout,
        COALESCE((SELECT COUNT(*) FROM sales_incentive_results prior
          WHERE prior.opportunity_id = opportunity.id AND prior.rule_id = ? AND prior.period < ?
            AND prior.status IN ('DRAFT','SALES_CONFIRMED','FINANCE_REVIEWED','SUBMITTED')), 0) AS unresolved_prior_count
      FROM sales_opportunities opportunity JOIN sales_accounts account ON account.id = opportunity.account_id
      LEFT JOIN finance_cost_centers center ON center.opportunity_id = opportunity.id
      WHERE opportunity.stage = 'WON' AND opportunity.deleted_at IS NULL)
      SELECT * FROM source_rows WHERE period_collected > 0 OR period_cost_allocation_count > 0`)
      .bind(recognitionStart, end, rule.effective_from, end, ruleStartPeriod, period, ruleStartPeriod, period, period,
        ruleStartPeriod, period, rule.id, period, rule.id, period).all<{
        id: string; title: string; owner_employee_id: string; lead_type: string; expected_cost: number; account_name: string;
        cost_center_id: string | null; cost_center_status: string | null; period_collected: number; cumulative_collected: number;
        invoiced: number; actual_project_cost: number; cost_allocation_count: number; period_cost_allocation_count: number;
        cost_allocation_updated_at: number; prior_payout: number; unresolved_prior_count: number }>();
    const blockedSources = sources.results.filter((source) => formula.eligibleLeadTypes.includes(source.lead_type)
      && source.owner_employee_id && source.invoiced > 0 && source.unresolved_prior_count > 0);
    if (blockedSources.length) return Response.json({
      error: `이전 정산월의 미확정 결과가 남아 있어 누적 정산을 중단했습니다. ${blockedSources.slice(0, 3).map((source) => source.title).join(", ")} 건을 승인·급여반영 또는 무효 처리해 주세요.`,
      blockedOpportunityIds: blockedSources.map((source) => source.id),
    }, { status: 409 });
    const statements: D1PreparedStatement[] = [];
    for (const source of sources.results) {
      if (!formula.eligibleLeadTypes.includes(source.lead_type) || !source.owner_employee_id || source.invoiced <= 0) continue;
      const periodCollected = Math.round(source.period_collected); const cumulativeRevenue = Math.round(source.cumulative_collected);
      const costRatio = Math.min(1, cumulativeRevenue / source.invoiced);
      const fallbackCost = Math.round(source.expected_cost * costRatio); const hasActualCost = Boolean(source.cost_center_id)
        && source.cost_center_status === "ACTIVE" && source.cost_allocation_count > 0;
      const cumulativeCost = hasActualCost ? Math.round(source.actual_project_cost) : fallbackCost;
      const cumulativeMargin = cumulativeRevenue - cumulativeCost; const cumulativeThreshold = Math.round(cumulativeRevenue * formula.thresholdMarginBps / 10000);
      const cumulativeEntitlement = Math.max(0, Math.round((cumulativeMargin - cumulativeThreshold) * formula.payoutRateBps / 10000));
      const settlementDifference = cumulativeEntitlement - Math.round(source.prior_payout); const payout = Math.max(0, settlementDifference);
      const calculation = { recognitionBasis: "CUMULATIVE_COLLECTED_PAYMENT_TRUE_UP", periodCollected, cumulativeRevenue,
        acceptedInvoiceTotal: source.invoiced, costBasis: hasActualCost ? "PROJECT_ALLOCATED_ACTUAL_COST" : "OPPORTUNITY_EXPECTED_COST_PRORATED",
        costQuality: hasActualCost ? "ACTUAL_PROJECT_COST" : "EXPECTED_COST_FALLBACK", costCenterId: source.cost_center_id || "",
        costCenterStatus: source.cost_center_status || "UNMAPPED", costAllocationCount: source.cost_allocation_count,
        costAllocationUpdatedAt: source.cost_allocation_updated_at,
        sourceExpectedCost: source.expected_cost, fallbackCost, costRatio, cumulativeCost, cumulativeMargin,
        thresholdMarginBps: formula.thresholdMarginBps, cumulativeThreshold, payoutRateBps: formula.payoutRateBps,
        cumulativeEntitlement, priorPayout: Math.round(source.prior_payout), settlementDifference,
        clawbackCandidate: Math.min(0, settlementDifference), payout };
      statements.push(db.prepare(`INSERT INTO sales_incentive_results
        (id, period, employee_id, opportunity_id, rule_id, rule_version, recognized_revenue, recognized_cost, payout_amount,
          calculation_json, status, sales_confirmed_at, finance_reviewed_at, representative_approved_at, payroll_ref, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', NULL, NULL, NULL, '', ?, ?)
        ON CONFLICT(period, employee_id, opportunity_id, rule_id) DO UPDATE SET recognized_revenue = excluded.recognized_revenue,
          recognized_cost = excluded.recognized_cost, payout_amount = excluded.payout_amount, calculation_json = excluded.calculation_json,
          updated_at = excluded.updated_at WHERE sales_incentive_results.status = 'DRAFT'`)
        .bind(crypto.randomUUID(), period, source.owner_employee_id, source.id, rule.id, rule.version, cumulativeRevenue, cumulativeCost, payout, JSON.stringify(calculation), now, now));
    }
    if (statements.length) await db.batch(statements);
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "INCENTIVE_PERIOD_CALCULATED", entityType: "salesIncentivePeriod", entityId: period, after: { ruleId: rule.id, sourceCount: sources.results.length, resultCount: statements.length } });
    return Response.json({ period, sourceCount: sources.results.length, resultCount: statements.length });
  }

  const resultId = String(body.resultId ?? "").trim();
  const result = resultId ? await db.prepare("SELECT * FROM sales_incentive_results WHERE id = ?").bind(resultId).first<Result>() : null;
  if (action === "SALES_CONFIRM") {
    if (!result || result.status !== "DRAFT") return Response.json({ error: "초안 정산만 영업 확인할 수 있습니다." }, { status: 409 });
    await db.prepare("UPDATE sales_incentive_results SET status = 'SALES_CONFIRMED', sales_confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'").bind(now, now, resultId).run();
    return Response.json({ id: resultId, status: "SALES_CONFIRMED" });
  }
  if (action === "FINANCE_REVIEW") {
    if (!result || result.status !== "SALES_CONFIRMED") return Response.json({ error: "영업 확인 완료 정산만 재무 검토할 수 있습니다." }, { status: 409 });
    const calculation = objectJson(result.calculation_json);
    if (calculation.costQuality !== "ACTUAL_PROJECT_COST") return Response.json({ error: "프로젝트·원가센터에 실제 원가를 배부한 뒤 정산 초안을 다시 계산해 주세요. 예상 원가 대체값은 지급 승인에 사용할 수 없습니다." }, { status: 409 });
    if (Number(calculation.clawbackCandidate ?? 0) < 0) return Response.json({ error: "누적 권리보다 과거 확정 지급액이 큽니다. 자동 차감하지 않고 환수·상계 기준을 먼저 확정해야 합니다." }, { status: 409 });
    const periodEnd = new Date(`${result.period}-01T00:00:00Z`); periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    const currentSource = await db.prepare(`SELECT center.id AS cost_center_id, center.status AS cost_center_status,
        COALESCE((SELECT SUM(payment.amount) FROM sales_documents payment WHERE payment.opportunity_id = opportunity.id
          AND payment.document_type = 'PAYMENT' AND payment.status IN ('ACCEPTED','COMPLETED')
          AND payment.issued_date >= rule.effective_from AND payment.issued_date < ?), 0) AS cumulative_collected,
        COALESCE((SELECT SUM(invoice.amount) FROM sales_documents invoice WHERE invoice.opportunity_id = opportunity.id
          AND invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED')), 0) AS invoiced,
        COALESCE((SELECT SUM(allocation.amount) FROM finance_project_allocations allocation
          WHERE allocation.cost_center_id = center.id AND allocation.direction = 'COST'
            AND allocation.period >= substr(rule.effective_from, 1, 7) AND allocation.period <= ?), 0) AS actual_project_cost,
        COALESCE((SELECT COUNT(*) FROM finance_project_allocations allocation
          WHERE allocation.cost_center_id = center.id AND allocation.direction = 'COST'
            AND allocation.period >= substr(rule.effective_from, 1, 7) AND allocation.period <= ?), 0) AS cost_allocation_count,
        COALESCE((SELECT MAX(allocation.updated_at) FROM finance_project_allocations allocation
          WHERE allocation.cost_center_id = center.id AND allocation.direction = 'COST'
            AND allocation.period >= substr(rule.effective_from, 1, 7) AND allocation.period <= ?), 0) AS cost_allocation_updated_at
      FROM sales_opportunities opportunity JOIN sales_incentive_rules rule ON rule.id = ?
      LEFT JOIN finance_cost_centers center ON center.opportunity_id = opportunity.id
      WHERE opportunity.id = ?`).bind(periodEnd.toISOString().slice(0, 10), result.period, result.period, result.period, result.rule_id, result.opportunity_id)
      .first<{ cost_center_id: string | null; cost_center_status: string | null; cumulative_collected: number; invoiced: number;
        actual_project_cost: number; cost_allocation_count: number; cost_allocation_updated_at: number }>();
    const stale = !currentSource || currentSource.cost_center_id !== calculation.costCenterId || currentSource.cost_center_status !== "ACTIVE"
      || Number(currentSource.cumulative_collected) !== Number(calculation.cumulativeRevenue)
      || Number(currentSource.invoiced) !== Number(calculation.acceptedInvoiceTotal)
      || Number(currentSource.actual_project_cost) !== Number(calculation.cumulativeCost)
      || Number(currentSource.cost_allocation_count) !== Number(calculation.costAllocationCount)
      || Number(currentSource.cost_allocation_updated_at) !== Number(calculation.costAllocationUpdatedAt);
    if (stale) return Response.json({ error: "수금·매출 또는 프로젝트 원가 배부가 계산 후 변경되었습니다. 영업 확인을 무효 처리하고 정산 초안을 다시 계산해 주세요." }, { status: 409 });
    await db.prepare("UPDATE sales_incentive_results SET status = 'FINANCE_REVIEWED', finance_reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'SALES_CONFIRMED'").bind(now, now, resultId).run();
    return Response.json({ id: resultId, status: "FINANCE_REVIEWED" });
  }
  if (action === "SUBMIT_PAYOUT") {
    if (!result || result.status !== "FINANCE_REVIEWED") return Response.json({ error: "재무 검토 완료 정산만 대표 승인을 요청할 수 있습니다." }, { status: 409 });
    const approval = await createApprovalRequest(db, authorization.principal, { module: "sales", requestType: "SPECIAL_INCENTIVE",
      title: `${result.period} 인센티브 ${result.payout_amount.toLocaleString("ko-KR")}원 승인`, description: "영업 확인·재무 검토 완료",
      targetEntityType: "INCENTIVE_RESULT", targetEntityId: result.id, amount: result.payout_amount,
      metadata: { period: result.period, employeeId: result.employee_id, opportunityId: result.opportunity_id, ruleId: result.rule_id, ruleVersion: result.rule_version } });
    await db.prepare("UPDATE sales_incentive_results SET status = 'SUBMITTED', updated_at = ? WHERE id = ? AND status = 'FINANCE_REVIEWED'").bind(now, resultId).run();
    return Response.json({ approvalId: approval.id, submitted: true }, { status: 202 });
  }
  if (action === "ADD_NOTE") {
    const note = String(body.note ?? "").trim(); const noteType = String(body.noteType ?? "REVIEW");
    if (!result || note.length < 5 || !["REVIEW", "DISPUTE", "RESOLUTION"].includes(noteType)) return Response.json({ error: "정산 결과와 5자 이상의 기록을 확인해 주세요." }, { status: 400 });
    const id = crypto.randomUUID(); await db.prepare(`INSERT INTO sales_incentive_notes
      (id, result_id, note_type, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, resultId, noteType, note, authorization.principal.employeeId, now).run();
    return Response.json({ id }, { status: 201 });
  }
  if (action === "VOID_RESULT") {
    const reason = String(body.reason ?? "").trim();
    if (!result || !["DRAFT", "SALES_CONFIRMED", "FINANCE_REVIEWED"].includes(result.status) || reason.length < 10)
      return Response.json({ error: "결재 제출 전 정산과 10자 이상의 무효 사유가 필요합니다." }, { status: 409 });
    const noteId = crypto.randomUUID();
    await db.batch([
      db.prepare("UPDATE sales_incentive_results SET status = 'VOID', updated_at = ? WHERE id = ? AND status = ?").bind(now, result.id, result.status),
      db.prepare(`INSERT INTO sales_incentive_notes (id, result_id, note_type, note, created_by, created_at)
        VALUES (?, ?, 'RESOLUTION', ?, ?, ?)`).bind(noteId, result.id, `정산 무효: ${reason}`, authorization.principal.employeeId, now),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "INCENTIVE_RESULT_VOIDED",
      entityType: "salesIncentiveResult", entityId: result.id, before: result, after: { status: "VOID", reason }, reason });
    return Response.json({ id: result.id, status: "VOID" });
  }
  if (action === "APPLY_PAYROLL") {
    if (!result || result.status !== "APPROVED" || !validPeriod(result.period)) return Response.json({ error: "대표 승인된 정산만 동일 월 급여에 반영할 수 있습니다." }, { status: 409 });
    const [run, payroll, linked] = await Promise.all([
      db.prepare("SELECT status FROM hr_payroll_runs WHERE period = ?").bind(result.period).first<{ status: string }>(),
      db.prepare("SELECT id FROM hr_payroll_records WHERE year_month = ? AND employee_id = ? LIMIT 1").bind(result.period, result.employee_id).first<{ id: string }>(),
      db.prepare("SELECT id FROM sales_incentive_payroll_links WHERE result_id = ?").bind(result.id).first<{ id: string }>(),
    ]);
    if (linked) return Response.json({ error: "이미 급여에 반영된 정산입니다." }, { status: 409 });
    if (!run || run.status !== "DRAFT" || !payroll) return Response.json({ error: "동일 월의 잠기지 않은 급여행이 필요합니다. 급여월과 직원 연결을 확인해 주세요." }, { status: 409 });
    const payrollRef = `${result.period}:${payroll.id}`;
    await db.batch([
      db.prepare(`INSERT INTO sales_incentive_payroll_links
        (id, result_id, payroll_period, payroll_record_id, applied_amount, applied_by, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), result.id, result.period, payroll.id, result.payout_amount, authorization.principal.employeeId, now),
      db.prepare(`UPDATE hr_payroll_records SET incentive = incentive + ?, gross_pay = gross_pay + ?, net_pay = net_pay + ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM hr_payroll_runs WHERE period = ? AND status = 'DRAFT')`)
        .bind(result.payout_amount, result.payout_amount, result.payout_amount, payroll.id, result.period),
      db.prepare("UPDATE sales_incentive_results SET status = 'PAYROLL_APPLIED', payroll_ref = ?, updated_at = ? WHERE id = ? AND status = 'APPROVED'")
        .bind(payrollRef, now, result.id),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "INCENTIVE_APPLIED_TO_PAYROLL", entityType: "salesIncentiveResult", entityId: result.id, before: result, after: { payrollRef, amount: result.payout_amount } });
    return Response.json({ id: result.id, status: "PAYROLL_APPLIED", payrollRef });
  }
  return Response.json({ error: "지원하지 않는 인센티브 작업입니다." }, { status: 400 });
}
