-- Server-side allowlist for private WayNear admin/test builds.
-- Only SHA-256 token hashes are stored. The raw admin token never belongs in Git.
create table if not exists public.waynear_admin_tokens (
  token_hash text primary key check (length(token_hash) = 64),
  label text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.waynear_admin_tokens enable row level security;
revoke all on public.waynear_admin_tokens from public, anon, authenticated;
grant select on public.waynear_admin_tokens to service_role;

create or replace function public.neartime_admin_token_valid(p_token_hash text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.waynear_admin_tokens
    where token_hash = lower(p_token_hash)
      and enabled = true
  );
$$;

revoke all on function public.neartime_admin_token_valid(text) from public, anon, authenticated;
grant execute on function public.neartime_admin_token_valid(text) to service_role;

insert into public.waynear_admin_tokens(token_hash, label, enabled)
values (
  '2e735a390f734b726791f6c7b8d9d7cc81558032ab8b12fbd70abea0959bc341',
  'primary-owner-admin-build',
  true
)
on conflict (token_hash) do update
set label = excluded.label,
    enabled = true;
