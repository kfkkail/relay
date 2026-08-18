alter table public.task_attachments
  drop constraint task_attachments_task_id_fkey;

notify pgrst, 'reload schema';
