# Task image attachments proposal

## Summary

Add private image attachments to Relay tasks so an owner can upload screenshots or photos while creating or editing a task, preview them in the task document, and have every worker run receive the images as first-class model input.

The recommended first release supports up to four JPEG, PNG, or WebP images per task, with a 10 MB limit per image. Images remain attached to the durable task and are included in initial and feedback runs until the owner removes them. Uploading a file does not place a public URL in the task instructions.

## Product behavior

### Create and edit

- Add an **Attach images** control below the Markdown instructions in both the new-task and edit-task sheets. On mobile, the file picker should allow the photo library and camera where the browser supports them.
- Show a thumbnail, filename, size, upload progress, retry state, and remove control for each selected image.
- Upload images only after the task has an ID. For a new task, create the task first, upload its selected images, and keep the composer open with a recoverable error if an upload fails.
- Do not allow the task to be queued while an attachment is uploading or failed.
- Allow attachments to be added or removed while a task has no active run. Disable attachment changes while a run is queued or working so the context cannot change underneath that run.

### Task detail and runs

- Render an **Attachments** section after the task document with accessible thumbnails. Selecting a thumbnail opens a full-size viewer with the original filename and a download action.
- Show an attachment count on task cards when nonzero.
- Include all current task images in every new run, including feedback runs. Feedback remains text; attaching a new image for a feedback run is done by editing the task before selecting **Run again**.
- Keep accepted results and follow-up behavior unchanged. A follow-up does not copy images automatically; the owner can explicitly attach them if they remain relevant.

## Data and storage design

Create a private Supabase Storage bucket named `task-images` and a metadata table:

```sql
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  filename text not null,
  mime_type text not null,
  byte_size integer not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  unique (task_id, position),
  check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  check (byte_size between 1 and 10485760),
  check (position between 0 and 3)
);
```

Use object paths of `{user_id}/{task_id}/{attachment_id}`. The bucket is never public. Add RLS policies so authenticated owners can read and manage only their rows and objects. A trigger should verify that `task_id` belongs to `user_id`, matching Relay's existing owner-link integrity pattern.

The database row is the source of truth. Deleting an attachment should delete both its object and metadata; if object deletion succeeds but row deletion fails, retain a structured error and retry. A periodic orphan cleanup job is a useful follow-on, but is not required to launch if API operations are ordered and logged carefully.

Do not store base64 image data in Postgres, task Markdown, the claim response, logs, or events. Events should contain attachment IDs and counts only.

## API design

Add owner-authenticated endpoints:

- `POST /api/tasks/:taskId/attachments` accepts `multipart/form-data`, validates ownership, MIME signature, count, and size, uploads the object, then inserts metadata.
- `DELETE /api/tasks/:taskId/attachments/:attachmentId` removes an attachment when no run is active.
- `GET /api/tasks/:taskId/attachments/:attachmentId` streams an image to the owner for previews and downloads. Alternatively, it may return a short-lived signed URL, but URLs must not be persisted.

Task list/detail selects should include attachment metadata but never signed URLs. The client can load authenticated preview routes on demand.

Extend `claim_next_run` to return attachment metadata with the claimed task. Because a table-returning PostgreSQL function cannot be changed in place when its return shape changes, ship this as `claim_next_run_v2` and update the route before removing v1 in a later migration. The claim response should contain IDs, filenames, MIME types, and byte sizes—not image bytes or storage credentials.

Add a worker-authenticated download route:

- `GET /api/worker/runs/:runId/attachments/:attachmentId` streams the private object only when the authenticated worker owns that run and the attachment belongs to its task.

This keeps the Supabase service key and storage URLs out of the local worker and makes authorization explicit. Use `Cache-Control: no-store`, a bounded request timeout, and streamed responses with a byte-count check.

## Worker and model handoff

After claiming a run, the worker downloads every declared image to a unique temporary directory, verifies its content type and declared size, and removes the directory in a `finally` block after completion or failure. Filenames generated by Relay—not owner filenames—should be used on disk.

For the Codex backend, extend `codexArguments` to add one `--image <local-path>` per attachment before the stdin prompt marker. Codex then receives the images as native initial-prompt attachments; the text prompt should also list their original filenames so references such as “the second screenshot” are unambiguous.

For the direct OpenAI backend, change the Responses API input from a plain string to a user content array containing one `input_text` item and one `input_image` item per attachment. Use a data URL made from each locally verified image for the first release, avoiding public or long-lived URLs. Enforce the aggregate limits before encoding.

If any image cannot be downloaded or verified, fail the run with a bounded message such as `Task attachment could not be prepared.` Do not silently run with missing visual context. Logs should include only run IDs, attachment IDs, sizes, and safe error categories.

## Validation and security

Validation must happen server-side even if the browser already checked the file:

- Allow only JPEG, PNG, and WebP in v1. Check magic bytes as well as the reported MIME type and reject SVG because it can contain active content.
- Limit each task to four images, each image to 10 MB, and the aggregate to 25 MB.
- Strip owner filenames from storage paths and escape them wherever displayed.
- Serve images with the stored safe `Content-Type`, `Content-Disposition`, `X-Content-Type-Options: nosniff`, and a restrictive content security policy.
- Never expose the service-role key or a broadly reusable signed URL to the model.
- Treat image contents as untrusted task input under the existing worker policy. Text visible in an image cannot override the trusted worker policy.
- Rate-limit uploads and worker downloads consistently with the rest of the authenticated API.

## Delivery plan

### Phase 1: persistence and API

1. Add the private bucket, `task_attachments` table, ownership trigger, indexes, and RLS/storage policies in a forward migration.
2. Add upload, delete, owner-view, and worker-download routes with unit tests for ownership, type, size, count, active-run locking, and cleanup failures.
3. Extend task types/selects and add `claim_next_run_v2` with backward-compatible deployment sequencing.

### Phase 2: worker support

1. Add bounded authenticated downloads and guaranteed temporary-file cleanup.
2. Pass local paths through Codex CLI `--image` arguments.
3. Build multimodal Responses API input for the OpenAI backend.
4. Add tests for argument construction, multimodal payloads, corrupt/truncated downloads, partial download failure, and cleanup after timeout.

### Phase 3: interface

1. Add attachment selection, validation, preview, progress, retry, and removal to task create/edit flows.
2. Add the detail gallery, full-size viewer, and task-card count.
3. Add keyboard and screen-reader coverage and verify camera/photo-library behavior on iOS Safari and Android Chrome.

Deploy the database expansion first, then compatible APIs and worker support, and finally enable the UI. Old workers must either receive no image-bearing runs or reject them with a clear “worker update required” error; the preferred approach is a worker capability field reported during polling so Relay only claims image tasks for workers advertising `task_images_v1`.

## Acceptance criteria

1. An owner can attach, preview, download, and remove up to four supported images from a task on desktop and mobile.
2. Images are private: another user, an unrelated worker, and an unauthenticated request cannot read them.
3. A queued run cannot observe a partially uploaded or silently missing attachment.
4. Both Codex CLI and direct OpenAI runs receive every attached image as native multimodal input, not merely as Markdown links.
5. Feedback runs receive the task's current images, and the interface clearly communicates that behavior.
6. Failed downloads, invalid image bytes, oversized files, and unsupported formats produce safe, actionable errors.
7. Temporary worker files are removed after success, failure, and timeout, and image contents or credentials never appear in logs.
8. Existing text-only tasks and workers continue operating during rollout.

## Deferred scope

PDFs and arbitrary files, image annotation or cropping, per-run attachments, copying images into follow-up tasks, result-image artifacts, automatic HEIC conversion, OCR indexing, and permanent thumbnail generation should be considered separately after image-task usage is understood. HEIC conversion is the most likely early follow-up because of mobile capture, but it adds image-processing and metadata-stripping responsibilities that should not be hidden inside the first storage release.
