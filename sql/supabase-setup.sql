-- =============================================================
-- Pizza'Man - Suivi de livraison en temps réel
-- =============================================================
-- À exécuter UNE SEULE FOIS dans Supabase :
--   Dashboard -> SQL Editor -> New query -> coller ce fichier -> Run
--
-- Ce script crée la table qui stocke les livraisons en cours,
-- active la sécurité (RLS) et le temps réel (Realtime).
-- =============================================================

-- 1) Table des livraisons ------------------------------------
create table if not exists public.deliveries (
  id           uuid primary key default gen_random_uuid(),
  client_name  text,
  client_phone text,
  destination  text,
  eta_minutes  integer,
  status       text not null default 'en_route',  -- en_route | arrived | cancelled
  driver_lat   double precision,
  driver_lng   double precision,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2) Sécurité (Row Level Security) ---------------------------
-- Le site n'a pas de système de connexion : la pizzeria est petite
-- et le lien de suivi contient un identifiant (uuid) impossible à
-- deviner. On autorise donc lecture / création / mise à jour via la
-- clé publique. Si vous voulez durcir plus tard, ajoutez une
-- authentification livreur et restreignez les policies "insert/update".
alter table public.deliveries enable row level security;

drop policy if exists "deliveries_select" on public.deliveries;
create policy "deliveries_select"
  on public.deliveries for select
  using (true);

drop policy if exists "deliveries_insert" on public.deliveries;
create policy "deliveries_insert"
  on public.deliveries for insert
  with check (true);

drop policy if exists "deliveries_update" on public.deliveries;
create policy "deliveries_update"
  on public.deliveries for update
  using (true)
  with check (true);

-- 3) Temps réel (Realtime) -----------------------------------
-- Permet à la page de suivi du client de recevoir la position du
-- livreur instantanément (sans recharger). Idempotent.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'deliveries'
  ) then
    alter publication supabase_realtime add table public.deliveries;
  end if;
end $$;

-- 4) (Optionnel) Nettoyage des vieilles livraisons -----------
-- À lancer manuellement de temps en temps pour purger l'historique :
--   delete from public.deliveries where started_at < now() - interval '2 days';
