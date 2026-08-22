import { DashboardPage } from "@/app/dashboard-page";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return <DashboardPage area="tasks" taskId={taskId} />;
}
