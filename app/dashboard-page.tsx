import { notFound } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { SetupPanel } from "@/components/setup-panel";
import { SignIn } from "@/components/sign-in";
import { hasPublicSupabaseConfig } from "@/lib/env";
import type { MyWorkFilter } from "@/lib/routing";
import { createClient } from "@/lib/supabase/server";
import { TASK_SELECT } from "@/lib/task-select";
import type { OwnerAction, Task, TaskStatus, Worker } from "@/lib/types";

export async function DashboardPage({
  area,
  taskFilter = "inbox",
  myWorkFilter = "active",
  taskId,
  actionId,
  returnTo,
  createTaskForActionId,
}: {
  area: "tasks" | "my-work";
  taskFilter?: TaskStatus;
  myWorkFilter?: MyWorkFilter;
  taskId?: string;
  actionId?: string;
  returnTo?: string;
  createTaskForActionId?: string;
}) {
  if (!hasPublicSupabaseConfig()) return <SetupPanel />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignIn />;

  const [{ data: tasks }, { data: workers }, { data: ownerActions }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select(TASK_SELECT)
        .order("updated_at", { ascending: false })
        .order("attempt", { referencedTable: "runs", ascending: false }),
      supabase
        .from("workers")
        .select("id,name,last_seen_at,created_at")
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("owner_actions")
        .select(
          `
        id,title,notes,status,due_at,snoozed_until,position,completed_at,created_at,updated_at,
        owner_action_tasks(task_id,tasks(id,title,status))
      `,
        )
        .order("due_at", { ascending: true, nullsFirst: false }),
    ]);

  const initialTasks = (tasks ?? []) as Task[];
  const initialOwnerActions = (ownerActions ?? []) as unknown as OwnerAction[];
  if (taskId && !initialTasks.some((task) => task.id === taskId)) notFound();
  if (actionId && !initialOwnerActions.some((action) => action.id === actionId))
    notFound();
  const initialTaskActionId =
    createTaskForActionId &&
    initialOwnerActions.some((action) => action.id === createTaskForActionId)
      ? createTaskForActionId
      : null;

  return (
    <Dashboard
      initialTasks={initialTasks}
      initialWorkers={(workers ?? []) as Worker[]}
      initialOwnerActions={initialOwnerActions}
      userEmail={user.email ?? "account"}
      initialArea={area}
      initialTaskFilter={taskFilter}
      initialMyWorkFilter={myWorkFilter}
      initialTaskId={taskId ?? null}
      initialActionId={actionId ?? null}
      initialReturnTo={returnTo ?? null}
      initialTaskActionId={initialTaskActionId}
    />
  );
}
