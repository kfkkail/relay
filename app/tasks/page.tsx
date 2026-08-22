import { DashboardPage } from "@/app/dashboard-page";
import { parseTaskFilter } from "@/lib/routing";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <DashboardPage area="tasks" taskFilter={parseTaskFilter(query.status)} />
  );
}
