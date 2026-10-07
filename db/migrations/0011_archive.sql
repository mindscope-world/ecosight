-- A third thing a reviewer can decide. Rejected means "this is wrong, keep it
-- out". Archived means "this may well be right, but there is not enough to
-- publish yet": incomplete or unverified records are set aside, out of the
-- waiting list, where they can be found again when more is known.
alter type review_status add value if not exists 'archived';
