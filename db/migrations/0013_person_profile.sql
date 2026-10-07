-- A person's public LinkedIn profile, so a founder's name can lead to it.
-- Only a profile address is kept, never anything read from the profile, and
-- only with the page the address was found on.
alter table person_role
  add column linkedin_url text
    check (linkedin_url ~ '^https://www\.linkedin\.com/in/[^/?#[:space:]]+$'),
  add column linkedin_source text,
  add constraint person_role_profile_has_source check (linkedin_url is null or linkedin_source is not null);
