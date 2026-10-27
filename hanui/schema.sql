-- 한의학개론 문제은행: Supabase 표와 접근 규칙
-- 생물 미니와 같은 Supabase 프로젝트에서, supabase/schema.sql을 이미 실행한 뒤에 쓴다
-- (members 표와 is_member() 함수를 같이 쓴다).
-- Supabase 대시보드 → SQL Editor → New query 에 전부 붙여 넣고 Run. 여러 번 실행해도 괜찮다.

-- 1) 문항 묶음. 행 id = 'data'(문항) / 'jydata'(집요·생리학 복습). data는 JSON 문자열.
create table if not exists public.hanui_content (
  id text primary key,
  data text not null,
  updated_at timestamptz not null default now()
);
alter table public.hanui_content enable row level security;
drop policy if exists "hanui_content: members all" on public.hanui_content;
create policy "hanui_content: members all" on public.hanui_content
  for all to authenticated using (public.is_member()) with check (public.is_member());

-- 2) 학습 기록. 사람마다 한 행. data는 앱 기록 전체(JSON 문자열).
create table if not exists public.hanui_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);
alter table public.hanui_state enable row level security;
drop policy if exists "hanui_state: own row" on public.hanui_state;
create policy "hanui_state: own row" on public.hanui_state
  for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- 고칠 때마다 updated_at을 새로 찍는다(앱은 이 값으로 바뀐 문항만 다시 받는다).
drop trigger if exists hanui_content_touch on public.hanui_content;
create trigger hanui_content_touch before update on public.hanui_content
  for each row execute function public.touch_updated_at();
drop trigger if exists hanui_state_touch on public.hanui_state;
create trigger hanui_state_touch before update on public.hanui_state
  for each row execute function public.touch_updated_at();

revoke all on public.hanui_content, public.hanui_state from anon;
grant select, insert, update, delete on public.hanui_content to authenticated;
grant select, insert, update, delete on public.hanui_state to authenticated;
