"""Flag published organisations whose facts have not been confirmed for 12 months.

An organisation was last confirmed when a source for one of its facts was last
verified (an import a person vetted, a reviewer's approval, a later re-check); one
with no verified source counts from the day it was added. Flagging only sets
`stale_since`, so the app can say "not re-checked" beside the record. It never hides
or changes the record, and re-confirming a fact clears the flag on the next run.
"""

from dataclasses import dataclass
from datetime import datetime, timezone

STALE_AFTER = "12 months"

_CONFIRMED = """
    select o.id, coalesce(max(f.verified_at), o.created_at) as confirmed
    from organisation o
    left join field_source f on f.record_type = 'organisation' and f.record_id = o.id and f.verified_at is not null
    where o.status = 'published'
    group by o.id
"""


@dataclass
class StaleReport:
    flagged: int = 0
    cleared: int = 0
    stale: int = 0
    published: int = 0


def flag_stale(conn, apply: bool, now: datetime | None = None) -> StaleReport:
    now = now or datetime.now(timezone.utc)
    with conn.cursor() as cur:
        # Withdrawn from publication since being flagged: the flag no longer means anything.
        cur.execute(
            f"""
            with c as ({_CONFIRMED}),
            due as (select id from c where confirmed < %s::timestamptz - interval '{STALE_AFTER}')
            select
              (select count(*) from due d join organisation o on o.id = d.id where o.stale_since is null),
              (select count(*) from c join organisation o on o.id = c.id
                 where o.stale_since is not null and c.id not in (select id from due)),
              (select count(*) from due),
              (select count(*) from c)
            """,
            (now,),
        )
        flagged, cleared, stale, published = cur.fetchone()
        if apply:
            cur.execute(
                f"""
                with c as ({_CONFIRMED}),
                due as (select id from c where confirmed < %s::timestamptz - interval '{STALE_AFTER}')
                update organisation o set stale_since = case when o.id in (select id from due) then coalesce(o.stale_since, %s) end
                where o.status = 'published' and (o.id in (select id from due)) <> (o.stale_since is not null)
                """,
                (now, now),
            )
            # A flagged record that is no longer published is not stale news to anyone.
            cur.execute("update organisation set stale_since = null where status <> 'published' and stale_since is not null")
    if apply:
        conn.commit()
    return StaleReport(flagged, cleared, stale, published)


def summarise(report: StaleReport) -> str:
    return (
        f"{report.published} published organisations; {report.stale} not confirmed for {STALE_AFTER} "
        f"({report.flagged} newly flagged, {report.cleared} cleared)"
    )
