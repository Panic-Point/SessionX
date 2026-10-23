begin;
select plan(9);

-- Seed data provides 6 weekly_hours rows.

select is(
  (select relrowsecurity from pg_class where oid = 'public.login_tokens'::regclass),
  true,
  'login_tokens has RLS'
);

select is(
  (select count(*)::int from pg_policies where tablename = 'login_tokens'),
  0,
  'login_tokens has no policies'
);

select throws_ok(
  $$ select replace_weekly_hours('[{"weekday":1,"start":"10:00","end":"11:00"},
                                  {"weekday":2,"start":"15:00","end":"15:00"}]'::jsonb) $$,
  '23514',
  null,
  'replace_weekly_hours rejects end <= start'
);

select is(
  (select count(*)::int from weekly_hours),
  6,
  'original weekly_hours rows survive a failed replace'
);

select replace_weekly_hours('[{"weekday":2,"start":"09:00","end":"12:00"},
                              {"weekday":5,"start":"15:00","end":"20:00"}]'::jsonb);

select results_eq(
  $$ select weekday::int, start_time, end_time from weekly_hours order by weekday $$,
  $$ values (2, '09:00'::time, '12:00'::time), (5, '15:00'::time, '20:00'::time) $$,
  'replace_weekly_hours replaces all rows'
);

select save_date_override('2030-03-01', true, 'Holiday', '[]'::jsonb);

select results_eq(
  $$ select o.is_closed, o.note, (select count(*)::int from date_override_ranges where date = o.date)
       from date_overrides o where o.date = '2030-03-01' $$,
  $$ values (true, 'Holiday'::text, 0) $$,
  'save_date_override inserts closed day with no ranges'
);

select save_date_override('2030-03-02', false, 'Short', '[{"start":"10:00","end":"12:00"}]'::jsonb);
select save_date_override('2030-03-02', false, 'Other',
  '[{"start":"13:00","end":"14:00"},{"start":"16:00","end":"18:00"}]'::jsonb);

select results_eq(
  $$ select start_time, end_time from date_override_ranges where date = '2030-03-02' order by start_time $$,
  $$ values ('13:00'::time, '14:00'::time), ('16:00'::time, '18:00'::time) $$,
  'save_date_override replaces ranges on re-save'
);

select save_date_override('2030-03-02', true, 'Other', '[{"start":"10:00","end":"12:00"}]'::jsonb);

select is(
  (select count(*)::int from date_override_ranges where date = '2030-03-02'),
  0,
  'save_date_override closed clears ranges'
);

select is(
  has_function_privilege('anon', 'replace_weekly_hours(jsonb)', 'execute')
    or has_function_privilege('anon', 'save_date_override(date,boolean,text,jsonb)', 'execute'),
  false,
  'anon cannot execute either function'
);

select * from finish();
rollback;
