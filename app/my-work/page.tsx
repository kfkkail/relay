import { DashboardPage } from "@/app/dashboard-page";
import { parseMyWorkFilter } from "@/lib/routing";

export const dynamic = "force-dynamic";

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <DashboardPage
      area="my-work"
      myWorkFilter={parseMyWorkFilter(query.status)}
    />
  );
}
