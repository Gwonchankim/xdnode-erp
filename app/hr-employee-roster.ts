import { companyEmployees } from "./hr-company-data";

// `hr_employee_records` only ever received a row when someone was edited or processed inside the app,
// so most of the company was missing from it. That split the roster in two: modules that merge the
// static company list with this table saw everyone, while 17 server modules that read the table alone
// saw only the handful of edited people. The transitions in hr-retirements / hr-personnel-actions /
// hr-onboarding are the dangerous case — they are UPDATE-only, so for an employee with no row they
// silently affect zero rows and the status change is lost.
//
// Seeding every known employee makes this table the complete roster the rest of the code already
// assumes it is. INSERT OR IGNORE means every edit already made in the app wins and is never
// overwritten — retirements, department moves, and name corrections all stay exactly as they are.
export async function ensureEmployeeRosterSeeded(db: D1Database) {
  const now = Date.now();
  await db.batch(companyEmployees.map((employee) => db.prepare(`INSERT OR IGNORE INTO hr_employee_records
    (employee_id, name, birth, email, phone, address, department, manager, employment_type, join_date,
      position, job_title, status, history_json, retirement_json, annual_salary, base_pay, meal_allowance,
      childcare_allowance, vehicle_allowance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`)
    .bind(employee.id, employee.name, employee.birth, employee.email, employee.phone, employee.address,
      employee.department, employee.manager, employee.type, employee.joinDate, employee.position,
      employee.jobTitle, employee.status, JSON.stringify(employee.history), employee.annualSalary,
      employee.basePay, employee.mealAllowance, employee.childcareAllowance, employee.vehicleAllowance, now)));

  // Payroll drafting selects on a non-empty join_date, so a row whose hire date was blanked out by an
  // earlier edit is invisible to payroll. Fill only the blanks — a date already on the row is left alone.
  const datedEmployees = companyEmployees.filter((employee) => employee.joinDate);
  if (datedEmployees.length) {
    await db.batch(datedEmployees.map((employee) => db.prepare(`UPDATE hr_employee_records
      SET join_date = ?, updated_at = ?
      WHERE employee_id = ? AND NULLIF(TRIM(join_date), '') IS NULL`)
      .bind(employee.joinDate, now, employee.id)));
  }

  // The compensation columns were added to this table by a later migration defaulting to 0, so rows
  // that already existed kept zeros. Payroll drafts base pay from annual_salary, which would put those
  // employees on the payroll at zero. Restore the roster figures only where the compensation block was
  // never populated — a row that already carries a salary is left untouched, and so is anyone the
  // roster itself records as unsalaried.
  const salariedEmployees = companyEmployees.filter((employee) => employee.annualSalary > 0);
  if (salariedEmployees.length) {
    await db.batch(salariedEmployees.map((employee) => db.prepare(`UPDATE hr_employee_records
      SET annual_salary = ?, base_pay = ?, meal_allowance = ?, childcare_allowance = ?,
        vehicle_allowance = ?, updated_at = ?
      WHERE employee_id = ? AND annual_salary = 0`)
      .bind(employee.annualSalary, employee.basePay, employee.mealAllowance, employee.childcareAllowance,
        employee.vehicleAllowance, now, employee.id)));
  }
}
