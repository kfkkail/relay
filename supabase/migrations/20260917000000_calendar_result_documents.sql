alter table public.result_documents
  drop constraint result_documents_mime_type_check;

alter table public.result_documents
  add constraint result_documents_mime_type_check
  check (mime_type in ('text/markdown', 'text/plain', 'application/pdf', 'text/csv', 'application/json', 'text/calendar'));

update storage.buckets
set allowed_mime_types = array['text/markdown', 'text/plain', 'application/pdf', 'text/csv', 'application/json', 'text/calendar']
where id = 'result-documents';
