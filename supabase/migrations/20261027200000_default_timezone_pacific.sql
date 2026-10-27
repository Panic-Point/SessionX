-- The studio is on Pacific Time, so new installs default to it. Existing settings rows keep their
-- saved zone; change it on /admin/settings.
alter table settings alter column timezone set default 'America/Los_Angeles';
