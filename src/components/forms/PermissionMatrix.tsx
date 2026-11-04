"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { updateRoleMatrixAction } from "@/lib/actions/employees";
import SubmitButton from "@/components/SubmitButton";
import {
  MODULE_GROUPS,
  MODULE_LABELS,
  PERM_ACTIONS,
  type Module,
  type ModulePermissions,
} from "@/lib/modules";
import type { ActionState } from "@/lib/types";

/**
 * The permission matrix editor: one checkbox per module and action, grouped
 * the same way the sidebar is.
 *
 * Checkboxes post as `perm:<module>:<action>`, and the action rebuilds the
 * matrix from what is present — so unchecking genuinely removes access rather
 * than leaving a stale `true` behind.
 */
export default function PermissionMatrix({
  roleId,
  roleName,
  roleKey,
  matrix,
}: {
  roleId: string;
  roleName: string;
  roleKey: string;
  matrix: Record<Module, ModulePermissions>;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    updateRoleMatrixAction,
    null
  );
  const [local, setLocal] = useState(matrix);
  const locked = roleKey === "company_admin" || roleKey === "super_admin";

  function toggle(module: Module, act: (typeof PERM_ACTIONS)[number]) {
    setLocal((prev) => ({
      ...prev,
      [module]: { ...prev[module], [act]: !prev[module][act] },
    }));
  }

  function setRow(module: Module, value: boolean) {
    setLocal((prev) => ({
      ...prev,
      [module]: Object.fromEntries(
        PERM_ACTIONS.map((a) => [a, value])
      ) as ModulePermissions,
    }));
  }

  if (locked) {
    return (
      <p className="text-sm text-fg-muted">
        <strong>{roleName}</strong> always has full access. That is enforced in code
        rather than stored in this matrix, so a mis-edit can never lock the company out
        of its own administration.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="roleId" value={roleId} />

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

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Module</th>
              {PERM_ACTIONS.map((a) => (
                <th key={a} className="text-center capitalize">
                  {a}
                </th>
              ))}
              <th className="text-center">All</th>
            </tr>
          </thead>
          <tbody>
            {MODULE_GROUPS.map((group) => (
              <>
                <tr key={group.label} className="bg-surface-2">
                  <td
                    colSpan={PERM_ACTIONS.length + 2}
                    className="text-[0.6875rem] font-bold uppercase tracking-wider text-fg-subtle"
                  >
                    {group.label}
                  </td>
                </tr>
                {group.modules.map((m) => (
                  <tr key={m}>
                    <td className="font-medium">{MODULE_LABELS[m]}</td>
                    {PERM_ACTIONS.map((a) => (
                      <td key={a} className="text-center">
                        <input
                          type="checkbox"
                          name={`perm:${m}:${a}`}
                          checked={local[m][a]}
                          onChange={() => toggle(m, a)}
                          className="h-4 w-4 accent-[var(--primary)]"
                          aria-label={`${MODULE_LABELS[m]}: ${a}`}
                        />
                      </td>
                    ))}
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setRow(m, !PERM_ACTIONS.every((a) => local[m][a]))
                        }
                        className="btn btn-ghost btn-sm"
                      >
                        {PERM_ACTIONS.every((a) => local[m][a]) ? "None" : "All"}
                      </button>
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton className="btn-primary" pendingLabel="Saving…">
          Save permissions for {roleName}
        </SubmitButton>
        <p className="text-xs text-fg-subtle">
          <strong>View</strong> shows the module; <strong>approve</strong> allows signing
          off someone else&apos;s request. Managing users and roles is always restricted
          to the company admin.
        </p>
      </div>
    </form>
  );
}
