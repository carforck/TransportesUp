-- Transportes UP · esquema inicial en Supabase
-- Ejecutar UNA vez en: Supabase → SQL Editor → New query → pegar y "Run".
--
-- Diseño: la app guarda su estado (config, clientes, bitácoras) como un documento JSON versionado,
-- igual que data/db.json en local. Las imágenes (firma y # ID) van al bucket PRIVADO "firmas".
-- Solo el servidor (clave secreta / service_role) accede. Ningún dato queda expuesto a la clave pública.

-- 1) Estado de la app (una fila)
create table if not exists public.app_estado (
  id          smallint primary key default 1 check (id = 1),
  datos       jsonb       not null,
  version     integer     not null default 1,
  actualizado timestamptz not null default now()
);

-- RLS activo y SIN políticas: anon y authenticated no pueden leer ni escribir nada.
alter table public.app_estado enable row level security;

-- Con "Automatically expose new tables" desactivado hay que dar permisos explícitos.
-- Solo al rol del servidor (la clave secreta usa service_role, que ignora RLS).
revoke all on public.app_estado from anon, authenticated;
grant select, insert, update on public.app_estado to service_role;

-- 2) Bucket privado para firmas e # ID (versión limpia + original)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('firmas', 'firmas', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
