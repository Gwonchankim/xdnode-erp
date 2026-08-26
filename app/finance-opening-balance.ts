import { financeHistoricalData } from "./finance-historical-data";

// XD NODE의 실제 계정체계(2024/2025 결산 시산표 기준)는 4자리 코드다: 1=자산, 2=부채, 3=자본,
// 4=매출·매출원가 혼재(예: 4019 상품매출, 4519 상품매출원가), 8=판관비, 9=영업외수익·비용 혼재.
// 4·9로 시작하는 코드는 수익·비용이 같은 첫자리를 공유하므로, 이름 신호가 없으면 코드만으로 추정하지
// 않고 OTHER(미분류)로 남긴다 — 잘못된 추정보다 눈에 띄는 미분류가 안전하다.
export function openingAccountCategory(code: string, name: string) {
  const first = Number(code.slice(0, 1));
  if (first === 1) return "ASSET"; if (first === 2) return "LIABILITY"; if (first === 3) return "EQUITY";
  if (/원가|비용|차손|손실|충당금전입|상각비/.test(name)) return "EXPENSE";
  if (/매출|차익|수익|수입|이익/.test(name)) return "REVENUE";
  if ([5, 6, 7, 8].includes(first)) return "EXPENSE";
  return "OTHER";
}

export function normalBalanceFor(category: string) {
  return ["LIABILITY", "EQUITY", "REVENUE"].includes(category) ? "CREDIT" : "DEBIT";
}

export type StatementLine = "SALES_REVENUE" | "NON_OPERATING_INCOME" | "COGS" | "SGA" | "NON_OPERATING_EXPENSE" | "INCOME_TAX";

// Sub-classifies REVENUE/EXPENSE accounts into income-statement lines so 매출총이익·영업이익을 낼 수
// 있게 한다. openingAccountCategory()가 REVENUE/EXPENSE로 판정하는 모든 계정은 이름 키워드 매칭을
// 거치거나(코드 기반 REVENUE 폴백은 없음), EXPENSE는 코드 5~8 폴백을 거쳐 도달하므로, 아래 분기가
// 그 두 경로를 그대로 따라간다 — 새 신호를 추가로 지어내지 않는다.
export function statementLineFor(category: string, code: string, name: string): StatementLine | "" {
  if (category === "REVENUE") return /매출/.test(name) ? "SALES_REVENUE" : "NON_OPERATING_INCOME";
  if (category === "EXPENSE") {
    if (/법인세/.test(name)) return "INCOME_TAX";
    if (/원가/.test(name)) return "COGS";
    if (/\(판\)|판관비/.test(name)) return "SGA";
    const first = Number(code.slice(0, 1));
    if (first === 5) return "COGS";
    if ([6, 7, 8].includes(first)) return "SGA";
    return "NON_OPERATING_EXPENSE";
  }
  return "";
}

export type Liquidity = "CURRENT" | "NON_CURRENT";

// ASSET/LIABILITY를 유동·비유동으로 나눈다. 신호가 없으면 CURRENT로 둔다 — 실제 2025 시산표에서
// 자산 5개 전부, 부채 5개 중 4개가 유동이라 이 방향이 이 회사 계정 구성에서 더 안전한 기본값이다.
export function liquidityFor(category: string, name: string): Liquidity | "" {
  if (category !== "ASSET" && category !== "LIABILITY") return "";
  return /장기|비유동|유형자산|무형자산|투자자산|투자부동산|보증금|사채|감가상각누계액|퇴직급여충당부채/.test(name) ? "NON_CURRENT" : "CURRENT";
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
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`${id}:${index+1}`,id,index+1,row.code?`acct:${row.code}`:"",row.code,row.name,category,normalBalanceFor(category),row.endingDebit,row.endingCredit,`ECOUNT_TB_2025:${index+1}`,now);});
  for(let index=0;index<statements.length;index+=50)await db.batch(statements.slice(index,index+50));
  await db.prepare(`INSERT OR IGNORE INTO finance_opening_balance_events(id,set_id,action,from_status,to_status,actor_employee_id,note,snapshot_json,created_at)
    VALUES (?,?, 'DRAFT_CREATED','','DRAFT',?,'승인된 2025 결산 원본에서 금액 편집 없이 생성','{}',?)`).bind(`${id}:created`,id,actor,now).run();return id;
}

export async function approvedOpeningRows(db:D1Database){
  const set=await db.prepare("SELECT * FROM finance_opening_balance_sets WHERE fiscal_year=2026 AND status='APPROVED' ORDER BY version DESC LIMIT 1").first<Record<string,unknown>>();
  if(!set)return null;const lines=await db.prepare("SELECT * FROM finance_opening_balance_lines WHERE set_id=? ORDER BY line_number").bind(String(set.id)).all<Record<string,unknown>>();
  return {set,rows:lines.results.map(row=>({code:String(row.account_code),name:String(row.account_name),endingDebit:Number(row.debit_amount),endingCredit:Number(row.credit_amount),category:String(row.account_category)}))};
}
