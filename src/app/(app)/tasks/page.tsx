import type { Metadata } from "next";
import { CheckCircle2, ClipboardList, FolderKanban, Play } from "lucide-react";
import { canSeeEveryone, hasPermission, requirePermission } from "@/lib/permissions";
import { listProjects, listTasks, taskStats } from "@/lib/workplace";
import { pickableUsers } from "@/lib/employees";
import {
  createProjectAction,
  createTaskAction,
  setTaskStatusAction,
} from "@/lib/actions/workplace";
import ActionButton from "@/components/ActionButton";
import GeoActionForm from "@/components/GeoActionForm";
import AutoForm from "@/components/forms/AutoForm";
import FilterBar from "@/components/FilterBar";
import { Avatar, Card, EmptyState, KpiCard, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { formatDate, percent } from "@/lib/utils";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; project?: string; scope?: string }>;
}) {
  const user = await requirePermission("tasks", "view");
  const tz = user.tenant.timezone;
  const sp = await searchParams;

  const seesAll = canSeeEveryone(user, "tasks");
  const scope = sp.scope ?? (seesAll ? "all" : "mine");

  const [tasks, mine, stats, projects, people] = await Promise.all([
    listTasks(user.tenant_id, {
      q: sp.q,
      status: sp.status,
      projectId: sp.project,
      assignedTo: scope === "mine" || !seesAll ? user.id : undefined,
    }),
    listTasks(user.tenant_id, { assignedTo: user.id }),
    taskStats(user.tenant_id, user.id),
    listProjects(user.tenant_id),
    pickableUsers(user.tenant_id),
  ]);

  const canCreate = hasPermission(user, "tasks", "create");
  const myOpen = mine.filter((t) => !["done", "cancelled"].includes(t.status));

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work items, optionally grouped into projects. Completing a task records where it was completed when the device supplies a location."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Assigned to me"
          value={stats.mine}
          icon={<ClipboardList size={16} />}
          tone={stats.mine > 0 ? "info" : "success"}
        />
        <KpiCard label="Open company-wide" value={stats.open} />
        <KpiCard
          label="Overdue"
          value={stats.overdue}
          tone={stats.overdue > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Completed this week"
          value={stats.done_this_week}
          icon={<CheckCircle2 size={16} />}
          tone="success"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] mt-4 items-start">
        <div className="grid gap-4">
          {myOpen.length > 0 && (
            <Card title="My open tasks" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {myOpen.slice(0, 8).map((t) => (
                  <li key={t.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{t.title}</p>
                        {t.description && (
                          <p className="mt-0.5 text-sm text-fg-muted line-clamp-2">
                            {t.description}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-fg-subtle">
                          {t.project_name ? `${t.project_name} · ` : ""}
                          {t.due_date ? `due ${formatDate(t.due_date, tz)}` : "no due date"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusBadge status={t.priority} />
                        <StatusBadge status={t.status} />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      {t.status === "todo" && (
                        <ActionButton
                          action={setTaskStatusAction}
                          values={{ taskId: t.id, status: "in_progress" }}
                          label="Start"
                          className="btn-secondary btn-sm"
                          icon={<Play size={13} />}
                        />
                      )}
                      {t.status !== "done" && (
                        <GeoActionForm
                          action={setTaskStatusAction}
                          hidden={{ taskId: t.id, status: "done" }}
                          submitLabel="Mark done"
                          className="btn-primary btn-sm"
                          required={false}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={scope === "mine" ? "My tasks" : "All tasks"} bodyClassName="p-0">
            <FilterBar
              filters={[
                { name: "q", label: "Search", type: "search", value: sp.q },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: sp.status,
                  options: ["todo", "in_progress", "review", "done", "cancelled"].map((s) => ({
                    value: s,
                    label: s.replace(/_/g, " "),
                  })),
                },
                {
                  name: "project",
                  label: "Project",
                  type: "select",
                  value: sp.project,
                  options: projects.map((p) => ({ value: p.id, label: p.name })),
                },
                ...(seesAll
                  ? [
                      {
                        name: "scope",
                        label: "Scope",
                        type: "select" as const,
                        value: sp.scope,
                        placeholder: "Everyone",
                        options: [{ value: "mine", label: "Only mine" }],
                      },
                    ]
                  : []),
              ]}
            />
            {tasks.length === 0 ? (
              <EmptyState
                icon={<ClipboardList size={20} />}
                title="No tasks match"
                description="Create a task, or clear the filters."
              />
            ) : (
              <div className="table-wrap max-h-[34rem] overflow-y-auto scroll-thin">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Project</th>
                      <th>Assignee</th>
                      <th>Due</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Proof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => {
                      const overdue =
                        t.due_date &&
                        !["done", "cancelled"].includes(t.status) &&
                        new Date(t.due_date).getTime() < Date.now();
                      return (
                        <tr key={t.id}>
                          <td>
                            <span className="block font-medium truncate max-w-64">
                              {t.title}
                            </span>
                            {t.comment_count > 0 && (
                              <span className="block text-xs text-fg-subtle">
                                {t.comment_count} comment{t.comment_count === 1 ? "" : "s"}
                              </span>
                            )}
                          </td>
                          <td className="text-fg-muted">{t.project_name ?? "—"}</td>
                          <td>
                            {t.assignee_name ? (
                              <span className="flex items-center gap-2">
                                <Avatar name={t.assignee_name} size={24} />
                                <span className="truncate">{t.assignee_name}</span>
                              </span>
                            ) : (
                              <span className="text-fg-subtle">Unassigned</span>
                            )}
                          </td>
                          <td className={overdue ? "text-danger font-medium" : "text-fg-muted"}>
                            {formatDate(t.due_date, tz)}
                          </td>
                          <td>
                            <StatusBadge status={t.priority} />
                          </td>
                          <td>
                            <StatusBadge status={t.status} />
                          </td>
                          <td>
                            {t.completed_lat != null ? (
                              <span
                                className="badge badge-success"
                                title={`${t.completed_lat.toFixed(5)}, ${t.completed_lng?.toFixed(5)}`}
                              >
                                GPS stamped
                              </span>
                            ) : (
                              <span className="text-fg-subtle text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          {canCreate && (
            <Card title="New task">
              <AutoForm
                action={createTaskAction}
                columns={1}
                submitLabel="Create task"
                resetOnSuccess
                fields={[
                  { name: "title", label: "Title", required: true },
                  { name: "description", label: "Description", type: "textarea", rows: 3 },
                  {
                    name: "assignedTo",
                    label: "Assign to",
                    type: "select",
                    options: people.map((p) => ({ value: p.id, label: p.full_name })),
                  },
                  {
                    name: "projectId",
                    label: "Project",
                    type: "select",
                    options: projects.map((p) => ({ value: p.id, label: p.name })),
                  },
                  {
                    name: "priority",
                    label: "Priority",
                    type: "select",
                    required: true,
                    defaultValue: "medium",
                    options: ["low", "medium", "high", "urgent"].map((p) => ({
                      value: p,
                      label: p,
                    })),
                  },
                  { name: "dueDate", label: "Due date", type: "date" },
                ]}
              />
            </Card>
          )}

          <Card title="Projects" bodyClassName="p-0">
            {projects.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-subtle">No projects yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {projects.map((p) => (
                  <li key={p.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="text-sm font-medium truncate">{p.name}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <Progress value={p.done_count} max={p.task_count || 1} />
                    <p className="mt-1 text-xs text-fg-subtle">
                      {p.done_count}/{p.task_count} done
                      {p.task_count > 0 ? ` · ${percent(p.done_count, p.task_count)}%` : ""}
                      {p.owner_name ? ` · ${p.owner_name}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canCreate && (
              <div className="p-5 border-t border-border">
                <p className="text-[0.8125rem] font-semibold mb-3 flex items-center gap-1.5">
                  <FolderKanban size={14} />
                  New project
                </p>
                <AutoForm
                  action={createProjectAction}
                  columns={1}
                  compact
                  resetOnSuccess
                  submitLabel="Create project"
                  fields={[
                    { name: "name", label: "Name", required: true },
                    { name: "code", label: "Code" },
                    {
                      name: "ownerId",
                      label: "Owner",
                      type: "select",
                      options: people.map((p) => ({ value: p.id, label: p.full_name })),
                    },
                    { name: "startDate", label: "Starts", type: "date" },
                    { name: "endDate", label: "Ends", type: "date" },
                  ]}
                />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
