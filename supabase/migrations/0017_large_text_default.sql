-- Large text ON by default. The user base skews elderly (spec §9 notes this
-- when arguing for billing grace periods), so the accessible scale is the
-- better starting point: someone who doesn't need it can turn it off in the
-- You tab, which is a much cheaper mistake than someone who needs it never
-- finding the toggle.
--
-- create_user (0003) inserts into users without naming large_text_mode, so
-- the column default is what every new signup gets — including signups via
-- the 0006 auth trigger. Nothing else needs to change.

alter table users alter column large_text_mode set default true;

-- Existing rows keep whatever they have. There's no record of who chose
-- `false` deliberately versus who simply never opened the toggle, and
-- flipping the former would override a real preference. To opt every current
-- account in anyway (reasonable while pre-launch, when they're all test
-- accounts), run by hand:
--   update users set large_text_mode = true;
