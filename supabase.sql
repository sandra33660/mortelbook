-- À coller dans Supabase → SQL Editor → New query, puis « Run ».
-- Crée la table où Mortelbook range tes données, et la verrouille :
-- chaque compte ne peut lire et écrire QUE ses propres lignes.

create table if not exists public.kv (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  coll       text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, coll, id)
);

alter table public.kv enable row level security;

drop policy if exists "kv: lecture de ses lignes" on public.kv;
drop policy if exists "kv: ajout de ses lignes" on public.kv;
drop policy if exists "kv: modif de ses lignes" on public.kv;
drop policy if exists "kv: suppression de ses lignes" on public.kv;

create policy "kv: lecture de ses lignes"     on public.kv for select to authenticated using ((select auth.uid()) = user_id);
create policy "kv: ajout de ses lignes"       on public.kv for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "kv: modif de ses lignes"       on public.kv for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "kv: suppression de ses lignes" on public.kv for delete to authenticated using ((select auth.uid()) = user_id);
