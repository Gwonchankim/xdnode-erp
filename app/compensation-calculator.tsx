"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import writeXlsxFile, { type SheetData } from "write-excel-file/browser";
import IncentiveCalculator from "./incentive/incentive-calculator";
import WonInput from "./won-input";
import {
  calculateCompensation,
  compensationMonthKey,
  type CompensationEmployee as Employee,
  type CompensationMonthlyPay as MonthlyPay,
  type CompensationRounding as Rounding,
} from "./compensation-calculation";

type CalculatorMode = "incentive" | "wage";
type WageSortKey = "employee" | "department" | "joinDate";
type WageSortState = { key: WageSortKey; direction: "asc" | "desc" };
type ImportedCell = string | number | boolean | Date | null;
type CompensationSettings = {
  rounding: Rounding;
  columns: { research: boolean; extra: boolean; welfare: boolean; severance: boolean };
  standards: { meal: number; car: number; child: number };
};

const STORAGE_KEY = "xdnode-compensation-preferences-v2";
const DAY = 86_400_000;
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  employee: 86, department: 92, title: 78, joinDate: 108, leaveDate: 108, days: 62, probation: 70,
  annualSalary: 98, basic: 110, meal: 92, car: 96, child: 88, incentive: 96, bonus: 92,
  extra: 92, research: 92, severance: 98, total: 116, welfare: 96, note: 132, action: 44,
};
const COLUMN_VISIBILITY_OPTIONS = [
  ["department", "부서"], ["title", "직책"], ["joinDate", "입사일"], ["leaveDate", "퇴사일"],
  ["days", "근무일"], ["probation", "수습"], ["annualSalary", "연봉"], ["basic", "기본급"],
  ["meal", "식대"], ["car", "자가운전"], ["child", "육아"], ["incentive", "인센티브"],
  ["bonus", "상여금"], ["extra", "추가수당"], ["research", "연구수당"], ["severance", "퇴직금"],
  ["welfare", "복지기금"], ["note", "비고"],
] as const;
const money = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const monthKey = compensationMonthKey;
const draftSignature = (employees: Employee[], settings: CompensationSettings) => JSON.stringify({ employees, settings });
const numberValue = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
const dateString = (value: unknown) => {
  if (value instanceof Date) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())).toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20_000 && value < 80_000) return new Date(Date.UTC(1899, 11, 30) + value * DAY).toISOString().slice(0, 10);
  const matched = String(value ?? "").match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  return matched ? `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}` : "";
};

function blankEmployee(year: number, month: number): Employee {
  return { id: crypto.randomUUID(), name: "", department: "", title: "", birthDate: "", joinDate: `${year}-${String(month).padStart(2, "0")}-01`, leaveDate: "", probationMonths: 0, annualSalary: 0, basePay: 0, manualBasic: false, meal: 200_000, car: 0, child: 0, monthly: {} };
}

const calculatePay = calculateCompensation;

function findHeader(rows: ImportedCell[][]) {
  return rows.findIndex((row) => {
    const headers = row.map(normalize);
    return headers.includes("연봉") && (headers.includes("성명") || headers.includes("이름"));
  });
}

function findColumn(headers: ImportedCell[], aliases: string[]) {
  const normalized = headers.map(normalize);
  return normalized.findIndex((header) => aliases.some((alias) => normalize(alias) === header));
}

function parseRoster(rows: ImportedCell[][], year: number, month: number) {
  const headerIndex = findHeader(rows);
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  const col = {
    name: findColumn(headers, ["성명", "이름"]), department: findColumn(headers, ["부서"]), title: findColumn(headers, ["직책", "직위"]),
    birthDate: findColumn(headers, ["생년월일", "생일"]), joinDate: findColumn(headers, ["입사일", "입사"]), leaveDate: findColumn(headers, ["퇴사일", "퇴사"]),
    probation: findColumn(headers, ["수습 90%적용", "수습90%", "수습"]), salary: findColumn(headers, ["연봉"]), basic: findColumn(headers, ["기본급"]),
    meal: findColumn(headers, ["식대"]), car: findColumn(headers, ["자가운전보조금", "자차운전보조금", "자가운전", "자차"]), child: findColumn(headers, ["육아수당", "육아"]),
    incentive: findColumn(headers, ["인센티브", "인센"]), bonus: findColumn(headers, ["상여금", "상여"]), extra: findColumn(headers, ["추가수당"]), research: findColumn(headers, ["연구수당"]), severance: findColumn(headers, ["퇴직금"]), welfare: findColumn(headers, ["복지기금"]), note: findColumn(headers, ["비고"]),
  };
  const get = (row: ImportedCell[], key: keyof typeof col) => col[key] >= 0 ? row[col[key]] : null;
  const result: Employee[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const name = String(get(row, "name") ?? "").trim();
    if (!name || /합계|소계|일용직|프리랜서/.test(name)) break;
    const annualSalary = numberValue(get(row, "salary"));
    const basic = numberValue(get(row, "basic"));
    const probationValue = get(row, "probation");
    const monthly: Record<string, MonthlyPay> = {};
    const current = { incentive: numberValue(get(row, "incentive")), bonus: numberValue(get(row, "bonus")), extra: numberValue(get(row, "extra")), research: numberValue(get(row, "research")), severance: numberValue(get(row, "severance")), welfare: numberValue(get(row, "welfare")), note: String(get(row, "note") ?? "") };
    if (Object.values(current).some(Boolean)) monthly[monthKey(year, month)] = current;
    result.push({ id: crypto.randomUUID(), name, department: String(get(row, "department") ?? "").trim(), title: String(get(row, "title") ?? "").trim(), birthDate: dateString(get(row, "birthDate")), joinDate: dateString(get(row, "joinDate")), leaveDate: dateString(get(row, "leaveDate")), probationMonths: probationValue === true || /90|true/i.test(String(probationValue ?? "")) ? 3 : 0, annualSalary, basePay: basic, manualBasic: annualSalary <= 0 && basic > 0, meal: numberValue(get(row, "meal")) || (annualSalary ? 200_000 : 0), car: numberValue(get(row, "car")), child: numberValue(get(row, "child")), monthly });
  }
  return result;
}

function WageCalculator() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rounding, setRounding] = useState<Rounding>("round");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [columns, setColumns] = useState({ research: true, extra: true, welfare: false, severance: true });
  const [standards, setStandards] = useState({ meal: 200_000, car: 200_000, child: 200_000 });
  const [message, setMessage] = useState("직원 명부를 불러오거나 첫 직원을 추가해 주세요.");
  const [hydrated, setHydrated] = useState(false);
  const [run, setRun] = useState<{ status: "DRAFT" | "CONFIRMED"; version: number; employeeCount: number; grossPay: number; confirmedAt: number | null; employees: Employee[]; settings?: CompensationSettings } | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [exporting, setExporting] = useState<"month" | "year" | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_COLUMN_WIDTHS);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [sort, setSort] = useState<WageSortState | null>(null);
  const lastSavedEmployeesRef = useRef("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rosterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as { columns?: typeof columns; standards?: typeof standards; rounding?: Rounding; columnWidths?: Record<string, number>; hiddenColumns?: string[] };
        if (data.columns) setColumns(data.columns);
        if (data.standards) setStandards(data.standards);
        if (data.rounding) setRounding(data.rounding);
        if (data.columnWidths) setColumnWidths((current) => ({ ...current, ...data.columnWidths }));
        if (Array.isArray(data.hiddenColumns)) setHiddenColumns(data.hiddenColumns.filter((value) => typeof value === "string"));
      }
    } catch { setMessage("저장된 명부를 읽지 못해 새 계산으로 시작합니다."); }
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns, standards, rounding, columnWidths, hiddenColumns })); }, [columns, standards, rounding, columnWidths, hiddenColumns, hydrated]);

  const key = monthKey(year, month);
  useEffect(() => {
    let cancelled = false;
    setSaving(true);
    fetch(`/api/hr/compensation?period=${key}`).then(async (response) => {
      const payload = await response.json() as { run?: typeof run; error?: string };
      if (!response.ok) throw new Error(payload.error || "임금안을 불러오지 못했습니다.");
      if (cancelled) return;
      setRun(payload.run ?? null);
      const restoredEmployees = payload.run?.employees ?? [];
      const restoredSettings = payload.run?.settings;
      setEmployees(restoredEmployees);
      if (restoredSettings) {
        setRounding(restoredSettings.rounding);
        setColumns(restoredSettings.columns);
        setStandards(restoredSettings.standards);
      }
      lastSavedEmployeesRef.current = payload.run ? draftSignature(restoredEmployees, restoredSettings ?? { rounding, columns, standards }) : "";
      setDraftDirty(false);
      setMessage(payload.run ? `${key} 임금안을 불러왔습니다.` : `${month}월 임금 작성하기를 누르면 HR 인사기록을 불러옵니다.`);
    }).catch((error: Error) => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setSaving(false); });
    return () => { cancelled = true; };
  }, [key, month]);
  const rows = useMemo(() => employees.map((employee) => calculatePay(employee, year, month, rounding, columns)), [employees, year, month, rounding, columns]);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const value = (row: (typeof rows)[number]) => sort.key === "employee" ? row.employee.name : sort.key === "department" ? row.employee.department : row.employee.joinDate;
    return rows.map((row, index) => ({ row, index })).sort((left, right) => {
      const leftValue = value(left.row).trim();
      const rightValue = value(right.row).trim();
      if (!leftValue && !rightValue) return left.index - right.index;
      if (!leftValue) return 1;
      if (!rightValue) return -1;
      const compared = leftValue.localeCompare(rightValue, "ko-KR", { numeric: true, sensitivity: "base" });
      return compared === 0 ? left.index - right.index : sort.direction === "asc" ? compared : -compared;
    }).map(({ row }) => row);
  }, [rows, sort]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({ people: sum.people + (row.days ? 1 : 0), basic: sum.basic + row.basic, allowances: sum.allowances + row.meal + row.car + row.child, variable: sum.variable + row.incentive + row.bonus + row.extra + row.research + row.severance, total: sum.total + row.total }), { people: 0, basic: 0, allowances: 0, variable: 0, total: 0 }), [rows]);
  const alerts = useMemo(() => ({ noJoin: rows.filter((row) => row.probationWithoutJoin), probationOver: rows.filter((row) => row.probationOver), partial: rows.filter((row) => row.days > 0 && row.days < row.daysInMonth), mixed: rows.filter((row) => row.mixedProbation), zero: rows.filter((row) => row.days === 0) }), [rows]);
  const departments = useMemo(() => Array.from(new Set(employees.map((employee) => employee.department).filter(Boolean))).sort(), [employees]);
  const titles = useMemo(() => Array.from(new Set(employees.map((employee) => employee.title).filter(Boolean))).sort(), [employees]);
  const hiddenColumnSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const isColumnVisible = (column: string) => !hiddenColumnSet.has(column);
  const tableColumns = useMemo(() => [
    { key: "employee", label: "직원" }, { key: "department", label: "부서" }, { key: "title", label: "직책" },
    { key: "joinDate", label: "입사일" }, { key: "leaveDate", label: "퇴사일" }, { key: "days", label: "근무일" },
    { key: "probation", label: "수습" }, { key: "annualSalary", label: "연봉" }, { key: "basic", label: "기본급" },
    { key: "meal", label: "식대" }, { key: "car", label: "자가운전" }, { key: "child", label: "육아" },
    { key: "incentive", label: "인센티브" }, { key: "bonus", label: "상여금" },
    ...(columns.extra ? [{ key: "extra", label: "추가수당" }] : []),
    ...(columns.research ? [{ key: "research", label: "연구수당" }] : []),
    ...(columns.severance ? [{ key: "severance", label: "퇴직금" }] : []),
    { key: "total", label: "지급총액" }, ...(columns.welfare ? [{ key: "welfare", label: "복지기금" }] : []),
    { key: "note", label: "비고" }, { key: "action", label: "" },
  ].filter((column) => !hiddenColumnSet.has(column.key)), [columns, hiddenColumnSet]);
  const tableWidth = useMemo(() => tableColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? DEFAULT_COLUMN_WIDTHS[column.key]), 0), [tableColumns, columnWidths]);

  function beginColumnResize(event: ReactPointerEvent<HTMLButtonElement>, key: string) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[key] ?? DEFAULT_COLUMN_WIDTHS[key];
    const handleMove = (moveEvent: PointerEvent) => setColumnWidths((current) => ({ ...current, [key]: Math.max(54, Math.min(320, startWidth + moveEvent.clientX - startX)) }));
    const handleUp = () => { window.removeEventListener("pointermove", handleMove); window.removeEventListener("pointerup", handleUp); };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }
  function toggleSort(key: WageSortKey) {
    setSort((current) => current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  }

  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (!run || run.status !== "DRAFT" || saving || autoSaving) return;
    const settings = { rounding, columns, standards };
    const signature = draftSignature(employees, settings);
    if (signature === lastSavedEmployeesRef.current) { setDraftDirty(false); return; }
    setDraftDirty(true);
    const employeeSnapshot = employees;
    const version = run.version;
    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaving(true);
      try {
        const calculated = employeeSnapshot.map((employee) => calculatePay(employee, year, month, rounding, columns));
        const response = await fetch("/api/hr/compensation", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SAVE", period: key, version, employees: employeeSnapshot, settings,
            rows: calculated.map((row) => ({
              employeeId: row.employee.id, basic: row.basic, meal: row.meal, car: row.car, child: row.child,
              incentive: row.incentive, bonus: row.bonus, extra: row.extra, research: row.research,
              severance: row.severance, welfare: row.welfare, total: row.total,
            })),
          }),
        });
        const payload = await response.json() as { run?: typeof run; error?: string };
        if (!response.ok || !payload.run) throw new Error(payload.error || "임금안 자동 저장에 실패했습니다.");
        setRun(payload.run);
        if (signature === draftSignature(employees, settings)) {
          lastSavedEmployeesRef.current = signature;
          setDraftDirty(false);
        }
        setMessage("변경된 임금안이 서버에 자동 저장되었습니다.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "임금안 자동 저장에 실패했습니다.");
      } finally { setAutoSaving(false); }
    }, 900);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [employees, run, saving, autoSaving, year, month, rounding, columns, standards, key]);

  useEffect(() => {
    if (!hydrated || run || saving || autoSaving || !employees.length || employees.some((employee) => !employee.name.trim())) return;
    const timer = window.setTimeout(() => { void compensationAction("CREATE"); }, 500);
    return () => window.clearTimeout(timer);
  }, [employees, hydrated, run, saving, autoSaving, key]);

  function updateEmployee(id: string, patch: Partial<Employee>) { setEmployees((current) => current.map((employee) => employee.id === id ? { ...employee, ...patch } : employee)); }
  function updateMonthly(id: string, field: keyof MonthlyPay, value: string | number) {
    setEmployees((current) => current.map((employee) => employee.id === id ? { ...employee, monthly: { ...employee.monthly, [key]: { ...employee.monthly[key], [field]: value } } } : employee));
  }
  function setAllowance(id: string, field: "meal" | "car" | "child", enabled: boolean) {
    updateEmployee(id, { [field]: enabled ? standards[field] : 0 } as Partial<Employee>);
  }
  function addEmployee() { setEmployees((current) => [...current, blankEmployee(year, month)]); setMessage("직원을 추가했습니다. 이름과 연봉을 입력해 주세요."); }
  function loadExample() {
    setEmployees([
      { ...blankEmployee(year, month), id: crypto.randomUUID(), name: "김민성", department: "영업팀", title: "팀장", birthDate: "1988-04-12", joinDate: "2024-03-11", annualSalary: 60_000_000, meal: 200_000, car: 200_000, child: 200_000 },
      { ...blankEmployee(year, month), id: crypto.randomUUID(), name: "이서윤", department: "경영지원팀", title: "대리", birthDate: "1994-07-03", joinDate: `${year}-${String(month).padStart(2, "0")}-15`, annualSalary: 39_000_000, meal: 200_000, car: 0, child: 0 },
      { ...blankEmployee(year, month), id: crypto.randomUUID(), name: "정윤수", department: "기술팀", title: "사원", birthDate: "1998-01-21", joinDate: `${year}-${String(Math.max(1, month - 1)).padStart(2, "0")}-06`, probationMonths: 3, annualSalary: 30_000_000, meal: 200_000, car: 0, child: 0 },
    ]);
    setMessage("예시 명부 3명을 불러왔습니다.");
  }
  async function importRoster(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const sheets = await readXlsxFile(file);
      let parsed: Employee[] = [];
      let selectedSheet = "";
      for (const sheet of sheets) {
        parsed = parseRoster(sheet.data as ImportedCell[][], year, month);
        if (parsed.length) { selectedSheet = sheet.sheet; break; }
      }
      if (!parsed.length) throw new Error("연봉·성명 열이 있는 급여 표를 찾지 못했습니다.");
      setEmployees(parsed); setMessage(`${selectedSheet}에서 직원 ${parsed.length}명을 불러왔습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "명부를 읽지 못했습니다."); }
    event.target.value = "";
  }
  function downloadRoster() {
    const blob = new Blob([JSON.stringify({ version: 1, savedAt: new Date().toISOString(), employees, columns, standards }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `XD_NODE_임금명부_${key}.json`; anchor.click(); URL.revokeObjectURL(url);
    setMessage("명부와 월별 입력값을 저장했습니다.");
  }
  function loadRoster(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { const data = JSON.parse(String(reader.result)); if (!Array.isArray(data.employees)) throw new Error("명부 형식이 아닙니다."); setEmployees(data.employees); if (data.columns) setColumns(data.columns); if (data.standards) setStandards(data.standards); setMessage(`명부 ${data.employees.length}명을 불러왔습니다.`); } catch (error) { setMessage(error instanceof Error ? error.message : "명부 파일을 읽지 못했습니다."); } };
    reader.readAsText(file); event.target.value = "";
  }
  function importIncentive() {
    try {
      const savedResult = JSON.parse(localStorage.getItem("xdnode-incentive-payroll-v1") || "null") as { summaries?: Array<{ person: string; payroll: number }> } | null;
      if (Array.isArray(savedResult?.summaries)) {
        const byPerson = new Map(savedResult.summaries.map((item) => [item.person, numberValue(item.payroll)]));
        let matched = 0;
        setEmployees((current) => current.map((employee) => {
          const found = Array.from(byPerson.entries()).find(([name]) => employee.name === name || employee.name.endsWith(name) || name.endsWith(employee.name));
          if (!found) return employee;
          matched++;
          return { ...employee, monthly: { ...employee.monthly, [key]: { ...employee.monthly[key], incentive: Math.round(found[1]) } } };
        }));
        setMessage(matched ? `확정된 인센티브 결과를 ${matched}명의 ${key} 급여에 반영했습니다.` : "이름이 일치하는 인센티브 결과를 찾지 못했습니다.");
        return;
      }
      const deals = JSON.parse(localStorage.getItem("xdnode-incentive-deals-v1") || "[]") as Array<{ person: string; quantity: number; unitCost: number; unitSale: number; expense: number; excluded: boolean }>;
      const adjustments = JSON.parse(localStorage.getItem("xdnode-incentive-adjustments-v1") || "[]") as Array<{ person: string; kind: string; amount: number }>;
      const byPerson = new Map<string, number>();
      for (const deal of deals) { const sales = deal.quantity * deal.unitSale; const margin = sales - deal.quantity * deal.unitCost - deal.expense; const incentive = deal.excluded ? 0 : Math.max((margin - sales * 0.05) * 0.05, 0); byPerson.set(deal.person, (byPerson.get(deal.person) ?? 0) + incentive); }
      for (const adjustment of adjustments) { const sign = adjustment.kind === "추가지급" ? 1 : adjustment.kind === "차감" || adjustment.kind === "복지기금 전환" ? -1 : 0; byPerson.set(adjustment.person, Math.max(0, (byPerson.get(adjustment.person) ?? 0) + adjustment.amount * sign)); }
      let matched = 0;
      setEmployees((current) => current.map((employee) => { const found = Array.from(byPerson.entries()).find(([name]) => employee.name === name || employee.name.endsWith(name) || name.endsWith(employee.name)); if (!found) return employee; matched++; return { ...employee, monthly: { ...employee.monthly, [key]: { ...employee.monthly[key], incentive: Math.round(found[1]) } } }; }));
      setMessage(matched ? `인센티브 계산 결과를 ${matched}명의 ${key} 급여에 반영했습니다.` : "이름이 일치하는 인센티브 결과를 찾지 못했습니다.");
    } catch { setMessage("저장된 인센티브 계산 결과를 읽지 못했습니다."); }
  }
  function copyPreviousMonth() {
    const previousDate = new Date(year, month - 2, 1);
    const previousKey = monthKey(previousDate.getFullYear(), previousDate.getMonth() + 1);
    let copied = 0;
    setEmployees((current) => current.map((employee) => {
      const previous = employee.monthly[previousKey];
      if (!previous) return employee;
      copied++;
      return { ...employee, monthly: { ...employee.monthly, [key]: { ...previous, ...employee.monthly[key] } } };
    }));
    setMessage(copied ? `${previousKey}의 월별 수당·메모를 ${copied}명에게 이어받았습니다.` : `${previousKey}에 저장된 월별 값이 없습니다.`);
  }
  const apiRows = () => rows.map((row) => ({
    employeeId: row.employee.id, basic: row.basic, meal: row.meal, car: row.car, child: row.child,
    incentive: row.incentive, bonus: row.bonus, extra: row.extra, research: row.research,
    severance: row.severance, welfare: row.welfare, total: row.total,
  }));
  async function compensationAction(action: "CREATE" | "SAVE" | "CONFIRM" | "REOPEN") {
    setSaving(true);
    try {
      const requestAction = async (targetAction: "CREATE" | "SAVE" | "CONFIRM" | "REOPEN", version?: number) => {
        const response = await fetch("/api/hr/compensation", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: targetAction, period: key, version, employees, rows: apiRows(), settings: { rounding, columns, standards } }),
        });
        const payload = await response.json() as { run?: typeof run; error?: string; reused?: boolean };
        if (!response.ok || !payload.run) throw new Error(payload.error || "임금안을 처리하지 못했습니다.");
        return payload;
      };
      let payload = await requestAction(action === "CONFIRM" && !run ? "CREATE" : action, run?.version);
      if (action === "CONFIRM" && !run) payload = await requestAction("CONFIRM", payload.run?.version);
      setRun(payload.run);
      setEmployees(payload.run.employees ?? employees);
      lastSavedEmployeesRef.current = draftSignature(payload.run.employees ?? employees, payload.run.settings ?? { rounding, columns, standards });
      setDraftDirty(false);
      setMessage(action === "CREATE" ? `임금 대상 ${payload.run.employeeCount}명의 초안을 서버에 저장했습니다.` : action === "SAVE" ? "임금안 초안을 서버에 저장했습니다." : action === "CONFIRM" ? "임금안을 확정해 HR 급여관리에 덮어썼습니다." : "임금안을 다시 수정할 수 있습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "임금안을 처리하지 못했습니다."); }
    finally { setSaving(false); }
  }
  function sheetData(targetYear: number, targetMonth: number): SheetData {
    const targetKey = monthKey(targetYear, targetMonth);
    const calculated = employees.map((employee) => calculatePay(employee, targetYear, targetMonth, rounding, columns));
    const header = ["성명", "부서", "직책", "생년월일", "입사일", "퇴사일", "근무일", "수습(월)", "연봉", "기본급", "식대", "자가운전보조금", "육아수당", "인센티브", "상여금", ...(columns.extra ? ["추가수당"] : []), ...(columns.research ? ["연구수당"] : []), ...(columns.severance ? ["퇴직금"] : []), "지급총액", ...(columns.welfare ? ["복지기금", "복지기금 내역"] : []), "비고"];
    return [
      [{ value: targetKey, fontWeight: "bold", backgroundColor: "18181B", color: "FFFFFF" }],
      header.map((value) => ({ value, fontWeight: "bold", backgroundColor: "F4F4F5" })),
      ...calculated.map((row) => { const monthly = row.employee.monthly[targetKey] ?? {}; return [row.employee.name, row.employee.department, row.employee.title, row.employee.birthDate, row.employee.joinDate, row.employee.leaveDate, row.days, row.employee.probationMonths, row.employee.annualSalary, row.basic, row.meal, row.car, row.child, row.incentive, row.bonus, ...(columns.extra ? [row.extra] : []), ...(columns.research ? [row.research] : []), ...(columns.severance ? [row.severance] : []), row.total, ...(columns.welfare ? [row.welfare, monthly.welfareNote ?? ""] : []), monthly.note ?? ""].map((value, index) => ({ value, format: typeof value === "number" && index >= 8 ? "₩#,##0" : undefined })); }),
    ];
  }
  async function exportCurrent() {
    if (!employees.length) { setMessage("내보낼 명부가 없습니다."); return; }
    setExporting("month");
    try {
      await writeXlsxFile(sheetData(year, month), { sheet: key, freezeRows: 2, showGridLines: true }).toFile(`XD_NODE_급여_${key}.xlsx`);
      setMessage(`${key} 급여 계산표를 저장했습니다.`);
    } catch { setMessage("현재 월 엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setExporting(null); }
  }
  async function exportYear() {
    if (!employees.length) { setMessage("내보낼 명부가 없습니다."); return; }
    setExporting("year");
    try {
      const sheets = Array.from({ length: 12 }, (_, index) => ({
        sheet: monthKey(year, index + 1), data: sheetData(year, index + 1), freezeRows: 2, showGridLines: true,
      }));
      await writeXlsxFile(sheets).toFile(`XD_NODE_급여_${year}년_전체.xlsx`);
      setMessage(`${year}년 1~12월 급여 계산표를 저장했습니다.`);
    } catch { setMessage("연간 엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setExporting(null); }
  }

  const locked = run?.status === "CONFIRMED";
  return <div className={`wage-calculator${locked ? " locked" : ""}`}>
    <section className="compensation-toolbar panel">
      <div><p className="eyebrow">PAYROLL BASIS</p><h2>대상 월과 계산 기준</h2><span>연봉에 비과세 수당이 포함된 회사 급여 기준으로 계산합니다.</span></div>
      <div className="wage-period-controls"><label>연도<input type="number" value={year} onChange={(event) => setYear(Number(event.target.value) || now.getFullYear())} /></label><label>월<select value={month} onChange={(event) => setMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}월</option>)}</select></label><label>단수 처리<select disabled={locked} value={rounding} onChange={(event) => setRounding(event.target.value as Rounding)}><option value="round">반올림</option><option value="up">올림</option><option value="down">내림</option></select></label>{!run && <div className="compensation-run-actions"><button disabled={saving} type="button" onClick={() => void compensationAction("CREATE")}>{saving ? "불러오는 중…" : `${month}월 임금 작성하기`}</button></div>}</div>
    </section>
    <section className="compensation-kpis">{[["지급 인원", `${totals.people}명`, `${rows.length}명 중`], ["기본급 합계", money(totals.basic), "365일법·수습 반영"], ["비과세 수당", money(totals.allowances), "식대·자가운전·육아"], ["인센·상여 등", money(totals.variable), "월별 입력 항목"], ["지급총액", money(totals.total), `${key} 계산`]].map(([label, value, hint], index) => <article key={label} className={index === 4 ? "emphasis" : ""}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</section>
    {run && <section className={`compensation-run-status ${locked ? "confirmed" : "draft"}`}><div><strong>{locked ? "확정된 임금안" : "작성 중인 임금안"}</strong><span>{locked ? "HR 급여관리에 반영됨 · 수정하기 후 재확정하면 기존 월 기록을 덮어씁니다." : autoSaving ? "변경내용을 서버에 자동 저장하고 있습니다." : draftDirty ? "변경내용을 잠시 후 서버에 자동 저장합니다." : "서버 저장 완료 · 새로고침하거나 다시 접속해도 이 초안이 유지됩니다."}</span></div></section>}
    <fieldset className="compensation-editable" disabled={locked || saving}>
    <section className="wage-setup-grid">
      <article className="panel wage-setup-card"><header><div><p>EMPLOYEE ROSTER</p><h2>직원 명부</h2></div><span>{employees.length}명</span></header><div className="wage-actions"><button type="button" onClick={() => fileRef.current?.click()}>인건비 엑셀 불러오기</button><input ref={fileRef} hidden type="file" accept=".xlsx" onChange={importRoster} /><button type="button" onClick={addEmployee}>＋ 직원 추가</button><button type="button" onClick={copyPreviousMonth}>전월 값 이어받기</button><button type="button" onClick={loadExample}>예시 명부</button><button type="button" onClick={downloadRoster}>명부 저장</button><button type="button" onClick={() => rosterRef.current?.click()}>명부 불러오기</button><input ref={rosterRef} hidden type="file" accept=".json" onChange={loadRoster} /></div><p className="wage-message">{message}</p></article>
      <article className="panel wage-setup-card"><header><div><p>ALLOWANCE STANDARD</p><h2>수당·표시 항목</h2></div></header><div className="allowance-standards">{(["meal", "car", "child"] as const).map((field) => <label key={field}>{field === "meal" ? "식대" : field === "car" ? "자가운전" : "육아"}<WonInput value={standards[field]} ariaLabel={`${field === "meal" ? "식대" : field === "car" ? "자가운전" : "육아"} 기준액`} onValueChange={(value) => { setStandards((current) => ({ ...current, [field]: value })); setEmployees((current) => current.map((employee) => employee[field] === standards[field] ? { ...employee, [field]: value } : employee)); }} /></label>)}</div><div className="column-toggles">{(["research", "extra", "welfare", "severance"] as const).map((field) => <label key={field}><input type="checkbox" checked={columns[field]} onChange={(event) => setColumns((current) => ({ ...current, [field]: event.target.checked }))} />{field === "research" ? "연구수당" : field === "extra" ? "추가수당" : field === "welfare" ? "복지기금" : "퇴직금"}</label>)}</div><details className="column-visibility"><summary>표시할 열 선택</summary><div>{COLUMN_VISIBILITY_OPTIONS.filter(([field]) => !(["extra", "research", "severance", "welfare"] as string[]).includes(field) || columns[field as keyof typeof columns]).map(([field, label]) => <label key={field}><input type="checkbox" checked={!hiddenColumnSet.has(field)} onChange={(event) => setHiddenColumns((current) => event.target.checked ? current.filter((value) => value !== field) : Array.from(new Set([...current, field])))} />{label}</label>)}</div></details><button type="button" className="incentive-pull" onClick={importIncentive}>저장된 인센티브 결과 가져오기</button></article>
    </section>
    {(alerts.noJoin.length > 0 || alerts.probationOver.length > 0 || alerts.partial.length > 0 || alerts.mixed.length > 0 || alerts.zero.length > 0) && <section className="wage-alerts">{alerts.noJoin.length > 0 && <div className="critical"><b>입사일 없는 수습 대상 {alerts.noJoin.length}명</b><span>{alerts.noJoin.map((row) => row.employee.name || "이름 미입력").join(" · ")} — 수습 90%가 적용되지 않습니다.</span></div>}{alerts.probationOver.length > 0 && <div><b>수습 종료 {alerts.probationOver.length}명</b><span>현재 월은 100% 계산됩니다. 과거 계산 보존을 위해 수습 개월 값은 유지하세요.</span></div>}{alerts.mixed.length > 0 && <div><b>수습 종료가 걸친 달 {alerts.mixed.length}명</b><span>수습 90% 구간과 정상 100% 구간을 나눠 일할계산했습니다.</span></div>}{alerts.partial.length > 0 && <div className="ok"><b>일할계산 {alerts.partial.length}명</b><span>{alerts.partial.map((row) => `${row.employee.name || "이름 미입력"} ${row.days}일`).join(" · ")}</span></div>}{alerts.zero.length > 0 && <div><b>근무일 0일 {alerts.zero.length}명</b><span>해당 월 재직기간이 없어 전 항목을 0원 처리했습니다.</span></div>}</section>}
    <section className="panel wage-table-panel"><header><div><p>PAYROLL CALCULATION</p><h2>{year}년 {month}월 임금 계산 결과</h2></div><span>열 제목 오른쪽 경계를 드래그해 너비를 조정할 수 있습니다.</span></header><div className="wage-table-scroll"><table style={{ width: tableWidth }}><colgroup>{tableColumns.map((column) => <col key={column.key} style={{ width: columnWidths[column.key] ?? DEFAULT_COLUMN_WIDTHS[column.key] }} />)}</colgroup><thead><tr>{tableColumns.map((column) => { const sortable = (["employee", "department", "joinDate"] as string[]).includes(column.key); const activeSort = sort?.key === column.key ? sort : null; return <th key={column.key} aria-sort={activeSort ? activeSort.direction === "asc" ? "ascending" : "descending" : sortable ? "none" : undefined}><div className="wage-column-heading"><span>{column.label}</span>{sortable && <button type="button" className={`column-sort${activeSort ? " active" : ""}`} onClick={() => toggleSort(column.key as WageSortKey)} aria-label={`${column.label} ${activeSort?.direction === "asc" ? "내림차순" : "오름차순"} 정렬`}>{activeSort?.direction === "asc" ? "↑" : activeSort?.direction === "desc" ? "↓" : "↕"}</button>}</div><button type="button" className="column-resizer" aria-label={`${column.label || "작업"} 열 너비 조절`} onPointerDown={(event) => beginColumnResize(event, column.key)} /></th>; })}</tr></thead><tbody>{sortedRows.map((row) => { const employee = row.employee; const monthly = employee.monthly[key] ?? {}; return <tr key={employee.id} className={row.days ? "" : "inactive"}><td><input aria-label="성명" value={employee.name} onChange={(event) => updateEmployee(employee.id, { name: event.target.value })} placeholder="성명" /></td>{isColumnVisible("department") && <td><input list="wage-departments" aria-label="부서" value={employee.department} onChange={(event) => updateEmployee(employee.id, { department: event.target.value })} placeholder="부서" /></td>}{isColumnVisible("title") && <td><input list="wage-titles" aria-label="직책" value={employee.title} onChange={(event) => updateEmployee(employee.id, { title: event.target.value })} placeholder="직책" /></td>}{isColumnVisible("joinDate") && <td><input type="date" aria-label="입사일" value={employee.joinDate} onChange={(event) => updateEmployee(employee.id, { joinDate: event.target.value })} /></td>}{isColumnVisible("leaveDate") && <td><input type="date" aria-label="퇴사일" value={employee.leaveDate} onChange={(event) => updateEmployee(employee.id, { leaveDate: event.target.value })} /></td>}{isColumnVisible("days") && <td className="calculated">{row.days}일</td>}{isColumnVisible("probation") && <td><select aria-label="수습 기간" value={employee.probationMonths} onChange={(event) => updateEmployee(employee.id, { probationMonths: Number(event.target.value) })}>{[0, 1, 2, 3, 6, 12].map((value) => <option key={value} value={value}>{value ? `${value}개월` : "—"}</option>)}</select></td>}{isColumnVisible("annualSalary") && <td><WonInput className="money-input" ariaLabel="연봉" value={employee.annualSalary} onValueChange={(value) => updateEmployee(employee.id, { annualSalary: value })} /></td>}{isColumnVisible("basic") && <td><div className="basic-cell">{employee.manualBasic ? <WonInput className="money-input" ariaLabel="기본급 직접 입력" value={Number(monthly.basic ?? employee.basePay ?? 0)} onValueChange={(value) => updateMonthly(employee.id, "basic", value)} /> : <b>{money(row.basic)}</b>}<label title="기본급 직접 입력"><input type="checkbox" checked={employee.manualBasic} onChange={(event) => { updateEmployee(employee.id, { manualBasic: event.target.checked }); if (event.target.checked && monthly.basic === undefined) updateMonthly(employee.id, "basic", employee.basePay || row.basic); }} />직접</label></div></td>}{(["meal", "car", "child"] as const).map((field) => isColumnVisible(field) && <td key={field}><div className="allowance-cell"><b>{money(row[field])}</b><input type="checkbox" aria-label={`${field} 지급`} checked={employee[field] > 0} onChange={(event) => setAllowance(employee.id, field, event.target.checked)} /></div></td>)}{(["incentive", "bonus"] as const).map((field) => isColumnVisible(field) && <td key={field}><WonInput className="money-input" ariaLabel={field === "incentive" ? "인센티브" : "상여금"} value={Number(monthly[field] ?? 0)} onValueChange={(value) => updateMonthly(employee.id, field, value)} /></td>)}{columns.extra && isColumnVisible("extra") && <td><WonInput className="money-input" ariaLabel="추가수당" value={Number(monthly.extra ?? 0)} onValueChange={(value) => updateMonthly(employee.id, "extra", value)} /></td>}{columns.research && isColumnVisible("research") && <td><WonInput className="money-input" ariaLabel="연구수당" value={Number(monthly.research ?? 0)} onValueChange={(value) => updateMonthly(employee.id, "research", value)} /></td>}{columns.severance && isColumnVisible("severance") && <td><WonInput className="money-input" ariaLabel="퇴직금" value={Number(monthly.severance ?? 0)} onValueChange={(value) => updateMonthly(employee.id, "severance", value)} /></td>}<td className="total-cell">{money(row.total)}</td>{columns.welfare && isColumnVisible("welfare") && <td><WonInput className="money-input" ariaLabel="복지기금" value={Number(monthly.welfare ?? 0)} onValueChange={(value) => updateMonthly(employee.id, "welfare", value)} /></td>}{isColumnVisible("note") && <td><input aria-label="비고" value={monthly.note ?? ""} onChange={(event) => updateMonthly(employee.id, "note", event.target.value)} placeholder="비고" /></td>}<td><button type="button" className="remove-row" aria-label={`${employee.name || "직원"} 삭제`} onClick={() => { if (confirm(`${employee.name || "이 직원"}을 명부에서 삭제할까요?`)) setEmployees((current) => current.filter((item) => item.id !== employee.id)); }}>×</button></td></tr>; })}{!rows.length && <tr><td colSpan={tableColumns.length} className="wage-empty">{run ? "해당 월 임금 대상자가 없습니다." : `${month}월 임금 작성하기를 눌러 HR 인사기록을 불러오세요.`}</td></tr>}</tbody></table><datalist id="wage-departments">{departments.map((value) => <option key={value} value={value} />)}</datalist><datalist id="wage-titles">{titles.map((value) => <option key={value} value={value} />)}</datalist></div><footer><button disabled={Boolean(exporting)} type="button" onClick={() => void exportCurrent()}>{exporting === "month" ? "파일 만드는 중…" : "현재 월 엑셀 내려받기"}</button><button disabled={Boolean(exporting)} type="button" onClick={() => void exportYear()}>{exporting === "year" ? "파일 만드는 중…" : "1~12월 일괄 내려받기"}</button>{locked ? <button disabled={saving} className="payroll-footer-action edit" type="button" onClick={() => void compensationAction("REOPEN")}>수정하기</button> : <button disabled={saving || autoSaving || !employees.length} className="payroll-footer-action confirm" type="button" onClick={() => void compensationAction("CONFIRM")}>{saving ? "처리 중…" : "급여 확정"}</button>}<span>초안은 서버에 저장되고 확정 시 HR 급여관리로 반영됩니다.</span></footer></section>
    </fieldset>
  </div>;
}

export default function CompensationCalculator() {
  const [mode, setMode] = useState<CalculatorMode>("wage");
  return <div className="compensation-module-shell">
    <section className="compensation-hero"><div><p>COMPENSATION WORKSPACE</p><h1>임금과 인센티브를<br />한 흐름으로 계산합니다.</h1><span>매출 원장의 인센티브 결과를 직원별 월 급여에 이어 붙이고, 입·퇴사와 수습기간까지 반영합니다.</span></div><div className="compensation-formula"><small>현재 임금 계산 기준</small><strong>연봉 포함 수당 · 365일 일할계산</strong><p>수습 종료 월은 90%·100% 구간을 분리하고, 비과세 수당도 근무일수에 맞춰 자동 계산합니다.</p></div></section>
    <nav className="compensation-tabs" aria-label="보상 계산 방식"><button type="button" className={mode === "wage" ? "active" : ""} onClick={() => setMode("wage")}><span>₩</span><div><strong>임금 계산</strong><small>기본급·수당·일할계산</small></div></button><button type="button" className={mode === "incentive" ? "active" : ""} onClick={() => setMode("incentive")}><span>↗</span><div><strong>인센티브 계산</strong><small>매출·마진·급여 반영액</small></div></button></nav>
    {mode === "wage" ? <WageCalculator /> : <div className="compensation-incentive-embed"><IncentiveCalculator embedded /></div>}
  </div>;
}
