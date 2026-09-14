create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Lock the subscription before cancelling work so enqueueing cannot race removal.
create function public.remove_push_subscription(p_user_id uuid, p_subscription_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.push_subscriptions
    where id = p_subscription_id and user_id = p_user_id for update;
  if not found then return; end if;
  delete from public.push_deliveries where subscription_id = p_subscription_id and finished_at is null;
  delete from public.push_subscriptions where id = p_subscription_id and user_id = p_user_id;
end;
$$;
revoke all on function public.remove_push_subscription(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_push_subscription(uuid, uuid) to service_role;

create function public.invoke_push_delivery()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  delivery_url text;
  delivery_secret text;
begin
  select decrypted_secret into delivery_url from vault.decrypted_secrets where name = 'relay_push_delivery_url';
  select decrypted_secret into delivery_secret from vault.decrypted_secrets where name = 'relay_push_cron_secret';
  -- CI and preview databases have no production credentials and send no requests.
  if delivery_url is null or delivery_secret is null then return null; end if;
  if delivery_url !~ '^https://[^/?#]+/api/push/deliver$' then
    raise exception 'Invalid Relay push delivery URL';
  end if;
  return net.http_get(
    url := delivery_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || delivery_secret),
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function public.invoke_push_delivery() from public, anon, authenticated, service_role;
select cron.schedule('relay-push-delivery', '* * * * *', 'select public.invoke_push_delivery()');
