import { DashboardPage } from "@/app/dashboard-page";
import { parseMyWorkFilter } from "@/lib/routing";

export const dynamic = "force-dynamic";

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[];
    createTaskFor?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const createTaskForActionId = Array.isArray(query.createTaskFor)
    ? query.createTaskFor[0]
    : query.createTaskFor;
  return (
    <DashboardPage
      area="my-work"
      myWorkFilter={parseMyWorkFilter(query.status)}
      createTaskForActionId={createTaskForActionId}
    />
  );
}
