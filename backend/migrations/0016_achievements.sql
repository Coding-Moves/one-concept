-- Permanent, server-issued achievements. Definitions can grow beyond streaks;
-- new metric types need a server evaluator before being enabled.
begin;
create table public.achievement_definitions (
    code text primary key,
    metric text not null,
    threshold integer not null check (threshold > 0),
    name text not null,
    description text not null,
    artwork_key text not null,
    sort_order integer not null,
    unique (metric, threshold)
);
create table public.user_achievements (
    user_id uuid not null references public.profiles(id) on delete cascade,
    achievement_code text not null references public.achievement_definitions(code),
    earned_on date not null,
    recorded_at timestamptz not null default now(),
    source text not null check (source in ('history', 'completion')),
    seen_at timestamptz,
    primary key (user_id, achievement_code)
);
alter table public.achievement_definitions enable row level security;
alter table public.user_achievements enable row level security;
-- Authenticated clients may read definitions/their own awards, but cannot mint,
-- edit or delete awards. The verified API performs all writes.
create policy achievements_catalog_read on public.achievement_definitions
    for select to authenticated using (true);
create policy achievements_owner_read on public.user_achievements
    for select to authenticated using (user_id = auth.uid());

insert into public.achievement_definitions
(code,metric,threshold,name,description,artwork_key,sort_order) values
('streak_7','consecutive_days',7,'First flame','Seven days of showing up for your learning.','candle',1),
('streak_30','consecutive_days',30,'Steady fire','A month of consistent daily learning.','flame',2),
('streak_90','consecutive_days',90,'Bright spark','Ninety days of growing your knowledge.','spark',3),
('streak_180','consecutive_days',180,'Guiding light','One hundred and eighty days of steady progress.','sun',4),
('streak_365','consecutive_days',365,'Year of discovery','Three hundred and sixty-five consecutive learning days.','emblem',5),
('streak_500','consecutive_days',500,'Trailblazer','Five hundred days of curiosity put into practice.','compass',6),
('streak_1000','consecutive_days',1000,'Golden legacy','One thousand consecutive days of learning.','star',7),
('streak_5000','consecutive_days',5000,'Beyond the horizon','Five thousand days of extraordinary dedication.','planet',8),
('streak_10000','consecutive_days',10000,'Universe of knowledge','Ten thousand consecutive learning days.','universe',9);

-- Credit existing learners, including streaks that have since ended. The union
-- counts a lesson and review on the same local day only once. Find the first
-- day on which each milestone was reached, not the migration execution date.
with days as (
    select user_id, assigned_for as d from public.daily_assignments where completed_at is not null
    union select user_id, assigned_for from public.daily_reviews where completed_at is not null
), islands as (
    select user_id,d,d-(row_number() over(partition by user_id order by d))::int as grp from days
), lengths as (
    select user_id,d,row_number() over(partition by user_id,grp order by d) as length from islands
)
insert into public.user_achievements(user_id,achievement_code,earned_on,source)
select l.user_id,a.code,min(l.d),'history' from lengths l
join public.achievement_definitions a on a.metric='consecutive_days' and l.length=a.threshold
 group by l.user_id,a.code
on conflict do nothing;
commit;
