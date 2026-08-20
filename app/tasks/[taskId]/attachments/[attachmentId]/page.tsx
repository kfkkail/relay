import { notFound, redirect } from "next/navigation";
import { FileViewerShell } from "@/components/file-viewer";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ImageViewerPage({
  params,
}: {
  params: Promise<{ taskId: string; attachmentId: string }>;
}) {
  const { taskId, attachmentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: attachment } = await supabase
    .from("task_attachments")
    .select("file_name,mime_type,byte_size")
    .eq("id", attachmentId)
    .eq("task_id", taskId)
    .eq("user_id", user.id)
    .not("finalized_at", "is", null)
    .maybeSingle();
  if (!attachment) notFound();

  const sourceUrl = `/api/tasks/${taskId}/attachments/${attachmentId}`;
  return (
    <FileViewerShell
      title={attachment.file_name}
      detail={`${attachment.mime_type} · ${formatBytes(attachment.byte_size)}`}
      downloadUrl={sourceUrl}
    >
      {/* Authenticated dynamic image endpoint. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="file-viewer-image"
        src={sourceUrl}
        alt={attachment.file_name}
      />
    </FileViewerShell>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
