-- ============================================================
-- Arch 正式版 — 階段 1：地基（資料表、權限、帳號自動建立）
-- 使用方式：Supabase 後台 → SQL Editor → New query → 貼上整份 → Run
-- 可以重複執行：已經存在的表不會被清空；權限規則與函式會用最新版覆蓋。
--
-- 設計原則：
--   · 9 張表全部開啟 RLS（列級權限）。前台只拿得到 Publishable key，所有限制都在資料庫這邊。
--   · 原始表只有「本人」與「管理者」讀得到；訪客看的公開資料走 public_* 檢視表，
--     只含可以公開的欄位（沒有審核備註、認領碼、收藏家 Email、提案價格）。
--   · 管理者 = 列在 admins 表裡的登入帳號（arch_is_admin()）。
--   · 畫家送出／修改、認領、提案選定等流程，在之後的階段用 security definer 函式（RPC）處理，
--     這一版前台對 artists、works 沒有直接寫入權限。
-- 狀態代碼（畫面上顯示中文）：
--   artists.status    draft 草稿／pending 待審核／approved 已上架／needs_changes 需修改
--   works.status      available 可購買／sold 已售出／not_for_sale 非賣品
--   inquiries.status  new 新的／read 已讀／replied 已回覆
--   wishes.status     pending 待審核／open 公開中／closed 已結案／rejected 未通過
--   proposals.status  pending 待審核／open 公開中／selected 被選中／rejected 未通過
-- ============================================================


-- ============================================================
-- 0. 共用：自動更新 updated_at
-- ============================================================
create or replace function public._arch_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ============================================================
-- 1. 帳號
-- ============================================================

-- ---------- profiles：每個登入過的人一筆 ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  avatar_url    text check (avatar_url is null or avatar_url ~ '^https://'),
  email         text,                                   -- Google 信箱：不公開，只有本人與管理者看得到
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- admins：管理者名單 ----------
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

-- 是否為管理者（權限規則與前台都會用到）
create or replace function public.arch_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.admins where user_id = auth.uid());
$$;

-- 替某個登入帳號建立 profile（已經有就略過）。名字、大頭貼預設帶入 Google 的資料
create or replace function public._arch_ensure_profile(p_uid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.profiles (id, email, display_name, avatar_url)
  select u.id,
         u.email,
         nullif(left(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), 40), ''),
         case when coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', '') ~ '^https://'
              then coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture') end
  from auth.users u
  where u.id = p_uid
  on conflict (id) do nothing;
$$;

-- 新帳號第一次登入時自動建立 profile
create or replace function public._arch_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._arch_ensure_profile(new.id);
  return new;
end;
$$;

-- Google 信箱改了時同步到 profiles
create or replace function public._arch_on_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists arch_on_auth_user_created on auth.users;
create trigger arch_on_auth_user_created
  after insert on auth.users
  for each row execute function public._arch_on_auth_user_created();

drop trigger if exists arch_on_auth_user_email on auth.users;
create trigger arch_on_auth_user_email
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public._arch_on_auth_user_email();


-- ============================================================
-- 2. 畫家與作品
-- ============================================================

-- ---------- artists ----------
create table if not exists public.artists (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid unique references public.profiles(id) on delete set null,  -- 可空：demo 搬來、還沒認領的畫家
  slug             text unique
                   check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60)),
  status           text not null default 'draft'
                   check (status in ('draft','pending','approved','needs_changes')),
  sort_order       int  not null default 100,
  name             text check (name is null or char_length(name) <= 40),
  tags             text[] not null default '{}',
  tagline          text check (tagline is null or char_length(tagline) <= 20),
  story            text check (story is null or char_length(story) <= 3000),
  portrait_url     text,
  email            text,                                  -- 畫家自填的「公開」聯絡信箱
  instagram        text check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  custom_ok        boolean not null default false,
  custom_note      text check (custom_note is null or char_length(custom_note) <= 80),
  referral_source  text check (referral_source in ('threads','instagram','friend','other')),
  review_note      text,                                  -- 審核備註（只有本人與管理者看得到）
  edit_token       uuid unique,                           -- demo 搬來時的認領碼；認領成功後清空
  claimed_at       timestamptz,                           -- 認領完成時間
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- 畫家頁網址 artist.html?slug=…：草稿可以先空著，送出審核之後一定要有
  constraint artists_slug_after_draft check (status = 'draft' or slug is not null)
);
create index if not exists artists_status_idx on public.artists(status, sort_order);

-- ---------- works ----------
create table if not exists public.works (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists(id) on delete cascade,
  position     int  not null check (position between 1 and 9),        -- 每位畫家最多 9 件
  title        text check (title is null or char_length(title) <= 60),
  image_url    text,
  medium       text check (medium in ('油畫','壓克力','水彩','膠彩','水墨','色鉛筆','粉彩','素描','版畫','複合媒材','電繪','其他')),
  support      text check (support in ('畫布','紙','木板','麻紙／絹','其他')),
  width_cm     numeric(7,1) check (width_cm > 0),
  height_cm    numeric(7,1) check (height_cm > 0),
  price_min    int check (price_min > 0),
  price_max    int,
  status       text not null default 'available' check (status in ('available','sold','not_for_sale')),
  year         int check (year between 1900 and 2100),
  description  text check (description is null or char_length(description) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint works_price_range check (price_max is null or price_min is null or price_max >= price_min),
  constraint works_digital_no_support check (medium is distinct from '電繪' or support is null),
  constraint works_artist_position unique (artist_id, position) deferrable initially deferred
);


-- ============================================================
-- 3. 收藏家互動
-- ============================================================

-- ---------- favorites：收藏作品或畫家（一筆只能是其中一種） ----------
create table if not exists public.favorites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  work_id     uuid references public.works(id) on delete cascade,
  artist_id   uuid references public.artists(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint favorites_one_target check (num_nonnulls(work_id, artist_id) = 1),
  constraint favorites_user_work   unique (user_id, work_id),
  constraint favorites_user_artist unique (user_id, artist_id)
);

-- ---------- inquiries：對作品或畫家的詢問 ----------
create table if not exists public.inquiries (
  id             uuid primary key default gen_random_uuid(),
  from_user_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  artist_id      uuid not null references public.artists(id) on delete cascade,
  work_id        uuid references public.works(id) on delete set null,
  message        text not null check (char_length(btrim(message)) between 1 and 2000),
  contact_email  text,          -- 送出當下自動抄一份詢問者的 Email，給被詢問的那位畫家回信用
  status         text not null default 'new' check (status in ('new','read','replied')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists inquiries_artist_idx on public.inquiries(artist_id, created_at desc);
create index if not exists inquiries_from_idx   on public.inquiries(from_user_id, created_at desc);

-- 送出詢問時：一律記成本人、狀態「新的」，並抄下本人的 Email
create or replace function public._arch_inquiry_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.from_user_id := auth.uid();
  end if;
  new.status := 'new';
  new.contact_email := (select p.email from public.profiles p where p.id = new.from_user_id);
  return new;
end;
$$;
drop trigger if exists arch_inquiry_fill on public.inquiries;
create trigger arch_inquiry_fill before insert on public.inquiries
  for each row execute function public._arch_inquiry_fill();


-- ============================================================
-- 4. 許願牆
-- ============================================================

-- ---------- wishes ----------
create table if not exists public.wishes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title        text check (title is null or char_length(btrim(title)) between 1 and 30),  -- 選填；沒填時畫面取故事前幾個字
  story        text not null check (char_length(btrim(story)) between 1 and 2000),
  tags         text[] not null default '{}' check (cardinality(tags) <= 5),
  occasion     text check (occasion is null or char_length(occasion) <= 20),
  budget_min   int check (budget_min >= 0),
  budget_max   int,
  show_name    boolean not null default false,              -- true：公開時顯示名字；false：顯示「匿名收藏家」
  status       text not null default 'pending' check (status in ('pending','open','closed','rejected')),
  review_note  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint wishes_budget_range check (budget_max is null or budget_min is null or budget_max >= budget_min)
);
create index if not exists wishes_status_idx on public.wishes(status, created_at desc);
create index if not exists wishes_user_idx   on public.wishes(user_id, created_at desc);

-- ---------- proposals：畫家對願望的提案（先審核，通過才公開） ----------
create table if not exists public.proposals (
  id              uuid primary key default gen_random_uuid(),
  wish_id         uuid not null references public.wishes(id) on delete cascade,
  artist_id       uuid not null references public.artists(id) on delete cascade,
  message         text not null check (char_length(btrim(message)) between 1 and 1000),
  price_estimate  int check (price_estimate > 0),            -- 只有許願者（與提案畫家本人、管理者）看得到
  status          text not null default 'pending' check (status in ('pending','open','selected','rejected')),
  review_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint proposals_one_per_artist unique (wish_id, artist_id)
);
create index if not exists proposals_wish_idx   on public.proposals(wish_id, created_at);
create index if not exists proposals_artist_idx on public.proposals(artist_id, created_at desc);


-- ============================================================
-- 5. 沿用：「留下你的想法」問卷
-- ============================================================
create table if not exists public.feedback (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_id        uuid references public.profiles(id) on delete set null,   -- 登入中送出才有
  would_replace  text not null check (would_replace in ('會','不會','不確定')),
  occasions      text[] not null default '{}',
  priorities     text[] not null default '{}',
  comment        text,
  email          text,
  source         text,
  status         text not null default 'new' check (status in ('new','read','done')),
  admin_note     text
);
create index if not exists feedback_created_idx on public.feedback(created_at desc);


-- ============================================================
-- 6. updated_at 觸發器
-- ============================================================
drop trigger if exists arch_touch on public.profiles;
create trigger arch_touch before update on public.profiles  for each row execute function public._arch_touch();
drop trigger if exists arch_touch on public.artists;
create trigger arch_touch before update on public.artists   for each row execute function public._arch_touch();
drop trigger if exists arch_touch on public.works;
create trigger arch_touch before update on public.works     for each row execute function public._arch_touch();
drop trigger if exists arch_touch on public.inquiries;
create trigger arch_touch before update on public.inquiries for each row execute function public._arch_touch();
drop trigger if exists arch_touch on public.wishes;
create trigger arch_touch before update on public.wishes    for each row execute function public._arch_touch();
drop trigger if exists arch_touch on public.proposals;
create trigger arch_touch before update on public.proposals for each row execute function public._arch_touch();


-- ============================================================
-- 7. 權限規則用的小函式（security definer：只回答是／否或自己的 id，不外流資料）
-- ============================================================

-- 我的畫家頁 id（沒有就是空值）
create or replace function public.arch_my_artist_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.artists where user_id = auth.uid();
$$;

-- 能不能對這位畫家（與這件作品）送出詢問：畫家已上架，作品要屬於這位畫家
create or replace function public.arch_can_inquire(p_artist uuid, p_work uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.artists a where a.id = p_artist and a.status = 'approved')
     and (p_work is null or exists(select 1 from public.works w where w.id = p_work and w.artist_id = p_artist));
$$;

-- 能不能對這個願望提案：願望公開中、提案的是自己已上架的畫家頁
create or replace function public.arch_can_propose(p_wish uuid, p_artist uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.wishes w where w.id = p_wish and w.status = 'open')
     and exists(select 1 from public.artists a where a.id = p_artist and a.user_id = auth.uid() and a.status = 'approved');
$$;


-- ============================================================
-- 8. 開啟 RLS ＋ 權限
--    先收回 Supabase 預設給 anon／authenticated 的全部權限，再只開需要的。
-- ============================================================
alter table public.profiles  enable row level security;
alter table public.admins    enable row level security;
alter table public.artists   enable row level security;
alter table public.works     enable row level security;
alter table public.favorites enable row level security;
alter table public.inquiries enable row level security;
alter table public.wishes    enable row level security;
alter table public.proposals enable row level security;
alter table public.feedback  enable row level security;

revoke all on public.profiles, public.admins, public.artists, public.works, public.favorites,
              public.inquiries, public.wishes, public.proposals, public.feedback
  from anon, authenticated;

-- 訪客（anon）對原始表沒有任何權限；公開資料只能透過第 9 段的 public_* 檢視表。
-- 登入的人（authenticated）：表層級先給權限，實際能碰哪幾列由下面的 policy 決定。
grant select                            on public.profiles  to authenticated;
grant update (display_name, avatar_url) on public.profiles  to authenticated;   -- 只能改名字與大頭貼
grant select, insert, update, delete    on public.artists   to authenticated;   -- 寫入只有管理者（policy）
grant select, insert, update, delete    on public.works     to authenticated;   -- 寫入只有管理者（policy）
grant select, insert, delete            on public.favorites to authenticated;
grant select, delete                    on public.inquiries to authenticated;
grant insert (artist_id, work_id, message) on public.inquiries to authenticated;
grant update (status)                   on public.inquiries to authenticated;
grant select, update, delete            on public.wishes    to authenticated;
grant insert (title, story, tags, occasion, budget_min, budget_max, show_name) on public.wishes to authenticated;
grant select, update, delete            on public.proposals to authenticated;
grant insert (wish_id, artist_id, message, price_estimate) on public.proposals to authenticated;
grant select, update, delete            on public.feedback  to authenticated;   -- 只有管理者（policy）；新增走 arch_submit_feedback

-- ---------- profiles ----------
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists "profiles admin read"  on public.profiles;
create policy "profiles self read"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles self update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles admin read"  on public.profiles for select to authenticated using ((select public.arch_is_admin()));

-- ---------- admins：沒有任何前台 policy（只透過 arch_is_admin() 判斷） ----------

-- ---------- artists ----------
drop policy if exists "artists self read" on public.artists;
drop policy if exists "artists admin all" on public.artists;
create policy "artists self read" on public.artists for select to authenticated using (user_id = (select auth.uid()));
create policy "artists admin all" on public.artists for all    to authenticated using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));

-- ---------- works ----------
drop policy if exists "works self read" on public.works;
drop policy if exists "works admin all" on public.works;
create policy "works self read" on public.works for select to authenticated using (artist_id = (select public.arch_my_artist_id()));
create policy "works admin all" on public.works for all    to authenticated using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));

-- ---------- favorites：只有本人 ----------
drop policy if exists "favorites self read"   on public.favorites;
drop policy if exists "favorites self insert" on public.favorites;
drop policy if exists "favorites self delete" on public.favorites;
drop policy if exists "favorites admin read"  on public.favorites;
create policy "favorites self read"   on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy "favorites self insert" on public.favorites for insert to authenticated with check (user_id = (select auth.uid()));
create policy "favorites self delete" on public.favorites for delete to authenticated using (user_id = (select auth.uid()));
create policy "favorites admin read"  on public.favorites for select to authenticated using ((select public.arch_is_admin()));

-- ---------- inquiries ----------
drop policy if exists "inquiries sender insert" on public.inquiries;
drop policy if exists "inquiries read"          on public.inquiries;
drop policy if exists "inquiries artist update" on public.inquiries;
drop policy if exists "inquiries admin all"     on public.inquiries;
create policy "inquiries sender insert" on public.inquiries for insert to authenticated
  with check (from_user_id = (select auth.uid()) and public.arch_can_inquire(artist_id, work_id));
create policy "inquiries read" on public.inquiries for select to authenticated
  using (from_user_id = (select auth.uid()) or artist_id = (select public.arch_my_artist_id()));
create policy "inquiries artist update" on public.inquiries for update to authenticated       -- 畫家只能改狀態（欄位權限限制）
  using (artist_id = (select public.arch_my_artist_id())) with check (artist_id = (select public.arch_my_artist_id()));
create policy "inquiries admin all" on public.inquiries for all to authenticated
  using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));

-- ---------- wishes ----------
drop policy if exists "wishes self insert" on public.wishes;
drop policy if exists "wishes self read"   on public.wishes;
drop policy if exists "wishes admin all"   on public.wishes;
create policy "wishes self insert" on public.wishes for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and review_note is null);
create policy "wishes self read" on public.wishes for select to authenticated using (user_id = (select auth.uid()));
create policy "wishes admin all" on public.wishes for all to authenticated
  using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));

-- ---------- proposals：新增一律待審核；許願者只看得到審核通過的 ----------
drop policy if exists "proposals artist insert" on public.proposals;
drop policy if exists "proposals artist read"   on public.proposals;
drop policy if exists "proposals wisher read"   on public.proposals;
drop policy if exists "proposals admin all"     on public.proposals;
create policy "proposals artist insert" on public.proposals for insert to authenticated
  with check (status = 'pending' and review_note is null and public.arch_can_propose(wish_id, artist_id));
create policy "proposals artist read" on public.proposals for select to authenticated
  using (artist_id = (select public.arch_my_artist_id()));
create policy "proposals wisher read" on public.proposals for select to authenticated
  using (status in ('open','selected')
         and exists(select 1 from public.wishes w where w.id = wish_id and w.user_id = (select auth.uid())));
create policy "proposals admin all" on public.proposals for all to authenticated
  using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));

-- ---------- feedback ----------
drop policy if exists "feedback admin all" on public.feedback;
create policy "feedback admin all" on public.feedback for all to authenticated
  using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));


-- ============================================================
-- 9. 公開檢視表（訪客也能讀）：只含可公開的欄位與已公開的資料
--    檢視表以建立者權限執行，所以能讀到原始表，但只吐出下面列出的欄位。
--    （Supabase 的 Security Advisor 會對這種寫法提出警告，這是預期中的。）
-- ============================================================
create or replace view public.public_artists as
  select a.id, a.slug, a.name, a.tags, a.tagline, a.story, a.portrait_url,
         a.email, a.instagram, a.custom_ok, a.custom_note, a.sort_order, a.created_at
  from public.artists a
  where a.status = 'approved';

create or replace view public.public_works as
  select w.id, w.artist_id, w.position, w.title, w.image_url, w.medium, w.support,
         w.width_cm, w.height_cm, w.price_min, w.price_max, w.status, w.year, w.description, w.created_at
  from public.works w
  join public.artists a on a.id = w.artist_id and a.status = 'approved';

create or replace view public.public_wishes as
  select w.id, w.title, w.story, w.tags, w.occasion, w.budget_min, w.budget_max, w.status, w.created_at,
         case when w.show_name then p.display_name end as author_name     -- 空值 = 匿名收藏家
  from public.wishes w
  left join public.profiles p on p.id = w.user_id
  where w.status in ('open','closed');

create or replace view public.public_proposals as                       -- 沒有預估價格
  select pr.id, pr.wish_id, pr.artist_id, pr.message, pr.status, pr.created_at,
         a.name as artist_name, a.slug as artist_slug
  from public.proposals pr
  join public.artists a on a.id = pr.artist_id and a.status = 'approved'
  join public.wishes  w on w.id = pr.wish_id  and w.status in ('open','closed')
  where pr.status in ('open','selected');

revoke all on public.public_artists, public.public_works, public.public_wishes, public.public_proposals from anon, authenticated;
grant select on public.public_artists, public.public_works, public.public_wishes, public.public_proposals to anon, authenticated;


-- ============================================================
-- 10. 前台可呼叫的 RPC
-- ============================================================

-- 我是誰：profile、是不是管理者、我的畫家頁。沒有 profile 時順手補建。
create or replace function public.arch_me()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v     jsonb;
begin
  if v_uid is null then
    return null;
  end if;
  perform public._arch_ensure_profile(v_uid);
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'email', p.email,
    'is_admin', exists(select 1 from public.admins ad where ad.user_id = v_uid),
    'artist', (select jsonb_build_object('id', a.id, 'slug', a.slug, 'status', a.status, 'name', a.name)
               from public.artists a where a.user_id = v_uid)
  ) into v
  from public.profiles p
  where p.id = v_uid;
  return v;
end;
$$;

-- 「留下你的想法」問卷：只能新增，讀不到任何回覆（沿用 demo，登入中會記下 user_id）
create or replace function public.arch_submit_feedback(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p->>'would_replace','') not in ('會','不會','不確定') then
    raise exception '請回答第一題';
  end if;
  if char_length(coalesce(p->>'comment','')) > 2000 then
    raise exception '建議或疑慮最多 2000 字';
  end if;
  if coalesce(p->>'email','') <> '' and p->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email 格式不正確';
  end if;
  insert into public.feedback (user_id, would_replace, occasions, priorities, comment, email, source)
  values (
    auth.uid(),
    p->>'would_replace',
    array(select x from jsonb_array_elements_text(coalesce(p->'occasions','[]'::jsonb)) x limit 10),
    array(select x from jsonb_array_elements_text(coalesce(p->'priorities','[]'::jsonb)) x limit 10),
    nullif(btrim(p->>'comment'),''),
    nullif(btrim(p->>'email'),''),
    left(p->>'source', 20)
  );
end;
$$;


-- ============================================================
-- 11. 函式執行權限
-- ============================================================
revoke all on function public._arch_touch()                       from anon, authenticated;
revoke all on function public._arch_ensure_profile(uuid)          from public, anon, authenticated;
revoke all on function public._arch_inquiry_fill()                from anon, authenticated;
revoke all on function public._arch_on_auth_user_email()          from anon, authenticated;
revoke all on function public._arch_on_auth_user_created()        from anon, authenticated;

revoke all on function public.arch_is_admin()                     from public, anon;
revoke all on function public.arch_my_artist_id()                 from public, anon;
revoke all on function public.arch_can_inquire(uuid, uuid)        from public, anon;
revoke all on function public.arch_can_propose(uuid, uuid)        from public, anon;
revoke all on function public.arch_me()                           from public, anon;
grant execute on function public.arch_is_admin()                  to authenticated;
grant execute on function public.arch_my_artist_id()              to authenticated;
grant execute on function public.arch_can_inquire(uuid, uuid)     to authenticated;
grant execute on function public.arch_can_propose(uuid, uuid)     to authenticated;
grant execute on function public.arch_me()                        to authenticated;
grant execute on function public.arch_submit_feedback(jsonb)      to anon, authenticated;


-- ============================================================
-- 12. 回填：替「這份 SQL 執行之前」就已經登入過的帳號補建 profile
--     （已經有 profile 的會略過，重複執行也安全）
-- ============================================================
select public._arch_ensure_profile(u.id) from auth.users u;


-- ============================================================
-- 設定管理者（要先用那個 Google 帳號在網站登入一次，再單獨執行；把 Email 換成你的）：
--   insert into public.admins (user_id, email)
--   select id, email from auth.users where email = 'you@gmail.com'
--   on conflict (user_id) do nothing;
-- ============================================================


-- ============================================================
-- 檢查：執行完下方會列出 9 張表，rls 欄應該全部是 true；profiles 筆數 = 登入過的帳號數
-- ============================================================
select c.relname as "資料表",
       c.relrowsecurity as rls,
       case c.relname when 'profiles' then (select count(*) from public.profiles)::text else '' end as "筆數"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('profiles','admins','artists','works','favorites','inquiries','wishes','proposals','feedback')
order by array_position(array['profiles','admins','artists','works','favorites','inquiries','wishes','proposals','feedback'], c.relname::text);
