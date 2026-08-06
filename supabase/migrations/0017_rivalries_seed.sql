-- Rivalry seed (spec §6 [v2]: "small manual seed table — no API source").
-- The table existed since 0001; nothing ever wrote or read it (audit #39).
-- Seeded by school name so this works regardless of CFBD id churn; pairs that
-- don't resolve (name changes) simply don't insert.

insert into public.rivalries (team_a_id, team_b_id, name, trophy)
select a.id, b.id, v.name, v.trophy
from (
  values
    ('Alabama', 'Auburn', 'Iron Bowl', null),
    ('Alabama', 'Tennessee', 'The Third Saturday in October', null),
    ('Army', 'Navy', 'Army–Navy Game', 'Thompson Cup'),
    ('Auburn', 'Georgia', 'Deep South''s Oldest Rivalry', null),
    ('California', 'Stanford', 'Big Game', 'Stanford Axe'),
    ('Clemson', 'South Carolina', 'Palmetto Bowl', 'Hardee''s Trophy'),
    ('Florida', 'Georgia', 'Florida–Georgia', 'Okefenokee Oar'),
    ('Florida', 'Florida State', 'Sunshine Showdown', null),
    ('Georgia', 'Georgia Tech', 'Clean, Old-Fashioned Hate', 'Governor''s Cup'),
    ('Harvard', 'Yale', 'The Game', null),
    ('Indiana', 'Purdue', 'Old Oaken Bucket Game', 'Old Oaken Bucket'),
    ('Iowa', 'Iowa State', 'Cy-Hawk', 'Cy-Hawk Trophy'),
    ('Iowa', 'Minnesota', 'Battle for Floyd', 'Floyd of Rosedale'),
    ('Kansas', 'Kansas State', 'Sunflower Showdown', 'Governor''s Cup'),
    ('Michigan', 'Michigan State', 'Battle for the Paul Bunyan Trophy', 'Paul Bunyan Trophy'),
    ('Michigan', 'Ohio State', 'The Game', null),
    ('Minnesota', 'Wisconsin', 'Battle for the Axe', 'Paul Bunyan''s Axe'),
    ('Mississippi State', 'Ole Miss', 'Egg Bowl', 'Golden Egg'),
    ('Notre Dame', 'USC', 'Notre Dame–USC', 'Jeweled Shillelagh'),
    ('Oklahoma', 'Oklahoma State', 'Bedlam', 'Bedlam Bell'),
    ('Oklahoma', 'Texas', 'Red River Rivalry', 'Golden Hat'),
    ('Oregon', 'Oregon State', 'The Rivalry', null),
    ('Oregon', 'Washington', 'Oregon–Washington', null),
    ('Pittsburgh', 'West Virginia', 'Backyard Brawl', null),
    ('Texas', 'Texas A&M', 'Lone Star Showdown', null),
    ('UCLA', 'USC', 'Battle for the Victory Bell', 'Victory Bell'),
    ('Utah', 'BYU', 'Holy War', 'Beehive Boot'),
    ('Virginia', 'Virginia Tech', 'Commonwealth Cup', 'Commonwealth Cup'),
    ('Washington', 'Washington State', 'Apple Cup', 'Apple Cup')
) as v(school_a, school_b, name, trophy)
join public.teams a on a.school = v.school_a
join public.teams b on b.school = v.school_b
where not exists (
  select 1 from public.rivalries r
  where (r.team_a_id = a.id and r.team_b_id = b.id)
     or (r.team_a_id = b.id and r.team_b_id = a.id)
);
