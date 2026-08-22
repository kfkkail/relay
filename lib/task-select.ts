const runsByTask = "runs:runs!runs_task_id_fkey";

export const TASK_SELECT = `
  id,title,status,instructions,deliverable,accepted_result,accepted_run_id,parent_task_id,created_at,updated_at,
  task_attachments(id,file_name,mime_type,byte_size,width,height),
  ${runsByTask}(id,task_id,status,attempt,worker_id,feedback,deliverable,result_markdown,result_artifacts,error,queued_at,started_at,finished_at,result_documents(id,display_filename,mime_type,byte_size,description))
`;

export const TASK_RUN_SUMMARY_SELECT = `id,status,instructions,deliverable,${runsByTask}(id,status,attempt)`;
