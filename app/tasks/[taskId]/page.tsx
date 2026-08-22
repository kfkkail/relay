import { DashboardPage } from "@/app/dashboard-page";
import { parseTaskFilter, safeReturnPath } from "@/lib/routing";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{
    status?: string | string[];
    from?: string | string[];
  }>;
}) {
  const { taskId } = await params;
  const query = await searchParams;
  const filter = parseTaskFilter(query.status);
  const fallback = `/tasks?status=${filter}`;
  return (
    <DashboardPage
      area="tasks"
      taskId={taskId}
      taskFilter={filter}
      returnTo={safeReturnPath(query.from, fallback)}
    />
  );
}
