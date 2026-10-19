-- 생물 미니: Supabase 표와 접근 규칙
-- Supabase 대시보드 → SQL Editor → New query 에 전부 붙여 넣고 Run.
-- 여러 번 실행해도 괜찮다.

-- 1) 앱을 쓸 수 있는 사람 목록. 처음 만든 계정 하나가 자동으로 들어간다.
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;
drop policy if exists "members: read self" on public.members;
create policy "members: read self" on public.members
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.members where user_id = auth.uid()) $$;

-- 첫 사용자만 members에 넣는다. 그 뒤로 누가 가입해도 문항을 볼 수 없다.
create or replace function public.claim_first_member()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.members) then
    insert into public.members (user_id) values (new.id);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created_claim on auth.users;
create trigger on_auth_user_created_claim
  after insert on auth.users
  for each row execute function public.claim_first_member();

-- 이 SQL보다 먼저 계정을 만들어 뒀다면, 가장 먼저 만든 계정을 넣는다.
insert into public.members (user_id)
select id from auth.users
where not exists (select 1 from public.members)
order by created_at
limit 1;

-- 2) 문항 묶음. 행 하나 = meta 또는 책 한 권(문항 + 그림).
create table if not exists public.content (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.content enable row level security;
drop policy if exists "content: members read" on public.content;
create policy "content: members read" on public.content
  for select to authenticated using (public.is_member());
drop policy if exists "content: members insert" on public.content;
create policy "content: members insert" on public.content
  for insert to authenticated with check (public.is_member());
drop policy if exists "content: members update" on public.content;
create policy "content: members update" on public.content
  for update to authenticated using (public.is_member()) with check (public.is_member());
drop policy if exists "content: members delete" on public.content;
create policy "content: members delete" on public.content
  for delete to authenticated using (public.is_member());

-- 3) 학습 기록. 사람마다 한 행(풀이·회차 결과·북마크를 합친 JSON).
create table if not exists public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
drop policy if exists "user_state: own row" on public.user_state;
create policy "user_state: own row" on public.user_state
  for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- 고칠 때마다 updated_at을 새로 찍는다(앱은 이 값으로 바뀐 문항만 다시 받는다).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists content_touch on public.content;
create trigger content_touch before update on public.content
  for each row execute function public.touch_updated_at();
drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch before update on public.user_state
  for each row execute function public.touch_updated_at();

-- 로그인하지 않은 요청(anon)은 아무 표도 못 본다.
revoke all on public.members, public.content, public.user_state from anon;
grant select on public.members to authenticated;
grant select, insert, update, delete on public.content to authenticated;
grant select, insert, update, delete on public.user_state to authenticated;
