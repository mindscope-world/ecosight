-- Synthetic sample data for local development and tests.
-- Organisations here are invented; only the neighbourhood locations are real.
-- Real Nairobi records come from the researchers and the review queue.

truncate organisation, event, raw_document, field_source, review_item, audit_log cascade;

do $$
declare
  hoods text[] := array['Westlands', 'Kilimani', 'Upper Hill', 'CBD', 'Karen', 'Ngong Road', 'Lavington', 'Gigiri'];
  lons float8[] := array[36.8065, 36.7870, 36.8130, 36.8219, 36.7073, 36.7820, 36.7680, 36.8140];
  lats float8[] := array[-1.2676, -1.2906, -1.2990, -1.2864, -1.3197, -1.3000, -1.2780, -1.2330];
  sectors text[] := array['fintech', 'agritech', 'healthtech', 'logistics', 'cleantech', 'edtech'];
  stages text[] := array['pre-seed', 'seed', 'series-a', 'series-b'];
  kinds org_type[] := array['startup', 'fund', 'ngo', 'accelerator']::org_type[];
  labels text[] := array['Startup', 'Fund', 'NGO', 'Accelerator'];
  counts int[] := array[30, 8, 4, 4];
  k int;
  i int;
  h int;
  n text;
  org uuid;
  first_fund uuid;
  rnd uuid;
begin
  perform setseed(0.42);

  for k in 1..4 loop
    for i in 1..counts[k] loop
      n := lpad(i::text, 2, '0');
      insert into organisation (name, slug, types, sectors, stage, description, status)
      values (
        format('Sample %s %s', labels[k], n),
        format('sample-%s-%s', lower(labels[k]), n),
        array[kinds[k]],
        array[sectors[1 + (i % 6)]],
        case when k = 1 then stages[1 + (i % 4)] end,
        'Synthetic record for local development.',
        'published'
      )
      returning id into org;

      if k = 2 and first_fund is null then
        first_fund := org;
      end if;

      h := 1 + ((i + k) % 8);
      insert into office (organisation_id, is_hq, address, city, country, geom, valid_from)
      values (
        org, true, hoods[h], 'Nairobi', 'KE',
        st_setsrid(st_makepoint(
          lons[h] + (random() - 0.5) * 0.012,
          lats[h] + (random() - 0.5) * 0.012
        ), 4326)::geography,
        date '2019-01-01' + i * 45
      );

      -- Every third startup has a branch in another neighbourhood.
      if k = 1 and i % 3 = 0 then
        h := 1 + ((i + 4) % 8);
        insert into office (organisation_id, is_hq, address, city, country, geom, valid_from)
        values (
          org, false, hoods[h], 'Nairobi', 'KE',
          st_setsrid(st_makepoint(
            lons[h] + (random() - 0.5) * 0.012,
            lats[h] + (random() - 0.5) * 0.012
          ), 4326)::geography,
          date '2021-01-01' + i * 30
        );
      end if;

      insert into field_source (record_type, record_id, field, source_url, method, confidence, verified_at)
      values ('organisation', org, 'name', 'https://example.org/seed', 'manual', 1, now() - (i || ' days')::interval);

      -- Every fifth startup has a round led by the first sample fund.
      if k = 1 and i % 5 = 0 then
        insert into funding_round (organisation_id, stage, amount_original, currency, amount_usd, fx_rate, announced_on, status)
        values (org, stages[1 + (i % 4)], i * 100000, 'USD', i * 100000, 1, date '2024-01-01' + i * 20, 'published')
        returning id into rnd;
      end if;
    end loop;
  end loop;

  -- Rounds were inserted before the funds existed; attach the lead now.
  insert into round_investor (round_id, investor_id, is_lead)
  select id, first_fund, true from funding_round;

  for i in 1..6 loop
    h := 1 + (i % 8);
    insert into event (name, venue, city, country, geom, starts_at, ends_at, url, status)
    values (
      format('Sample Meetup %s', lpad(i::text, 2, '0')),
      hoods[h], 'Nairobi', 'KE',
      st_setsrid(st_makepoint(lons[h], lats[h]), 4326)::geography,
      now() + (i * 7 || ' days')::interval,
      now() + (i * 7 || ' days')::interval + interval '3 hours',
      'https://example.org/seed',
      'published'
    );
  end loop;
end $$;
