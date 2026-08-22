import { DashboardPage } from "@/app/dashboard-page";

export const dynamic = "force-dynamic";

export default async function OwnerActionPage({
  params,
}: {
  params: Promise<{ actionId: string }>;
}) {
  const { actionId } = await params;
  return <DashboardPage area="my-work" actionId={actionId} />;
}
