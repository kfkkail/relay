import { DashboardPage } from "@/app/dashboard-page";
import { parseMyWorkFilter, safeReturnPath } from "@/lib/routing";

export const dynamic = "force-dynamic";

export default async function OwnerActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ actionId: string }>;
  searchParams: Promise<{
    status?: string | string[];
    from?: string | string[];
  }>;
}) {
  const { actionId } = await params;
  const query = await searchParams;
  const filter = parseMyWorkFilter(query.status);
  const fallback = `/my-work?status=${filter}`;
  return (
    <DashboardPage
      area="my-work"
      actionId={actionId}
      myWorkFilter={filter}
      returnTo={safeReturnPath(query.from, fallback)}
    />
  );
}
