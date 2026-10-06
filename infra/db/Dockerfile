# pgvector plus PostGIS. Only extensions that Supabase also offers are used,
# so local and hosted databases run the same migrations.
FROM pgvector/pgvector:pg17
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-postgis-3 \
  && rm -rf /var/lib/apt/lists/*
