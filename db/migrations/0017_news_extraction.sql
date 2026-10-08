-- Which stored news documents have been read, by which extractor, and what came
-- of each. One row per document, so nothing is read twice and a run can be
-- audited. A document that reported a funding round points at the item it put
-- in the review queue; nothing is published from here.
create table news_extraction (
  document_id uuid primary key references raw_document on delete cascade,
  extractor text not null,
  is_funding boolean not null,
  review_item_id uuid references review_item on delete set null,
  extracted_at timestamptz not null default now()
);
