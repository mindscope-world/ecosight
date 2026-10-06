-- Other names an organisation goes by. Two datasets often name the same
-- organisation differently ("Example Capital" and "Example Capital Africa"); an alias lets the
-- second one find the first instead of creating a duplicate.
alter table organisation add column aliases text[] not null default '{}';
