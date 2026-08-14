import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { calculateStraightLineDepreciation, monthsBetween } from "../../../fixed-asset-calculation.mjs";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type AssetRow = {
  id: string; asset_code: string; name: string; category: string; acquisition_date: string; in_service_date: string;
  acquisition_cost: number; residual_value: number; useful_life_months: number; depreciation_method: string;
  opening_accumulated: number; opening_as_of: string;
  asset_account_code: string; accumulated_account_code: string; expense_account_code: string; location: string;
  custodian_employee_id: string; source_type: string; source_id: string; source_reference: string; status: string;
  disposal_date: string; note: string; created_by: string; created_at: number; updated_at: number;
  posted_accumulated?: number; evidence_count?: number;
};
type ScheduleRow = { id: string; asset_id: string; period: string; opening_accumulated: number; depreciation_amount: number;
  closing_accumulated: number; closing_book_value: number; status: string; journal_entry_id: string; created_by: string;
  posted_by: string; posted_at: number | null; created_at: number; updated_at: number; asset_code?: string; asset_name?: string };

const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const validPeriod = (period: string) => /^2026-(0[1-9]|1[0-2])$/.test(period) && period <= currentPeriod;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);
const categories = new Set(["EQUIPMENT", "VEHICLE", "FURNITURE", "SOFTWARE", "LEASEHOLD", "OTHER"]);
const positiveAmount = (value: unknown, label: string, allowZero = false) => {
  const parsed = Math.round(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) throw new Error(`${label}을 확인해 주세요.`);
  return parsed;
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_fixed_assets (
      id TEXT PRIMARY KEY NOT NULL, asset_code TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
      acquisition_date TEXT NOT NULL, in_service_date TEXT NOT NULL, acquisition_cost INTEGER NOT NULL,
      residual_value INTEGER NOT NULL DEFAULT 0, useful_life_months INTEGER NOT NULL,
      depreciation_method TEXT NOT NULL DEFAULT 'STRAIGHT_LINE', opening_accumulated INTEGER NOT NULL DEFAULT 0,
      opening_as_of TEXT NOT NULL DEFAULT '', asset_account_code TEXT NOT NULL,
      accumulated_account_code TEXT NOT NULL, expense_account_code TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
      custodian_employee_id TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      source_reference TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT', disposal_date TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_asset_depreciation_schedules (
      id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL, period TEXT NOT NULL, opening_accumulated INTEGER NOT NULL DEFAULT 0,
      depreciation_amount INTEGER NOT NULL, closing_accumulated INTEGER NOT NULL, closing_book_value INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PLANNED', journal_entry_id TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      posted_by TEXT NOT NULL DEFAULT '', posted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_asset_events (
      id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL, event_type TEXT NOT NULL, event_date TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0, location TEXT NOT NULL DEFAULT '', custodian_employee_id TEXT NOT NULL DEFAULT '',
      journal_reference TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fixed_asset_code ON finance_fixed_assets(asset_code)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fixed_asset_source ON finance_fixed_assets(source_type, source_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_fixed_asset_status_service ON finance_fixed_assets(status, in_service_date)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_asset_depreciation_period ON finance_asset_depreciation_schedules(asset_id, period)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_asset_depreciation_journal ON finance_asset_depreciation_schedules(journal_entry_id) WHERE journal_entry_id <> ''"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_asset_depreciation_status_period ON finance_asset_depreciation_schedules(status, period)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_asset_event_asset_date ON finance_asset_events(asset_id, event_date)"),
  ]);
}

async function locked(period: string) {
  return (await db.prepare("SELECT status FROM finance_close_runs WHERE period = ?").bind(period).first<{ status: string }>())?.status === "CLOSED";
}

async function activeAccounts(codes: string[]) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (unique.length !== codes.length) return false;
  const rows = await Promise.all(unique.map((code) => db.prepare("SELECT id FROM finance_master_accounts WHERE code = ? AND status = 'ACTIVE'").bind(code).first()));
  return rows.every(Boolean);
}

async function purchaseCandidate(lineId: string) {
  return db.prepare(`SELECT order_line.id, order_line.item_name, order_line.description, purchase_order.order_number,
      vendor.name AS vendor_name, MAX(receipt.receipt_date) AS receipt_date,
      CAST(SUM(receipt_line.accepted_quantity_milli) AS INTEGER) AS accepted_quantity_milli,
      CAST(ROUND(SUM(receipt_line.accepted_quantity_milli * order_line.unit_price / 1000.0)) AS INTEGER) AS accepted_amount
    FROM finance_purchase_order_lines order_line
    JOIN finance_purchase_orders purchase_order ON purchase_order.id = order_line.order_id
    LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id
    JOIN finance_purchase_receipt_lines receipt_line ON receipt_line.order_line_id = order_line.id
    JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
    WHERE order_line.id = ? GROUP BY order_line.id`).bind(lineId).first<{
      id: string; item_name: string; description: string; order_number: string; vendor_name: string; receipt_date: string;
      accepted_quantity_milli: number; accepted_amount: number;
    }>();
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const period = new URL(request.url).searchParams.get("period")?.trim() || currentPeriod;
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 상각월을 선택해 주세요." }, { status: 400 });
  const [assets, schedules, candidates, events] = await Promise.all([
    db.prepare(`SELECT asset.*,
        asset.opening_accumulated + COALESCE((SELECT SUM(schedule.depreciation_amount) FROM finance_asset_depreciation_schedules schedule
          WHERE schedule.asset_id = asset.id AND schedule.status = 'POSTED'), 0) AS posted_accumulated,
        (SELECT COUNT(*) FROM erp_documents document WHERE document.module = 'finance'
          AND document.entity_type = 'financeFixedAsset' AND document.entity_id = asset.id AND document.deleted_at IS NULL) AS evidence_count
      FROM finance_fixed_assets asset ORDER BY CASE asset.status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END, asset.asset_code`).all<AssetRow>(),
    db.prepare(`SELECT schedule.*, asset.asset_code, asset.name AS asset_name FROM finance_asset_depreciation_schedules schedule
      JOIN finance_fixed_assets asset ON asset.id = schedule.asset_id WHERE schedule.period = ? ORDER BY asset.asset_code`).bind(period).all<ScheduleRow>(),
    db.prepare(`SELECT order_line.id, order_line.item_name, order_line.description, purchase_order.order_number,
        vendor.name AS vendor_name, MAX(receipt.receipt_date) AS receipt_date,
        CAST(SUM(receipt_line.accepted_quantity_milli) AS INTEGER) AS accepted_quantity_milli,
        CAST(ROUND(SUM(receipt_line.accepted_quantity_milli * order_line.unit_price / 1000.0)) AS INTEGER) AS accepted_amount
      FROM finance_purchase_order_lines order_line
      JOIN finance_purchase_orders purchase_order ON purchase_order.id = order_line.order_id
      LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id
      JOIN finance_purchase_receipt_lines receipt_line ON receipt_line.order_line_id = order_line.id
      JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
      WHERE NOT EXISTS (SELECT 1 FROM finance_fixed_assets asset WHERE asset.source_type = 'PURCHASE_ORDER_LINE' AND asset.source_id = order_line.id)
      GROUP BY order_line.id ORDER BY receipt_date DESC LIMIT 50`).all<Record<string, string | number>>(),
    db.prepare(`SELECT event.*, asset.asset_code, asset.name AS asset_name FROM finance_asset_events event
      JOIN finance_fixed_assets asset ON asset.id = event.asset_id ORDER BY event.event_date DESC, event.created_at DESC LIMIT 100`).all<Record<string, string | number>>(),
  ]);
  const active = assets.results.filter((row) => row.status === "ACTIVE");
  const acquisitionCost = active.reduce((sum, row) => sum + row.acquisition_cost, 0);
  const accumulated = active.reduce((sum, row) => sum + Number(row.posted_accumulated ?? 0), 0);
  return Response.json({ asOf: financeCurrentData.asOf, currentPeriod, period, locked: await locked(period), assets: assets.results,
    schedules: schedules.results, candidates: candidates.results, events: events.results,
    summary: { activeAssets: active.length, acquisitionCost, accumulatedDepreciation: accumulated,
      bookValue: acquisitionCost - accumulated, pendingSchedules: schedules.results.filter((row) => row.status !== "POSTED").length } });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "asset");
  const action = String(body.action ?? "CREATE").toUpperCase();
  const approvalAction = ["ACTIVATE", "POST_JOURNAL", "DISPOSE"].includes(action);
  const authorization = await authorizeErpRequest(db, "finance", approvalAction ? "approve" : "write");
  if (authorization.response) return authorization.response;
  const now = Date.now();

  if (resource === "asset" && action === "CREATE") {
    try {
      const assetCode = String(body.assetCode ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim(); const category = String(body.category ?? "OTHER");
      const acquisitionDate = String(body.acquisitionDate ?? "").trim(); const inServiceDate = String(body.inServiceDate ?? "").trim();
      const acquisitionCost = positiveAmount(body.acquisitionCost, "취득원가");
      const residualValue = positiveAmount(body.residualValue, "잔존가치", true);
      const usefulLifeMonths = Math.round(Number(body.usefulLifeMonths));
      const openingAccumulated = positiveAmount(body.openingAccumulated, "기초 누계상각", true);
      const openingAsOf = String(body.openingAsOf ?? "").trim();
      const assetAccountCode = String(body.assetAccountCode ?? "").trim();
      const accumulatedAccountCode = String(body.accumulatedAccountCode ?? "").trim();
      const expenseAccountCode = String(body.expenseAccountCode ?? "").trim();
      const sourceType = String(body.sourceType ?? "MANUAL");
      const requestedSourceId = String(body.sourceId ?? "").trim();
      const sourceId = sourceType === "MANUAL" ? crypto.randomUUID() : requestedSourceId;
      const sourceReference = String(body.sourceReference ?? "").trim();
      if (!assetCode || !name || !categories.has(category) || !validDate(acquisitionDate) || !validDate(inServiceDate)
        || acquisitionDate > inServiceDate || acquisitionDate > financeCurrentData.asOf || inServiceDate > financeCurrentData.asOf
        || residualValue >= acquisitionCost || !Number.isInteger(usefulLifeMonths)
        || usefulLifeMonths < 1 || usefulLifeMonths > 600 || openingAccumulated > acquisitionCost - residualValue
        || (openingAsOf && (!validDate(openingAsOf) || openingAsOf < acquisitionDate || openingAsOf > financeCurrentData.asOf))
        || (!openingAsOf && openingAccumulated > 0) || !["MANUAL", "PURCHASE_ORDER_LINE"].includes(sourceType)) {
        return Response.json({ error: "자산코드·명칭·분류·일자·원가·잔존가치·내용연수를 확인해 주세요." }, { status: 400 });
      }
      if (!await activeAccounts([assetAccountCode, accumulatedAccountCode, expenseAccountCode])) return Response.json({ error: "서로 다른 활성 자산·감가상각누계액·감가상각비 계정코드를 지정해 주세요." }, { status: 409 });
      if (sourceType === "MANUAL" && sourceReference.length < 3) return Response.json({ error: "수기 등록은 인보이스·계약서 등 원천 참조를 입력해 주세요." }, { status: 400 });
      if (sourceType === "PURCHASE_ORDER_LINE") {
        const candidate = await purchaseCandidate(sourceId);
        if (!candidate || acquisitionCost > candidate.accepted_amount) return Response.json({ error: "입고 완료 구매 품목과 취득원가 범위를 확인해 주세요." }, { status: 409 });
      }
      const id = crypto.randomUUID();
      await db.prepare(`INSERT INTO finance_fixed_assets
        (id, asset_code, name, category, acquisition_date, in_service_date, acquisition_cost, residual_value,
          useful_life_months, depreciation_method, opening_accumulated, opening_as_of, asset_account_code, accumulated_account_code, expense_account_code,
          location, custodian_employee_id, source_type, source_id, source_reference, status, disposal_date, note,
          created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'STRAIGHT_LINE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', '', ?, ?, ?, ?)`)
        .bind(id, assetCode, name, category, acquisitionDate, inServiceDate, acquisitionCost, residualValue, usefulLifeMonths,
          openingAccumulated, openingAsOf, assetAccountCode, accumulatedAccountCode, expenseAccountCode, String(body.location ?? "").trim(),
          String(body.custodianEmployeeId ?? "").trim(), sourceType, sourceId, sourceReference,
          String(body.note ?? "").trim().slice(0, 2000), authorization.principal.employeeId, now, now).run();
      const after = await db.prepare("SELECT * FROM finance_fixed_assets WHERE id = ?").bind(id).first<AssetRow>();
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "FIXED_ASSET_CREATED",
        entityType: "financeFixedAsset", entityId: id, after });
      return Response.json({ item: after }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "고정자산을 등록하지 못했습니다.";
      return Response.json({ error: /UNIQUE/.test(message) ? "같은 자산코드 또는 구매 원천이 이미 등록되어 있습니다." : message }, { status: /UNIQUE/.test(message) ? 409 : 400 });
    }
  }

  const assetId = String(body.assetId ?? "").trim();
  const asset = assetId ? await db.prepare("SELECT * FROM finance_fixed_assets WHERE id = ?").bind(assetId).first<AssetRow>() : null;
  if (resource === "asset" && !asset) return Response.json({ error: "고정자산을 찾지 못했습니다." }, { status: 404 });

  if (resource === "asset" && action === "ACTIVATE" && asset) {
    if (asset.status !== "DRAFT") return Response.json({ error: "작성 중인 자산만 활성화할 수 있습니다." }, { status: 409 });
    const evidence = await db.prepare(`SELECT COUNT(*) AS count FROM erp_documents WHERE module = 'finance'
      AND entity_type = 'financeFixedAsset' AND entity_id = ? AND deleted_at IS NULL`).bind(asset.id).first<{ count: number }>();
    if (Number(evidence?.count ?? 0) < 1) return Response.json({ error: "취득 증빙을 1건 이상 첨부한 후 활성화해 주세요." }, { status: 409 });
    if (!await activeAccounts([asset.asset_account_code, asset.accumulated_account_code, asset.expense_account_code])) return Response.json({ error: "활성 계정과목 연결을 다시 확인해 주세요." }, { status: 409 });
    const latestClosed = await db.prepare("SELECT MAX(period) AS period FROM finance_close_runs WHERE status = 'CLOSED'").first<{ period: string | null }>();
    if (latestClosed?.period && asset.in_service_date.slice(0, 7) <= latestClosed.period
      && (!asset.opening_as_of || asset.opening_as_of.slice(0, 7) < latestClosed.period)) {
      return Response.json({ error: `${latestClosed.period}까지 마감되어 있습니다. 해당 월말 기준 기초 누계상각과 기준일을 등록해 주세요.` }, { status: 409 });
    }
    await db.prepare("UPDATE finance_fixed_assets SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status = 'DRAFT'").bind(now, asset.id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "FIXED_ASSET_ACTIVATED",
      entityType: "financeFixedAsset", entityId: asset.id, before: asset, after: { ...asset, status: "ACTIVE" } });
    return Response.json({ id: asset.id, status: "ACTIVE" });
  }

  if (resource === "asset" && action === "TRANSFER" && asset) {
    if (asset.status !== "ACTIVE") return Response.json({ error: "활성 자산만 이동할 수 있습니다." }, { status: 409 });
    const eventDate = String(body.eventDate ?? "").trim(); const location = String(body.location ?? "").trim();
    const custodian = String(body.custodianEmployeeId ?? "").trim(); const reason = String(body.reason ?? "").trim();
    if (!validDate(eventDate) || reason.length < 5) return Response.json({ error: "이동일과 5자 이상의 이동 사유를 입력해 주세요." }, { status: 400 });
    const eventId = crypto.randomUUID();
    await db.batch([
      db.prepare(`INSERT INTO finance_asset_events (id, asset_id, event_type, event_date, amount, location,
        custodian_employee_id, journal_reference, reason, created_by, created_at)
        VALUES (?, ?, 'TRANSFER', ?, 0, ?, ?, '', ?, ?, ?)`).bind(eventId, asset.id, eventDate, location, custodian, reason, authorization.principal.employeeId, now),
      db.prepare("UPDATE finance_fixed_assets SET location = ?, custodian_employee_id = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'")
        .bind(location, custodian, now, asset.id),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "FIXED_ASSET_TRANSFERRED",
      entityType: "financeFixedAsset", entityId: asset.id, before: asset, after: { location, custodian, reason, eventDate } });
    return Response.json({ id: asset.id, eventId });
  }

  if (resource === "asset" && action === "DISPOSE" && asset) {
    if (asset.status !== "ACTIVE") return Response.json({ error: "활성 자산만 처분할 수 있습니다." }, { status: 409 });
    const eventDate = String(body.eventDate ?? "").trim(); const reason = String(body.reason ?? "").trim();
    const journalReference = String(body.journalReference ?? "").trim(); const proceeds = positiveAmount(body.amount, "처분가액", true);
    if (!validDate(eventDate) || eventDate < asset.in_service_date || eventDate > financeCurrentData.asOf || reason.length < 5 || journalReference.length < 3) return Response.json({ error: "처분일·처분가액·5자 이상의 사유·처분전표 참조를 확인해 주세요." }, { status: 400 });
    if (await locked(eventDate.slice(0, 7))) return Response.json({ error: "잠긴 마감월에는 자산 처분을 기록할 수 없습니다." }, { status: 409 });
    const unposted = await db.prepare(`SELECT COUNT(*) AS count FROM finance_asset_depreciation_schedules
      WHERE asset_id = ? AND period <= ? AND status <> 'POSTED'`).bind(asset.id, eventDate.slice(0, 7)).first<{ count: number }>();
    if (Number(unposted?.count ?? 0) > 0) return Response.json({ error: "처분일까지의 미전기 감가상각을 먼저 처리해 주세요." }, { status: 409 });
    const eventId = crypto.randomUUID();
    await db.batch([
      db.prepare(`INSERT INTO finance_asset_events (id, asset_id, event_type, event_date, amount, location,
        custodian_employee_id, journal_reference, reason, created_by, created_at)
        VALUES (?, ?, 'DISPOSAL', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(eventId, asset.id, eventDate, proceeds, asset.location, asset.custodian_employee_id, journalReference, reason, authorization.principal.employeeId, now),
      db.prepare("UPDATE finance_fixed_assets SET status = 'DISPOSED', disposal_date = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'")
        .bind(eventDate, now, asset.id),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "FIXED_ASSET_DISPOSED",
      entityType: "financeFixedAsset", entityId: asset.id, before: asset, after: { status: "DISPOSED", eventDate, proceeds, journalReference, reason } });
    return Response.json({ id: asset.id, status: "DISPOSED", eventId });
  }

  if (resource === "depreciation" && action === "GENERATE") {
    const period = String(body.period ?? "").trim();
    if (!validPeriod(period)) return Response.json({ error: "상각월을 확인해 주세요." }, { status: 400 });
    if (await locked(period)) return Response.json({ error: "잠긴 마감월에는 감가상각 계획을 생성할 수 없습니다." }, { status: 409 });
    const eligible = await db.prepare(`SELECT * FROM finance_fixed_assets WHERE status = 'ACTIVE'
      AND substr(in_service_date, 1, 7) <= ? AND (disposal_date = '' OR substr(disposal_date, 1, 7) >= ?)`)
      .bind(period, period).all<AssetRow>();
    const statements: D1PreparedStatement[] = [];
    for (const row of eligible.results) {
      const monthIndex = monthsBetween(row.in_service_date.slice(0, 7), period);
      if (monthIndex < 0 || monthIndex >= row.useful_life_months || (row.opening_as_of && row.opening_as_of.slice(0, 7) >= period)) continue;
      const existing = await db.prepare("SELECT id FROM finance_asset_depreciation_schedules WHERE asset_id = ? AND period = ?").bind(row.id, period).first();
      if (existing) continue;
      const baseline = row.opening_as_of ? row.opening_as_of.slice(0, 7) : row.in_service_date.slice(0, 7);
      const priorMonths = Math.max(0, monthsBetween(baseline, period) - (row.opening_as_of ? 1 : 0));
      const priorPosted = await db.prepare(`SELECT COUNT(*) AS count FROM finance_asset_depreciation_schedules
        WHERE asset_id = ? AND status = 'POSTED' AND period > ? AND period < ?`)
        .bind(row.id, row.opening_as_of ? row.opening_as_of.slice(0, 7) : "0000-00", period).first<{ count: number }>();
      if (Number(priorPosted?.count ?? 0) < priorMonths) continue;
      const posted = await db.prepare("SELECT COALESCE(SUM(depreciation_amount), 0) AS amount FROM finance_asset_depreciation_schedules WHERE asset_id = ? AND status = 'POSTED' AND period < ?")
        .bind(row.id, period).first<{ amount: number }>();
      const calculation = calculateStraightLineDepreciation({ acquisitionCost: row.acquisition_cost, residualValue: row.residual_value,
        usefulLifeMonths: row.useful_life_months, inServicePeriod: row.in_service_date.slice(0, 7), period,
        openingAccumulated: row.opening_accumulated, postedAccumulated: Number(posted?.amount ?? 0) });
      const { opening, depreciation, closingAccumulated, closingBookValue } = calculation;
      if (!depreciation) continue;
      statements.push(db.prepare(`INSERT INTO finance_asset_depreciation_schedules
        (id, asset_id, period, opening_accumulated, depreciation_amount, closing_accumulated, closing_book_value,
          status, journal_entry_id, created_by, posted_by, posted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PLANNED', '', ?, '', NULL, ?, ?)`)
        .bind(crypto.randomUUID(), row.id, period, opening, depreciation, closingAccumulated,
          closingBookValue, authorization.principal.employeeId, now, now));
    }
    if (statements.length) await db.batch(statements);
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "ASSET_DEPRECIATION_GENERATED",
      entityType: "financeAssetDepreciation", entityId: period, after: { generated: statements.length, method: "STRAIGHT_LINE", convention: "FULL_MONTH" } });
    return Response.json({ period, generated: statements.length });
  }

  const scheduleId = String(body.scheduleId ?? "").trim();
  if (resource === "depreciation" && scheduleId) {
    const schedule = await db.prepare(`SELECT schedule.*, asset.asset_code, asset.name AS asset_name,
      asset.expense_account_code, asset.accumulated_account_code FROM finance_asset_depreciation_schedules schedule
      JOIN finance_fixed_assets asset ON asset.id = schedule.asset_id WHERE schedule.id = ?`).bind(scheduleId).first<ScheduleRow & { expense_account_code: string; accumulated_account_code: string }>();
    if (!schedule) return Response.json({ error: "감가상각 계획을 찾지 못했습니다." }, { status: 404 });
    if (await locked(schedule.period)) return Response.json({ error: "잠긴 마감월에는 감가상각 전표를 변경할 수 없습니다." }, { status: 409 });
    if (action === "CREATE_JOURNAL") {
      if (schedule.status !== "PLANNED") return Response.json({ error: "계획 상태의 상각만 전표 초안을 만들 수 있습니다." }, { status: 409 });
      const [expenseAccount, accumulatedAccount] = await Promise.all([
        db.prepare("SELECT name FROM finance_master_accounts WHERE code = ? AND status = 'ACTIVE'").bind(schedule.expense_account_code).first<{ name: string }>(),
        db.prepare("SELECT name FROM finance_master_accounts WHERE code = ? AND status = 'ACTIVE'").bind(schedule.accumulated_account_code).first<{ name: string }>(),
      ]);
      if (!expenseAccount || !accumulatedAccount || schedule.expense_account_code === schedule.accumulated_account_code) return Response.json({ error: "활성 감가상각비·누계액 계정 연결을 확인해 주세요." }, { status: 409 });
      const journalId = crypto.randomUUID(); const paymentRef = `asset-dep:${schedule.asset_id}:${schedule.period}`;
      await db.batch([
        db.prepare(`INSERT INTO finance_journal_entries (id, payment_request_id, voucher_date, description,
          debit_account_code, debit_account_name, credit_account_code, credit_account_name, amount, status,
          prepared_by, posted_by, posted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, '', NULL, ?, ?)`)
          .bind(journalId, paymentRef, `${schedule.period}-28`, `${schedule.asset_code} ${schedule.asset_name} 월 감가상각`,
            schedule.expense_account_code, expenseAccount.name, schedule.accumulated_account_code, accumulatedAccount.name, schedule.depreciation_amount,
            authorization.principal.employeeId, now, now),
        db.prepare("UPDATE finance_asset_depreciation_schedules SET status = 'DRAFTED', journal_entry_id = ?, updated_at = ? WHERE id = ? AND status = 'PLANNED'")
          .bind(journalId, now, schedule.id),
      ]);
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "ASSET_DEPRECIATION_JOURNAL_CREATED",
        entityType: "financeAssetDepreciation", entityId: schedule.id, before: schedule, after: { journalId, status: "DRAFTED" } });
      return Response.json({ scheduleId: schedule.id, journalId, status: "DRAFTED" }, { status: 201 });
    }
    if (action === "POST_JOURNAL") {
      if (schedule.status !== "DRAFTED" || !schedule.journal_entry_id) return Response.json({ error: "전표 초안이 있는 상각만 전기할 수 있습니다." }, { status: 409 });
      const result = await db.batch([
        db.prepare("UPDATE finance_journal_entries SET status = 'POSTED', posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'")
          .bind(authorization.principal.employeeId, now, now, schedule.journal_entry_id),
        db.prepare(`UPDATE finance_asset_depreciation_schedules SET status = 'POSTED', posted_by = ?, posted_at = ?, updated_at = ?
          WHERE id = ? AND status = 'DRAFTED' AND EXISTS (SELECT 1 FROM finance_journal_entries WHERE id = ? AND status = 'POSTED' AND updated_at = ?)`)
          .bind(authorization.principal.employeeId, now, now, schedule.id, schedule.journal_entry_id, now),
      ]);
      if ((result[0].meta.changes ?? 0) < 1 || (result[1].meta.changes ?? 0) < 1) return Response.json({ error: "전표 상태가 변경되어 전기하지 못했습니다." }, { status: 409 });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "ASSET_DEPRECIATION_POSTED",
        entityType: "financeAssetDepreciation", entityId: schedule.id, before: schedule, after: { status: "POSTED", postedBy: authorization.principal.employeeId } });
      return Response.json({ scheduleId: schedule.id, status: "POSTED" });
    }
  }
  return Response.json({ error: "지원하지 않는 고정자산 작업입니다." }, { status: 400 });
}
