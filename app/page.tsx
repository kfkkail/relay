import { Dashboard } from "@/components/dashboard";
import { SetupPanel } from "@/components/setup-panel";
import { SignIn } from "@/components/sign-in";
import { hasPublicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { OwnerAction, Task, Worker } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
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
        .select(
          `
        id,title,status,instructions,accepted_result,parent_task_id,created_at,updated_at,
        task_attachments(id,file_name,mime_type,byte_size,width,height),
        runs(id,task_id,status,attempt,worker_id,feedback,result_markdown,result_artifacts,error,queued_at,started_at,finished_at)
      `,
        )
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

  return (
    <Dashboard
      initialTasks={(tasks ?? []) as Task[]}
      initialWorkers={(workers ?? []) as Worker[]}
      initialOwnerActions={(ownerActions ?? []) as unknown as OwnerAction[]}
      userEmail={user.email ?? "account"}
    />
  );
}
