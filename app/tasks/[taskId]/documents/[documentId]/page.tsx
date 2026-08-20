import { notFound, redirect } from "next/navigation";
import { DocumentPreview, FileViewerShell } from "@/components/file-viewer";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DocumentViewerPage({
  params,
}: {
  params: Promise<{ taskId: string; documentId: string }>;
}) {
  const { taskId, documentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: document } = await supabase
    .from("result_documents")
    .select("storage_path,display_filename,mime_type,byte_size")
    .eq("id", documentId)
    .eq("task_id", taskId)
    .eq("user_id", user.id)
    .eq("staged", false)
    .maybeSingle();
  if (!document) notFound();

  const sourceUrl = `/api/tasks/${taskId}/documents/${documentId}`;
  let content: string | null = null;
  if (document.mime_type !== "application/pdf") {
    const { data: file, error } = await supabase.storage
      .from("result-documents")
      .download(document.storage_path);
    if (error || !file) notFound();
    content = await file.text();
  }

  return (
    <FileViewerShell
      title={document.display_filename}
      detail={`${document.mime_type} · ${formatBytes(document.byte_size)}`}
      downloadUrl={sourceUrl}
    >
      <DocumentPreview
        mimeType={document.mime_type}
        content={content}
        sourceUrl={sourceUrl}
        title={document.display_filename}
      />
    </FileViewerShell>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
