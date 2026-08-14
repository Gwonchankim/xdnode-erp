import { financeHistoricalData } from "./finance-historical-data";

export function openingAccountCategory(code: string, name: string) {
  const first = Number(code.slice(0, 1));
  if (first === 1) return "ASSET"; if (first === 2) return "LIABILITY"; if (first === 3) return "EQUITY";
  if (/원가|비용|차손/.test(name) || [6,7,8].includes(first)) return "EXPENSE";
  if (/매출|차익|수입|잡이익/.test(name) || [4,5].includes(first)) return "REVENUE";
  return "OTHER";
}

export async function ensureFinanceOpeningBalanceSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_opening_balance_sets (
      id TEXT PRIMARY KEY NOT NULL,fiscal_year INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'DRAFT',
      source_label TEXT NOT NULL,source_as_of TEXT NOT NULL,source_checksum TEXT NOT NULL,line_count INTEGER NOT NULL DEFAULT 0,
      total_debit INTEGER NOT NULL DEFAULT 0,total_credit INTEGER NOT NULL DEFAULT 0,difference_amount INTEGER NOT NULL DEFAULT 0,
      approval_request_id TEXT NOT NULL DEFAULT '',reason TEXT NOT NULL DEFAULT '',prepared_by TEXT NOT NULL,
      approved_by TEXT NOT NULL DEFAULT '',submitted_at INTEGER,approved_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_opening_year_version ON finance_opening_balance_sets(fiscal_year,version)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_opening_approved_year ON finance_opening_balance_sets(fiscal_year) WHERE status='APPROVED'"),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_opening_balance_lines (
      id TEXT PRIMARY KEY NOT NULL,set_id TEXT NOT NULL,line_number INTEGER NOT NULL,account_id TEXT NOT NULL DEFAULT '',
      account_code TEXT NOT NULL,account_name TEXT NOT NULL,account_category TEXT NOT NULL,normal_balance TEXT NOT NULL,
      debit_amount INTEGER NOT NULL DEFAULT 0,credit_amount INTEGER NOT NULL DEFAULT 0,source_reference TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_opening_line_number ON finance_opening_balance_lines(set_id,line_number)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_opening_line_account ON finance_opening_balance_lines(set_id,account_code,account_name)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_opening_balance_events (
      id TEXT PRIMARY KEY NOT NULL,set_id TEXT NOT NULL,action TEXT NOT NULL,from_status TEXT NOT NULL DEFAULT '',to_status TEXT NOT NULL DEFAULT '',
      actor_employee_id TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',snapshot_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL)`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_opening_event_created ON finance_opening_balance_events(set_id,created_at)"),
  ]);
}

async function checksum(value: unknown) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((item)=>item.toString(16).padStart(2,"0")).join("");
}

export async function seedOpeningBalanceDraft(db:D1Database,actor:string){
  const id="opening:2026:v1";if(await db.prepare("SELECT id FROM finance_opening_balance_sets WHERE id=?").bind(id).first())return id;
  const source=financeHistoricalData.trialBalance2025;const totalDebit=source.reduce((sum,row)=>sum+row.endingDebit,0);const totalCredit=source.reduce((sum,row)=>sum+row.endingCredit,0);
  const now=Date.now();await db.prepare(`INSERT OR IGNORE INTO finance_opening_balance_sets
    (id,fiscal_year,version,status,source_label,source_as_of,source_checksum,line_count,total_debit,total_credit,difference_amount,prepared_by,created_at,updated_at)
    VALUES (?,2026,1,'DRAFT','2025 결산후 합계잔액시산표','2025-12-31',?,?,?,?,?,?,?,?)`)
    .bind(id,await checksum(source),source.length,totalDebit,totalCredit,totalDebit-totalCredit,actor,now,now).run();
  const statements=source.map((row,index)=>{const category=openingAccountCategory(row.code,row.name);return db.prepare(`INSERT OR IGNORE INTO finance_opening_balance_lines
    (id,set_id,line_number,account_id,account_code,account_name,account_category,normal_balance,debit_amount,credit_amount,source_reference,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`${id}:${index+1}`,id,index+1,row.code?`acct:${row.code}`:"",row.code,row.name,category,["LIABILITY","EQUITY","REVENUE"].includes(category)?"CREDIT":"DEBIT",row.endingDebit,row.endingCredit,`ECOUNT_TB_2025:${index+1}`,now);});
  for(let index=0;index<statements.length;index+=50)await db.batch(statements.slice(index,index+50));
  await db.prepare(`INSERT OR IGNORE INTO finance_opening_balance_events(id,set_id,action,from_status,to_status,actor_employee_id,note,snapshot_json,created_at)
    VALUES (?,?, 'DRAFT_CREATED','','DRAFT',?,'승인된 2025 결산 원본에서 금액 편집 없이 생성','{}',?)`).bind(`${id}:created`,id,actor,now).run();return id;
}

export async function approvedOpeningRows(db:D1Database){
  const set=await db.prepare("SELECT * FROM finance_opening_balance_sets WHERE fiscal_year=2026 AND status='APPROVED' ORDER BY version DESC LIMIT 1").first<Record<string,unknown>>();
  if(!set)return null;const lines=await db.prepare("SELECT * FROM finance_opening_balance_lines WHERE set_id=? ORDER BY line_number").bind(String(set.id)).all<Record<string,unknown>>();
  return {set,rows:lines.results.map(row=>({code:String(row.account_code),name:String(row.account_name),endingDebit:Number(row.debit_amount),endingCredit:Number(row.credit_amount),category:String(row.account_category)}))};
}
