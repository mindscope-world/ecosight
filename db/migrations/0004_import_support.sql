-- Support for loading researched datasets.

-- Between a named building and a whole city: the record is known to be in a
-- neighbourhood or on a street, and is drawn at that place, not at a doorstep.
alter type location_precision add value if not exists 'area' before 'city';

-- Funding as the research describes it, for records where the public disclosure
-- is too qualified to reduce to round rows without a person reading it.
alter table organisation add column funding_note text;
