"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import readXlsxFile from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";
import styles from "./incentive.module.css";

type DealKind = "일반" | "인바운드" | "단독 RAM" | "케이블" | "온라인";
type AdjustmentKind = "추가지급" | "차감" | "복지기금 전환";

type Deal = {
  id: string;
  person: string;
  date: string;
  client: string;
  item: string;
  quantity: number;
  unitCost: number;
  unitSale: number;
  expense: number;
  kind: DealKind;
  excluded: boolean;
};

type Adjustment = {
  id: string;
  person: string;
  kind: AdjustmentKind;
  amount: number;
  note: string;
};

type ImportedCell = string | number | boolean | Date | null;

const DEAL_STORAGE = "xdnode-incentive-deals-v1";
const ADJUSTMENT_STORAGE = "xdnode-incentive-adjustments-v1";
const KINDS: DealKind[] = ["일반", "인바운드", "단독 RAM", "케이블", "온라인"];
const EXCLUDED_KINDS = new Set<DealKind>(["인바운드", "단독 RAM", "케이블", "온라인"]);

const emptyDeal = (): Deal => ({
  id: crypto.randomUUID(),
  person: "",
  date: new Date().toISOString().slice(0, 10),
  client: "",
  item: "",
  quantity: 1,
  unitCost: 0,
  unitSale: 0,
  expense: 0,
  kind: "일반",
  excluded: false,
});

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/[₩원,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").replace(/[\s_()]/g, "").toLowerCase();
}

function excelDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 30000 && value < 70000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  return String(value ?? "").slice(0, 10);
}

function findColumn(headers: unknown[], candidates: string[]) {
  const normalized = headers.map(normalizeHeader);
  return normalized.findIndex((header) => candidates.some((candidate) => header === normalizeHeader(candidate)));
}

function inferKind(value: unknown, person: unknown, item: unknown): DealKind {
  const text = `${value ?? ""} ${person ?? ""} ${item ?? ""}`.toLowerCase();
  if (text.includes("인바운드")) return "인바운드";
  if (text.includes("온라인") || text.includes("스마트스토어")) return "온라인";
  if (text.includes("케이블") || text.includes("cable")) return "케이블";
  if (text.includes("단독 ram") || text.includes("단독램")) return "단독 RAM";
  return "일반";
}

function parseRows(rows: ImportedCell[][]) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => ["담당자", "발주일", "매출처", "품목"].includes(String(cell ?? "").trim())));
  if (headerIndex < 0) throw new Error("헤더 행을 찾지 못했습니다. 담당자·품목·수량·원가·매출 열을 확인해 주세요.");
  const headers = rows[headerIndex];
  const col = {
    person: findColumn(headers, ["담당자", "이름", "성명"]),
    date: findColumn(headers, ["매출계산서일", "발주일", "거래일", "일자"]),
    client: findColumn(headers, ["매출처", "거래처", "고객사"]),
    item: findColumn(headers, ["품목", "상품명", "제품명"]),
    quantity: findColumn(headers, ["수량", "qty"]),
    unitCost: findColumn(headers, ["원가", "매입가", "매입단가"]),
    purchaseTotal: findColumn(headers, ["매입합", "매입합계", "원가합계"]),
    unitSale: findColumn(headers, ["매출", "판매가", "매출단가"]),
    salesTotal: findColumn(headers, ["매출합", "매출합계", "판매합계"]),
    expense: findColumn(headers, ["비용", "경비", "부대비용"]),
    kind: findColumn(headers, ["구분", "유형", "인센구분", "대상구분"]),
  };
  if (col.person < 0 || col.item < 0 || col.quantity < 0) throw new Error("필수 열(담당자·품목·수량)이 부족합니다.");

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const person = String(row[col.person] ?? "").trim();
    const item = String(row[col.item] ?? "").trim();
    const quantity = Math.max(1, asNumber(row[col.quantity]));
    if (!person || !item) return [];
    const purchaseTotal = col.purchaseTotal >= 0 ? asNumber(row[col.purchaseTotal]) : 0;
    const salesTotal = col.salesTotal >= 0 ? asNumber(row[col.salesTotal]) : 0;
    const unitCost = col.unitCost >= 0 ? asNumber(row[col.unitCost]) : purchaseTotal / quantity;
    const unitSale = col.unitSale >= 0 ? asNumber(row[col.unitSale]) : salesTotal / quantity;
    const kind = inferKind(col.kind >= 0 ? row[col.kind] : "", person, item);
    return [{
      id: crypto.randomUUID(),
      person,
      date: col.date >= 0 ? excelDate(row[col.date]) : "",
      client: col.client >= 0 ? String(row[col.client] ?? "") : "",
      item,
      quantity,
      unitCost,
      unitSale,
      expense: col.expense >= 0 ? asNumber(row[col.expense]) : 0,
      kind,
      excluded: EXCLUDED_KINDS.has(kind),
    } satisfies Deal];
  });
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = "";
    } else value += char;
  }
  row.push(value); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function calculate(deal: Deal) {
  const sales = deal.quantity * deal.unitSale;
  const purchase = deal.quantity * deal.unitCost;
  const margin = sales - purchase - deal.expense;
  const threshold = sales * 0.05;
  const incentive = deal.excluded ? 0 : Math.max((margin - threshold) * 0.05, 0);
  return { sales, purchase, margin, threshold, incentive };
}

function won(value: number) {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(value))}원`;
}

export default function IncentiveCalculator() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [draft, setDraft] = useState<Deal>(() => emptyDeal());
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("거래를 직접 입력하거나 엑셀 파일을 불러오세요.");
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [adjustmentDraft, setAdjustmentDraft] = useState({ person: "", kind: "추가지급" as AdjustmentKind, amount: 0, note: "" });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedDeals = localStorage.getItem(DEAL_STORAGE);
        const savedAdjustments = localStorage.getItem(ADJUSTMENT_STORAGE);
        if (savedDeals) setDeals(JSON.parse(savedDeals));
        if (savedAdjustments) setAdjustments(JSON.parse(savedAdjustments));
      } catch { setMessage("저장된 이력을 읽지 못했습니다. 새 계산으로 시작합니다."); }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(DEAL_STORAGE, JSON.stringify(deals));
    localStorage.setItem(ADJUSTMENT_STORAGE, JSON.stringify(adjustments));
  }, [deals, adjustments, hydrated]);

  const people = useMemo(() => Array.from(new Set([...deals.map((deal) => deal.person), ...adjustments.map((item) => item.person)].filter(Boolean))).sort(), [deals, adjustments]);

  const summaries = useMemo(() => people.map((person) => {
    const ownDeals = deals.filter((deal) => deal.person === person);
    const ownAdjustments = adjustments.filter((item) => item.person === person);
    const base = ownDeals.reduce((acc, deal) => {
      const result = calculate(deal);
      acc.sales += result.sales; acc.margin += result.margin; acc.incentive += result.incentive;
      if (deal.excluded) acc.excluded += result.sales;
      return acc;
    }, { sales: 0, margin: 0, incentive: 0, excluded: 0 });
    const extra = ownAdjustments.filter((item) => item.kind === "추가지급").reduce((sum, item) => sum + item.amount, 0);
    const deduction = ownAdjustments.filter((item) => item.kind === "차감").reduce((sum, item) => sum + item.amount, 0);
    const welfare = ownAdjustments.filter((item) => item.kind === "복지기금 전환").reduce((sum, item) => sum + item.amount, 0);
    const approved = Math.max(base.incentive + extra - deduction, 0);
    return { person, ...base, extra, deduction, welfare: Math.min(welfare, approved), approved, payroll: Math.max(approved - welfare, 0), count: ownDeals.length };
  }), [people, deals, adjustments]);

  const totals = useMemo(() => summaries.reduce((acc, item) => {
    acc.sales += item.sales; acc.margin += item.margin; acc.approved += item.approved; acc.payroll += item.payroll; acc.welfare += item.welfare;
    return acc;
  }, { sales: 0, margin: 0, approved: 0, payroll: 0, welfare: 0 }), [summaries]);

  function addDeal() {
    if (!draft.person.trim() || !draft.item.trim()) { setMessage("담당자와 품목을 입력해 주세요."); return; }
    setDeals((current) => [...current, { ...draft, person: draft.person.trim(), item: draft.item.trim() }]);
    setDraft({ ...emptyDeal(), person: draft.person, date: draft.date });
    setMessage("거래 1건을 추가했습니다.");
  }

  async function importSheet(selectedSheet: string, selectedFile = file) {
    if (!selectedFile) return;
    try {
      const workbookSheets = await readXlsxFile(selectedFile);
      const rows = workbookSheets.find((item) => item.sheet === selectedSheet)?.data as ImportedCell[][] | undefined;
      if (!rows) throw new Error("선택한 시트를 찾지 못했습니다.");
      const parsed = parseRows(rows);
      if (!parsed.length) throw new Error("가져올 거래가 없습니다.");
      setDeals(parsed);
      setAdjustments([]);
      setSheet(selectedSheet);
      setMessage(`${selectedSheet}에서 거래 ${parsed.length.toLocaleString("ko-KR")}건을 불러왔습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "엑셀을 읽지 못했습니다."); }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    if (selected.name.toLowerCase().endsWith(".csv")) {
      try {
        const parsed = parseRows(parseCsv(await selected.text()));
        setDeals(parsed); setAdjustments([]); setSheets([]); setSheet("");
        setMessage(`CSV에서 거래 ${parsed.length.toLocaleString("ko-KR")}건을 불러왔습니다.`);
      } catch (error) { setMessage(error instanceof Error ? error.message : "CSV를 읽지 못했습니다."); }
      return;
    }
    try {
      const workbookSheets = await readXlsxFile(selected);
      const names = workbookSheets.map((item) => item.sheet);
      if (!names.length) throw new Error("시트를 찾지 못했습니다.");
      setSheets(names);
      const rows = workbookSheets[0].data as ImportedCell[][];
      const parsed = parseRows(rows);
      if (!parsed.length) throw new Error("가져올 거래가 없습니다.");
      setDeals(parsed); setAdjustments([]); setSheet(names[0]);
      setMessage(`${names[0]}에서 거래 ${parsed.length.toLocaleString("ko-KR")}건을 불러왔습니다.`);
    } catch { setMessage("지원되는 .xlsx 또는 .csv 파일인지 확인해 주세요."); }
  }

  function addAdjustment() {
    if (!adjustmentDraft.person || adjustmentDraft.amount <= 0) { setMessage("조정 대상과 금액을 입력해 주세요."); return; }
    setAdjustments((current) => [...current, { id: crypto.randomUUID(), ...adjustmentDraft }]);
    setAdjustmentDraft((current) => ({ ...current, amount: 0, note: "" }));
    setMessage("지급 조정을 반영했습니다.");
  }

  function loadExample() {
    setDeals([
      { ...emptyDeal(), person: "김민성", client: "리안시스템", item: "PRO 5000", quantity: 2, unitCost: 8190000, unitSale: 8950000, expense: 12455 },
      { ...emptyDeal(), person: "김민성", client: "온라인몰", item: "서버 케이블", quantity: 4, unitCost: 110000, unitSale: 150000, expense: 2990, kind: "케이블", excluded: true },
      { ...emptyDeal(), person: "이세현", client: "대학교 산학협력단", item: "DGX Spark", quantity: 2, unitCost: 6607091, unitSale: 7700000, expense: 0 },
    ]);
    setAdjustments([]);
    setMessage("예시 거래를 불러왔습니다. 자유롭게 수정하거나 삭제해 보세요.");
  }

  async function exportResults() {
    const header = ["담당자", "거래건수", "총매출", "총마진", "기본 인센", "추가지급", "차감", "승인 인센", "급여 인센", "복지기금"];
    const rows = summaries.map((item) => [item.person, item.count, item.sales, item.margin, item.incentive, item.extra, item.deduction, item.approved, item.payroll, item.welfare]);
    const data = [header, ...rows].map((row, rowIndex) => row.map((value) => ({ value, fontWeight: rowIndex === 0 ? "bold" as const : undefined, backgroundColor: rowIndex === 0 ? "E8EEF0" : undefined })));
    await writeXlsxFile(data, { fileName: `개인별_인센티브_${new Date().toISOString().slice(0, 10)}.xlsx` });
    setMessage("개인별 인센티브 결과를 엑셀로 저장했습니다.");
  }

  function clearAll() {
    if (!confirm("현재 거래와 조정 내역을 모두 지울까요?")) return;
    setDeals([]); setAdjustments([]); setFile(null); setSheets([]); setSheet("");
    if (fileInput.current) fileInput.current.value = "";
    setMessage("새 계산으로 초기화했습니다.");
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}><span>XD</span><div><strong>인센티브 계산기</strong><small>PERSONAL WORKSPACE</small></div></Link>
        <div className={styles.saved}><i /> 이 브라우저에 자동 저장</div>
      </header>

      <div className={styles.container}>
        <section className={styles.hero}>
          <div><p>2026 INCENTIVE RULE</p><h1>매출을 넣으면<br />지급액까지 한 번에.</h1><span>거래별 초과마진을 계산하고, 제외 매출과 지급 조정을 반영해 개인별 급여 입력액을 만듭니다.</span></div>
          <div className={styles.formula}><small>현재 적용 산식</small><strong>MAX((마진 − 매출×5%) × 5%, 0)</strong><p>인바운드 · 단독 RAM · 케이블 · 온라인은 기본 제외</p></div>
        </section>

        <section className={styles.kpis}>
          <article><span>총 매출</span><strong>{won(totals.sales)}</strong><small>{deals.length.toLocaleString("ko-KR")}건의 거래</small></article>
          <article><span>총 마진</span><strong>{won(totals.margin)}</strong><small>비용 차감 후</small></article>
          <article className={styles.darkCard}><span>승인 인센티브</span><strong>{won(totals.approved)}</strong><small>추가·차감 반영</small></article>
          <article><span>급여 인센 열</span><strong>{won(totals.payroll)}</strong><small>복지기금 {won(totals.welfare)} 별도</small></article>
        </section>

        <section className={styles.workGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><p>DATA IMPORT</p><h2>거래 불러오기</h2></div><button type="button" onClick={loadExample}>예시 불러오기</button></div>
            <button className={styles.dropzone} type="button" onClick={() => fileInput.current?.click()}>
              <span>↑</span><div><strong>엑셀 또는 CSV 선택</strong><small>현재 인센정리 형식의 담당자·품목·수량·원가·매출 열을 자동 인식합니다.</small></div>
              <input ref={fileInput} type="file" accept=".xlsx,.csv" onChange={onFile} />
            </button>
            {sheets.length > 1 && <label className={styles.sheetSelect}>계산할 시트<select value={sheet} onChange={(event) => importSheet(event.target.value)}>{sheets.map((name) => <option key={name}>{name}</option>)}</select></label>}
            <div className={styles.notice}>{message}</div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}><div><p>DIRECT INPUT</p><h2>거래 직접 입력</h2></div></div>
            <div className={styles.dealForm}>
              <label>담당자<input value={draft.person} onChange={(e) => setDraft({ ...draft, person: e.target.value })} placeholder="예: 김민성" /></label>
              <label>거래일<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
              <label>거래처<input value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })} placeholder="매출처" /></label>
              <label className={styles.wide}>품목<input value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} placeholder="제품명" /></label>
              <label>수량<input type="number" min="1" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: asNumber(e.target.value) })} /></label>
              <label>개당 원가<input type="number" min="0" value={draft.unitCost} onChange={(e) => setDraft({ ...draft, unitCost: asNumber(e.target.value) })} /></label>
              <label>개당 매출<input type="number" min="0" value={draft.unitSale} onChange={(e) => setDraft({ ...draft, unitSale: asNumber(e.target.value) })} /></label>
              <label>비용<input type="number" min="0" value={draft.expense} onChange={(e) => setDraft({ ...draft, expense: asNumber(e.target.value) })} /></label>
              <label>구분<select value={draft.kind} onChange={(e) => { const kind = e.target.value as DealKind; setDraft({ ...draft, kind, excluded: EXCLUDED_KINDS.has(kind) }); }}>{KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
              <button type="button" className={styles.addButton} onClick={addDeal}>거래 추가</button>
            </div>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}><div><p>DEAL REVIEW</p><h2>거래별 계산 내역</h2></div><span>{deals.length}건</span></div>
          <div className={styles.tableWrap}><table><thead><tr><th>담당자 / 거래</th><th>구분</th><th>매출합</th><th>마진</th><th>기준마진</th><th>인센티브</th><th>지급</th><th /></tr></thead>
          <tbody>{deals.map((deal) => { const result = calculate(deal); return <tr key={deal.id} className={deal.excluded ? styles.excludedRow : undefined}>
            <td><strong>{deal.person}</strong><small>{deal.client} · {deal.item}</small></td>
            <td><select value={deal.kind} onChange={(e) => { const kind = e.target.value as DealKind; setDeals((items) => items.map((item) => item.id === deal.id ? { ...item, kind, excluded: EXCLUDED_KINDS.has(kind) } : item)); }}>{KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></td>
            <td>{won(result.sales)}</td><td>{won(result.margin)}</td><td>{won(result.threshold)}</td><td><strong>{won(result.incentive)}</strong></td>
            <td><label className={styles.switch}><span className="sr-only">지급 포함</span><input type="checkbox" checked={!deal.excluded} onChange={() => setDeals((items) => items.map((item) => item.id === deal.id ? { ...item, excluded: !item.excluded } : item))} /><span /></label></td>
            <td><button className={styles.delete} onClick={() => setDeals((items) => items.filter((item) => item.id !== deal.id))}>삭제</button></td>
          </tr>; })}{!deals.length && <tr><td colSpan={8} className={styles.empty}>아직 거래가 없습니다. 엑셀을 불러오거나 첫 거래를 입력해 주세요.</td></tr>}</tbody></table></div>
        </section>

        <section className={styles.workGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><p>PAYMENT ADJUSTMENT</p><h2>지급 조정</h2></div></div>
            <div className={styles.adjustForm}>
              <label>대상<select value={adjustmentDraft.person} onChange={(e) => setAdjustmentDraft({ ...adjustmentDraft, person: e.target.value })}><option value="">선택</option>{people.map((person) => <option key={person}>{person}</option>)}</select></label>
              <label>조정<select value={adjustmentDraft.kind} onChange={(e) => setAdjustmentDraft({ ...adjustmentDraft, kind: e.target.value as AdjustmentKind })}><option>추가지급</option><option>차감</option><option>복지기금 전환</option></select></label>
              <label>금액<input type="number" min="0" value={adjustmentDraft.amount} onChange={(e) => setAdjustmentDraft({ ...adjustmentDraft, amount: asNumber(e.target.value) })} /></label>
              <label>메모<input value={adjustmentDraft.note} onChange={(e) => setAdjustmentDraft({ ...adjustmentDraft, note: e.target.value })} placeholder="예: 특별 인센티브" /></label>
              <button type="button" className={styles.addButton} onClick={addAdjustment}>조정 반영</button>
            </div>
            <div className={styles.adjustList}>{adjustments.map((item) => <div key={item.id}><span>{item.kind}</span><strong>{item.person} · {won(item.amount)}</strong><small>{item.note || "메모 없음"}</small><button onClick={() => setAdjustments((items) => items.filter((entry) => entry.id !== item.id))}>×</button></div>)}{!adjustments.length && <p>추가지급, 차감, 복지기금 전환 내역이 없습니다.</p>}</div>
          </article>

          <article className={`${styles.panel} ${styles.resultPanel}`}>
            <div className={styles.panelHead}><div><p>PAYROLL RESULT</p><h2>개인별 급여 반영</h2></div></div>
            <div className={styles.summaryList}>{summaries.map((item) => <div key={item.person}><div><strong>{item.person}</strong><small>{item.count}건 · 기본 인센 {won(item.incentive)}</small></div><dl><div><dt>승인액</dt><dd>{won(item.approved)}</dd></div><div><dt>급여 인센</dt><dd>{won(item.payroll)}</dd></div><div><dt>복지기금</dt><dd>{won(item.welfare)}</dd></div></dl></div>)}{!summaries.length && <p>거래를 입력하면 개인별 결과가 여기에 표시됩니다.</p>}</div>
            <button type="button" className={styles.exportButton} onClick={exportResults} disabled={!summaries.length}>개인별 결과 엑셀로 저장</button>
          </article>
        </section>

        <footer className={styles.footer}><p>모든 자료는 현재 브라우저에만 저장됩니다.</p><button type="button" onClick={clearAll}>전체 초기화</button></footer>
      </div>
    </main>
  );
}
