"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  createEmployeeAction,
  updateEmployeeAction,
} from "@/lib/actions/employees";
import SubmitButton from "@/components/SubmitButton";
import FieldError from "@/components/FieldError";
import { Card } from "@/components/ui";
import { usePreservedForm } from "./usePreservedForm";
import type { ActionState } from "@/lib/types";
import type { EmployeeDetail } from "@/lib/employees";

type Option = { id: string; name: string };

export default function EmployeeForm({
  employee,
  departments,
  managers,
  roles,
  canAssignRole,
  currency,
}: {
  employee?: EmployeeDetail;
  departments: Option[];
  managers: Option[];
  roles: Option[];
  canAssignRole: boolean;
  currency: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    employee ? updateEmployeeAction : createEmployeeAction,
    null
  );
  const preserved = usePreservedForm(state);
  const fe = state?.fieldErrors;
  const e = employee;

  return (
    <form action={action} className="space-y-4 max-w-4xl" {...preserved}>
      {employee && <input type="hidden" name="id" value={employee.id} />}

      {state?.error && (
        <div className="alert alert-error flex items-start gap-2" role="alert">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      {state?.success && (
        <div className="alert alert-success flex items-start gap-2" role="status">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{state.success}</span>
        </div>
      )}

      <Card title="Identity">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="fullName">
              Full name
            </label>
            <input
              id="fullName"
              name="fullName"
              required
              defaultValue={e?.full_name}
              className="input"
              aria-invalid={!!fe?.fullName}
            />
            <FieldError errors={fe} name="fullName" />
          </div>
          <div>
            <label className="label" htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              defaultValue={e?.email}
              className="input"
              aria-invalid={!!fe?.email}
            />
            <FieldError errors={fe} name="email" />
            {!employee && (
              <p className="help">
                A temporary password is generated and shown to you once after saving.
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="phone">
              Phone
            </label>
            <input id="phone" name="phone" defaultValue={e?.phone ?? ""} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="employeeCode">
              Employee code
            </label>
            <input
              id="employeeCode"
              name="employeeCode"
              defaultValue={e?.employee_code ?? ""}
              placeholder="Generated if left blank"
              className="input"
            />
          </div>
        </div>
      </Card>

      <Card title="Position">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="designation">
              Designation
            </label>
            <input
              id="designation"
              name="designation"
              defaultValue={e?.designation ?? ""}
              placeholder="e.g. Senior Accountant"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="departmentId">
              Department
            </label>
            <select
              id="departmentId"
              name="departmentId"
              defaultValue={e?.department_id ?? ""}
              className="input"
            >
              <option value="">Unassigned</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lineManagerId">
              Line manager
            </label>
            <select
              id="lineManagerId"
              name="lineManagerId"
              defaultValue={e?.line_manager_id ?? ""}
              className="input"
            >
              <option value="">None</option>
              {managers
                .filter((m) => m.id !== employee?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <p className="help">First approval stage for this person&apos;s leave requests.</p>
          </div>
          <div>
            <label className="label" htmlFor="roleId">
              Access role
            </label>
            <select
              id="roleId"
              name="roleId"
              defaultValue={e?.role_id ?? ""}
              className="input"
              disabled={!canAssignRole}
            >
              <option value="">Select a role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {!canAssignRole && (
              <p className="help">
                Only a company admin can set roles. New accounts start as Standard
                Employee.
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="employmentType">
              Employment type
            </label>
            <select
              id="employmentType"
              name="employmentType"
              defaultValue={e?.employment_type ?? "permanent"}
              className="input"
            >
              {["permanent", "contract", "probation", "intern", "consultant"].map((t) => (
                <option key={t} value={t} className="capitalize">
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dateOfJoining">
              Date of joining
            </label>
            <input
              id="dateOfJoining"
              name="dateOfJoining"
              type="date"
              defaultValue={e?.date_of_joining?.slice(0, 10) ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="probationEndDate">
              Probation ends
            </label>
            <input
              id="probationEndDate"
              name="probationEndDate"
              type="date"
              defaultValue={e?.probation_end_date?.slice(0, 10) ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="contractEndDate">
              Contract ends
            </label>
            <input
              id="contractEndDate"
              name="contractEndDate"
              type="date"
              defaultValue={e?.contract_end_date?.slice(0, 10) ?? ""}
              className="input"
            />
          </div>
        </div>
      </Card>

      <Card title={`Salary structure (${currency})`}>
        <div className="grid sm:grid-cols-3 gap-4">
          {(
            [
              ["basicSalary", "Basic salary", e?.basic_salary],
              ["houseRent", "House rent", e?.house_rent],
              ["medicalAllowance", "Medical allowance", e?.medical_allowance],
              ["transportAllowance", "Transport allowance", e?.transport_allowance],
              ["otherAllowance", "Other allowance", e?.other_allowance],
            ] as const
          ).map(([name, label, value]) => (
            <div key={name}>
              <label className="label" htmlFor={name}>
                {label}
              </label>
              <input
                id={name}
                name={name}
                type="number"
                min="0"
                step="0.01"
                defaultValue={value ?? 0}
                className="input tnum"
              />
            </div>
          ))}
        </div>
        <p className="help mt-3">
          Payroll adds basic plus allowances, then applies overtime at the company
          multiplier from recorded attendance.
        </p>
      </Card>

      <Card title="Personal details">
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="dateOfBirth">
              Date of birth
            </label>
            <input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              defaultValue={e?.date_of_birth?.slice(0, 10) ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="gender">
              Gender
            </label>
            <select id="gender" name="gender" defaultValue={e?.gender ?? ""} className="input">
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bloodGroup">
              Blood group
            </label>
            <input
              id="bloodGroup"
              name="bloodGroup"
              defaultValue={e?.blood_group ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="maritalStatus">
              Marital status
            </label>
            <select
              id="maritalStatus"
              name="maritalStatus"
              defaultValue={e?.marital_status ?? ""}
              className="input"
            >
              <option value="">Not recorded</option>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nationalId">
              National ID
            </label>
            <input
              id="nationalId"
              name="nationalId"
              defaultValue={e?.national_id ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="taxId">
              Tax ID / TIN
            </label>
            <input id="taxId" name="taxId" defaultValue={e?.tax_id ?? ""} className="input" />
          </div>
          <div className="sm:col-span-3">
            <label className="label" htmlFor="presentAddress">
              Present address
            </label>
            <textarea
              id="presentAddress"
              name="presentAddress"
              defaultValue={e?.present_address ?? ""}
              className="input"
              rows={2}
            />
          </div>
          <div className="sm:col-span-3">
            <label className="label" htmlFor="permanentAddress">
              Permanent address
            </label>
            <textarea
              id="permanentAddress"
              name="permanentAddress"
              defaultValue={e?.permanent_address ?? ""}
              className="input"
              rows={2}
            />
          </div>
          <div>
            <label className="label" htmlFor="emergencyContactName">
              Emergency contact
            </label>
            <input
              id="emergencyContactName"
              name="emergencyContactName"
              defaultValue={e?.emergency_contact_name ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="emergencyContactPhone">
              Emergency phone
            </label>
            <input
              id="emergencyContactPhone"
              name="emergencyContactPhone"
              defaultValue={e?.emergency_contact_phone ?? ""}
              className="input"
            />
          </div>
        </div>
      </Card>

      <Card title="Bank details">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="bankName">
              Bank name
            </label>
            <input
              id="bankName"
              name="bankName"
              defaultValue={e?.bank_name ?? ""}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="bankAccount">
              Account number
            </label>
            <input
              id="bankAccount"
              name="bankAccount"
              defaultValue={e?.bank_account ?? ""}
              className="input"
            />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <SubmitButton className="btn-primary" pendingLabel="Saving…">
          {employee ? "Save changes" : "Add employee"}
        </SubmitButton>
        <Link
          href={employee ? `/employees/${employee.id}` : "/employees"}
          className="btn btn-secondary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
