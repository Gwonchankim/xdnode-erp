import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, blockedFinancePeriods, writeErpAudit } from "../../../erp-platform";
import { ensureFinanceImportMappingSchema } from "../../../finance-import-mapping";
import { ensureFinancePostingSchema } from "../../../finance-posting";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type Row = Record<string, unknown>;

function parse(value: unknown) { try { const result = JSON.parse(String(value ?? "{}")); return result && typeof result === "object" && !Array.isArray(result) ? result as Row : {}; } catch { return {}; } }
function text(value: unknown) { return String(value ?? "").trim(); }
function validDate(value: string) { if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value; }
function safeSegment(value: unknown) { return text(value).normalize("NFKC").replace(/[^0-9A-Za-z가-힣_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "NOREF"; }

async function ensureSchemas() { await ensureFinanceImportMappingSchema(db); await ensureFinancePostingSchema(db); }
async function addEvent(batchId: string, action: string, fromStatus: string, toStatus: string, actor: string, note: string, snapshot: unknown = {}) {
  await db.prepare(`INSERT INTO finance_posting_events (id,batch_id,action,from_status,to_status,actor_employee_id,note,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), batchId, action, fromStatus, toStatus, actor, note, JSON.stringify(snapshot), Date.now()).run();
}
async function view(selectedBatchId = "") {
  const [candidates, batches, taxCodes, closed] = await Promise.all([
    db.prepare(`SELECT validation.*, source_batch.file_name, source.name AS source_name,
      (SELECT id FROM finance_posting_batches posting WHERE posting.validation_id=validation.id) AS posting_batch_id
      FROM finance_import_validations validation
      JOIN erp_data_import_batches source_batch ON source_batch.id=validation.batch_id
      JOIN erp_integration_sources source ON source.id=source_batch.source_id
      WHERE validation.data_type='JOURNAL' AND validation.status='PASSED'
      ORDER BY validation.created_at DESC LIMIT 50`).all<Row>(),
    db.prepare(`SELECT posting.*, source_batch.file_name, source.name AS source_name
      FROM finance_posting_batches posting
      LEFT JOIN erp_data_import_batches source_batch ON source_batch.id=posting.source_batch_id
      LEFT JOIN erp_integration_sources source ON source.id=source_batch.source_id
      ORDER BY posting.created_at DESC LIMIT 80`).all<Row>(),
    db.prepare("SELECT id,code,name,direction,rate_basis_points FROM finance_master_tax_codes WHERE status='ACTIVE' ORDER BY code").all<Row>().catch(() => ({ results: [] })),
    db.prepare("SELECT period FROM finance_close_runs WHERE status='CLOSED' ORDER BY period DESC").all<Row>().catch(() => ({ results: [] })),
  ]);
  const batchId = selectedBatchId || String(batches.results[0]?.id ?? "");
  const [vouchers, lines, events] = batchId ? await Promise.all([
    db.prepare("SELECT * FROM finance_posting_vouchers WHERE batch_id=? ORDER BY voucher_date,source_voucher_key").bind(batchId).all<Row>(),
    db.prepare(`SELECT line.*,voucher.source_voucher_key,voucher.voucher_date,voucher.voucher_number
      FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id
      WHERE voucher.batch_id=? ORDER BY voucher.voucher_date,voucher.source_voucher_key,line.line_number`).bind(batchId).all<Row>(),
    db.prepare("SELECT * FROM finance_posting_events WHERE batch_id=? ORDER BY created_at DESC LIMIT 80").bind(batchId).all<Row>(),
  ]) : [{ results: [] }, { results: [] }, { results: [] }];
  return { candidates: candidates.results, batches: batches.results, selectedBatchId: batchId, vouchers: vouchers.results, lines: lines.results, events: events.results, taxCodes: taxCodes.results, closedPeriods: closed.results.map((row) => row.period), controls: { sourceTypes: ["JOURNAL"], automaticPosting: false, amountEditing: false, taxReviewRequired: true, closedPeriodPosting: false, postedMutation: false, correctionMode: "REVERSAL_ONLY" } };
}

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "admin"); if (authorization.response) return authorization.response;
  await ensureSchemas(); const url = new URL(request.url); return Response.json({ principal: authorization.principal, ...(await view(url.searchParams.get("batchId") ?? "")) });
}

async function createDraft(validationId: string, actor: string) {
  const validation = await db.prepare(`SELECT validation.*,source_batch.source_id,source_batch.id AS source_batch_id
    FROM finance_import_validations validation JOIN erp_data_import_batches source_batch ON source_batch.id=validation.batch_id
    WHERE validation.id=? AND validation.status='PASSED' AND validation.data_type='JOURNAL'`).bind(validationId).first<Row>();
  if (!validation) throw new Error("검증 통과한 분개장 정규화 원장을 찾지 못했습니다.");
  if (await db.prepare("SELECT id FROM finance_posting_batches WHERE validation_id=?").bind(validationId).first()) throw new Error("이 검증 결과로 이미 분개 초안을 만들었습니다.");
  const sourceRows = await db.prepare("SELECT * FROM finance_import_canonical_rows WHERE validation_id=? AND validation_status='VALID' ORDER BY row_number").bind(validationId).all<Row>();
  if (sourceRows.results.length !== Number(validation.row_count)) throw new Error("검증 당시 행 수와 현재 정규화 행 수가 다릅니다. 다시 검증해 주세요.");
  const groups = new Map<string, { date: string; sourceKey: string; description: string; reference: string; rows: Array<{ row: Row; value: Row }> }>();
  for (const row of sourceRows.results) {
    const value = parse(row.canonical_json); const date = text(value.voucherDate); const sourceKey = text(value.voucherNumber);
    if (!validDate(date) || !sourceKey) throw new Error(`행 ${row.row_number}: 전표일과 원천 전표번호가 필요합니다.`);
    const key = `${date}:${sourceKey}`; const group = groups.get(key) ?? { date, sourceKey, description: text(value.description), reference: text(value.sourceReference), rows: [] }; group.rows.push({ row, value }); groups.set(key, group);
  }
  const periods = [...groups.values()].map((group) => group.date.slice(0, 7)); const locked = await blockedFinancePeriods(db, periods); if (locked.length) throw new Error(`마감 또는 미개방 회계기간은 초안을 만들 수 없습니다: ${locked.join(", ")}`);
  let totalDebit = 0, totalCredit = 0, lineCount = 0; for (const group of groups.values()) { const debit = group.rows.reduce((sum, item) => sum + Number(item.value.debitAmount || 0), 0); const credit = group.rows.reduce((sum, item) => sum + Number(item.value.creditAmount || 0), 0); if (debit !== credit) throw new Error(`${group.date} 전표 ${group.sourceKey}: 차변·대변 ${Math.abs(debit - credit).toLocaleString("ko-KR")}원 불일치`); totalDebit += debit; totalCredit += credit; lineCount += group.rows.length; }
  if (!groups.size || totalDebit !== totalCredit) throw new Error("전기 초안 전체 차변·대변이 일치하지 않습니다.");
  const batchId = crypto.randomUUID(); const now = Date.now(); const sortedPeriods = [...new Set(periods)].sort(); const batchNumber = `IMP-DRAFT-${batchId.slice(0, 8).toUpperCase()}`;
  await db.prepare(`INSERT INTO finance_posting_batches (id,validation_id,source_batch_id,batch_number,source_type,status,period_from,period_to,voucher_count,line_count,total_debit,total_credit,difference_amount,prepared_by,created_at,updated_at)
    VALUES (?,?,?,?, 'IMPORT','DRAFT',?,?,?,?,?,?,0,?,?,?)`).bind(batchId, validationId, String(validation.source_batch_id), batchNumber, sortedPeriods[0], sortedPeriods.at(-1), groups.size, lineCount, totalDebit, totalCredit, actor, now, now).run();
  const voucherStatements: D1PreparedStatement[] = []; const lineStatements: D1PreparedStatement[] = [];
  for (const group of groups.values()) {
    const voucherId = crypto.randomUUID(); const debit = group.rows.reduce((sum, item) => sum + Number(item.value.debitAmount || 0), 0); const credit = group.rows.reduce((sum, item) => sum + Number(item.value.creditAmount || 0), 0);
    voucherStatements.push(db.prepare(`INSERT INTO finance_posting_vouchers (id,batch_id,source_voucher_key,voucher_date,period,description,source_reference,status,line_count,total_debit,total_credit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?)`).bind(voucherId, batchId, group.sourceKey, group.date, group.date.slice(0, 7), group.description, group.reference, group.rows.length, debit, credit, now, now));
    group.rows.forEach((item, index) => lineStatements.push(db.prepare(`INSERT INTO finance_posting_lines (id,voucher_id,line_number,account_id,account_code,account_name,partner_id,partner_name,department_id,department_name,description,debit_amount,credit_amount,source_canonical_row_id,source_checksum,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), voucherId, index + 1, text(item.value.accountId), text(item.value.accountCode), text(item.value.accountName), text(item.value.partnerId), text(item.value.partnerName), text(item.value.departmentId), text(item.value.department), text(item.value.description), Number(item.value.debitAmount || 0), Number(item.value.creditAmount || 0), String(item.row.id), String(item.row.source_checksum), now, now)));
  }
  try { for (let index = 0; index < voucherStatements.length; index += 50) await db.batch(voucherStatements.slice(index, index + 50)); for (let index = 0; index < lineStatements.length; index += 50) await db.batch(lineStatements.slice(index, index + 50)); }
  catch (error) { await db.batch([db.prepare("DELETE FROM finance_posting_lines WHERE voucher_id IN (SELECT id FROM finance_posting_vouchers WHERE batch_id=?)").bind(batchId), db.prepare("DELETE FROM finance_posting_vouchers WHERE batch_id=?").bind(batchId), db.prepare("DELETE FROM finance_posting_batches WHERE id=?").bind(batchId)]); throw error; }
  await addEvent(batchId, "DRAFT_CREATED", "", "DRAFT", actor, "검증 통과 정규화 원장에서 다행 분개 초안 생성", { validationId, voucherCount: groups.size, lineCount, totalDebit, totalCredit }); return batchId;
}

async function assertReady(batchId: string, expectedStatus: string) {
  const batch = await db.prepare("SELECT * FROM finance_posting_batches WHERE id=? AND status=?").bind(batchId, expectedStatus).first<Row>(); if (!batch) throw new Error(`${expectedStatus} 상태의 전기 배치를 찾지 못했습니다.`);
  const [vouchers, lines] = await Promise.all([db.prepare("SELECT * FROM finance_posting_vouchers WHERE batch_id=?").bind(batchId).all<Row>(), db.prepare("SELECT line.* FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.batch_id=?").bind(batchId).all<Row>()]);
  if (!vouchers.results.length || lines.results.length !== Number(batch.line_count)) throw new Error("전표 또는 분개 행 수가 초안 생성 시점과 다릅니다.");
  const unbalanced = vouchers.results.filter((row) => Number(row.total_debit) !== Number(row.total_credit)); if (unbalanced.length || Number(batch.total_debit) !== Number(batch.total_credit)) throw new Error("차변·대변이 일치하지 않는 전표가 있습니다.");
  const locked = await blockedFinancePeriods(db, vouchers.results.map((row) => String(row.period))); if (locked.length) throw new Error(`마감 또는 미개방 회계기간은 처리할 수 없습니다: ${locked.join(", ")}`);
  const pendingTax = lines.results.filter((row) => row.tax_review_status !== "REVIEWED"); if (pendingTax.length) throw new Error(`세금 검토가 완료되지 않은 분개 ${pendingTax.length}행이 있습니다.`);
  const invalidAccount = await db.prepare(`SELECT COUNT(*) AS count FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id LEFT JOIN finance_master_accounts account ON account.id=line.account_id AND account.status='ACTIVE' WHERE voucher.batch_id=? AND account.id IS NULL`).bind(batchId).first<{ count: number }>(); if (Number(invalidAccount?.count ?? 0)) throw new Error("비활성 또는 존재하지 않는 계정과목이 포함되어 있습니다.");
  const invalidTax = await db.prepare(`SELECT COUNT(*) AS count FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id LEFT JOIN finance_master_tax_codes tax ON tax.id=line.tax_code_id AND tax.status='ACTIVE' WHERE voucher.batch_id=? AND line.tax_code_id<>'' AND tax.id IS NULL`).bind(batchId).first<{ count: number }>(); if (Number(invalidTax?.count ?? 0)) throw new Error("비활성 또는 존재하지 않는 세금코드가 포함되어 있습니다.");
  return { batch, vouchers: vouchers.results, lines: lines.results };
}

async function postBatch(batchId: string, actor: string) {
  const ready = await assertReady(batchId, "APPROVED"); const source = await db.prepare(`SELECT source.source_code FROM finance_posting_batches posting LEFT JOIN erp_data_import_batches import_batch ON import_batch.id=posting.source_batch_id LEFT JOIN erp_integration_sources source ON source.id=import_batch.source_id WHERE posting.id=?`).bind(batchId).first<{ source_code: string }>(); const prefix = ready.batch.source_type === "REVERSAL" ? "REV" : "IMP"; const sourceCode = safeSegment(source?.source_code || ready.batch.source_type).slice(0, 18); const now = Date.now(); const statements: D1PreparedStatement[] = [];
  for (const voucher of ready.vouchers) { const finalNumber = prefix === "REV" ? `REV-${String(voucher.period).replace("-", "")}-${safeSegment(voucher.source_voucher_key)}`.slice(0, 100) : `IMP-${sourceCode}-${String(voucher.voucher_date).replaceAll("-", "")}-${safeSegment(voucher.source_voucher_key)}`.slice(0, 100); statements.push(db.prepare("UPDATE finance_posting_vouchers SET voucher_number=?,status='POSTED',updated_at=? WHERE id=? AND status='DRAFT'").bind(finalNumber, now, String(voucher.id))); }
  statements.push(db.prepare("UPDATE finance_posting_batches SET status='POSTED',posted_by=?,posted_at=?,version=version+1,updated_at=? WHERE id=? AND status='APPROVED'").bind(actor, now, now, batchId));
  await db.batch(statements); await addEvent(batchId, "POSTED", "APPROVED", "POSTED", actor, "마감·균형·세금·활성 마스터 재검증 후 전기", { voucherCount: ready.vouchers.length, lineCount: ready.lines.length, totalDebit: ready.batch.total_debit, totalCredit: ready.batch.total_credit });
}

async function createReversal(originalBatchId: string, reversalDate: string, reason: string, actor: string) {
  if (!validDate(reversalDate) || reason.length < 5) throw new Error("수정분개 일자와 5자 이상의 사유를 입력해 주세요."); if ((await blockedFinancePeriods(db, [reversalDate.slice(0, 7)])).length) throw new Error("마감 또는 미개방 기간에는 수정분개를 만들 수 없습니다.");
  const original = await db.prepare("SELECT * FROM finance_posting_batches WHERE id=? AND status='POSTED'").bind(originalBatchId).first<Row>(); if (!original) throw new Error("전기 완료된 원배치만 수정분개할 수 있습니다."); if (await db.prepare("SELECT id FROM finance_posting_batches WHERE reversal_of_batch_id=?").bind(originalBatchId).first()) throw new Error("이미 수정분개 배치가 존재합니다.");
  const [vouchers, lines] = await Promise.all([db.prepare("SELECT * FROM finance_posting_vouchers WHERE batch_id=? ORDER BY id").bind(originalBatchId).all<Row>(), db.prepare(`SELECT line.* FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.batch_id=? ORDER BY voucher.id,line.line_number`).bind(originalBatchId).all<Row>()]); const batchId = crypto.randomUUID(); const now = Date.now();
  await db.prepare(`INSERT INTO finance_posting_batches (id,batch_number,source_type,reversal_of_batch_id,status,period_from,period_to,voucher_count,line_count,total_debit,total_credit,difference_amount,reason,prepared_by,created_at,updated_at) VALUES (?,?,'REVERSAL',?,'DRAFT',?,?,?,?,?,?,0,?,?,?,?)`).bind(batchId, `REV-DRAFT-${batchId.slice(0, 8).toUpperCase()}`, originalBatchId, reversalDate.slice(0, 7), reversalDate.slice(0, 7), vouchers.results.length, lines.results.length, Number(original.total_credit), Number(original.total_debit), reason, actor, now, now).run();
  const voucherIds = new Map<string,string>(); const statements: D1PreparedStatement[] = [];
  for (const voucher of vouchers.results) { const id = crypto.randomUUID(); voucherIds.set(String(voucher.id), id); statements.push(db.prepare(`INSERT INTO finance_posting_vouchers (id,batch_id,source_voucher_key,voucher_date,period,description,source_reference,status,line_count,total_debit,total_credit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?)`).bind(id, batchId, String(voucher.voucher_number), reversalDate, reversalDate.slice(0, 7), `수정분개: ${String(voucher.description)}`, String(voucher.voucher_number), Number(voucher.line_count), Number(voucher.total_credit), Number(voucher.total_debit), now, now)); }
  for (const line of lines.results) statements.push(db.prepare(`INSERT INTO finance_posting_lines (id,voucher_id,line_number,account_id,account_code,account_name,partner_id,partner_name,department_id,department_name,tax_code_id,tax_code,tax_code_name,tax_review_status,tax_review_note,tax_reviewed_by,tax_reviewed_at,description,debit_amount,credit_amount,reversal_of_line_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'REVIEWED','원전표 세금검토 승계',?,?,?, ?,?,?,?, ?,?)`).bind(crypto.randomUUID(), voucherIds.get(String(line.voucher_id)), Number(line.line_number), String(line.account_id), String(line.account_code), String(line.account_name), String(line.partner_id), String(line.partner_name), String(line.department_id), String(line.department_name), String(line.tax_code_id), String(line.tax_code), String(line.tax_code_name), actor, now, `수정분개: ${String(line.description)}`, Number(line.credit_amount), Number(line.debit_amount), String(line.id), now, now));
  try { for (let index=0;index<statements.length;index+=50) await db.batch(statements.slice(index,index+50)); } catch (error) { await db.batch([db.prepare("DELETE FROM finance_posting_lines WHERE voucher_id IN (SELECT id FROM finance_posting_vouchers WHERE batch_id=?)").bind(batchId),db.prepare("DELETE FROM finance_posting_vouchers WHERE batch_id=?").bind(batchId),db.prepare("DELETE FROM finance_posting_batches WHERE id=?").bind(batchId)]); throw error; }
  await addEvent(batchId,"REVERSAL_DRAFT_CREATED","","DRAFT",actor,reason,{originalBatchId,reversalDate}); await addEvent(originalBatchId,"REVERSAL_LINKED","POSTED","POSTED",actor,reason,{reversalBatchId:batchId}); return batchId;
}

export async function POST(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "admin"); if (authorization.response) return authorization.response; await ensureSchemas(); const body=await request.json() as Row; const action=text(body.action); const actor=authorization.principal.employeeId; let batchId=text(body.batchId);
  try {
    if (action === "CREATE_DRAFT") batchId=await createDraft(text(body.validationId),actor);
    else {
      const batch=await db.prepare("SELECT * FROM finance_posting_batches WHERE id=?").bind(batchId).first<Row>(); if (!batch) return Response.json({error:"전기 배치를 찾지 못했습니다."},{status:404});
      if (action === "REVIEW_TAX") { if (batch.status !== "DRAFT") return Response.json({error:"초안에서만 세금 검토를 수정할 수 있습니다."},{status:409}); const lineId=text(body.lineId); const taxCodeId=text(body.taxCodeId); const note=text(body.note); if (!taxCodeId && note.length<3) return Response.json({error:"세금코드가 없으면 해당 없음 사유를 3자 이상 입력해 주세요."},{status:400}); let tax:Row|null=null; if (taxCodeId) { tax=await db.prepare("SELECT id,code,name FROM finance_master_tax_codes WHERE id=? AND status='ACTIVE'").bind(taxCodeId).first<Row>(); if (!tax) return Response.json({error:"활성 세금코드만 선택할 수 있습니다."},{status:409}); }
        const now=Date.now(); const result=await db.prepare(`UPDATE finance_posting_lines SET tax_code_id=?,tax_code=?,tax_code_name=?,tax_review_status='REVIEWED',tax_review_note=?,tax_reviewed_by=?,tax_reviewed_at=?,updated_at=? WHERE id=? AND voucher_id IN (SELECT id FROM finance_posting_vouchers WHERE batch_id=?)`).bind(taxCodeId,text(tax?.code),text(tax?.name),note,actor,now,now,lineId,batchId).run(); if (!result.meta.changes) return Response.json({error:"검토할 분개 행을 찾지 못했습니다."},{status:404}); await addEvent(batchId,"TAX_REVIEWED","DRAFT","DRAFT",actor,note||text(tax?.name),{lineId,taxCodeId});
      } else if (action === "SUBMIT") { const ready=await assertReady(batchId,"DRAFT"); const approval=await createApprovalRequest(db,authorization.principal,{module:"finance",requestType:"JOURNAL_POSTING",title:`${String(ready.batch.batch_number)} 분개 전기 승인`,description:`전표 ${ready.vouchers.length}건 · 분개 ${ready.lines.length}행 · 차변/대변 ${Number(ready.batch.total_debit).toLocaleString("ko-KR")}원`,targetEntityType:"FINANCE_POSTING_BATCH",targetEntityId:batchId,amount:Number(ready.batch.total_debit),priority:"CRITICAL",metadata:{periodFrom:ready.batch.period_from,periodTo:ready.batch.period_to,sourceType:ready.batch.source_type}}); const now=Date.now(); await db.prepare("UPDATE finance_posting_batches SET status='SUBMITTED',approval_request_id=?,submitted_at=?,version=version+1,updated_at=? WHERE id=? AND status='DRAFT'").bind(approval.id,now,now,batchId).run(); await addEvent(batchId,"SUBMITTED","DRAFT","SUBMITTED",actor,"분개 전기 결재 제출",{approvalRequestId:approval.id});
      } else if (action === "POST") await postBatch(batchId,actor);
      else if (action === "CREATE_REVERSAL") batchId=await createReversal(batchId,text(body.reversalDate),text(body.reason),actor);
      else return Response.json({error:"지원하지 않는 전기 작업입니다."},{status:400});
    }
    await writeErpAudit(db,{principal:authorization.principal,module:"finance",action:`JOURNAL_${action}`,entityType:"FINANCE_POSTING_BATCH",entityId:batchId,reason:text(body.reason),after:{validationId:body.validationId??"",lineId:body.lineId??""}}); return Response.json({principal:authorization.principal,...(await view(batchId))});
  } catch(error) { return Response.json({error:error instanceof Error?error.message:"분개 전기 작업을 완료하지 못했습니다."},{status:500}); }
}
