-- Many rounds are reported only to the month or the year. The date column holds
-- the first day of that period, and this says how much of it is real, so a round
-- "in 2021" is never shown as "1 January 2021".
alter table funding_round
  add column announced_precision text
    check (announced_precision in ('day', 'month', 'year'));

update funding_round set announced_precision = 'day' where announced_on is not null;

alter table funding_round
  add constraint funding_round_precision_with_date
    check ((announced_on is null) = (announced_precision is null));
