#!/bin/sh
# Runs once, when the database volume is first created. Creates the restricted runtime login used by
# api/worker. Its table permissions come from infra/runtime-grants.sql (the "grants" service).
psql -v ON_ERROR_STOP=1 -v app_password="$POSTGRES_APP_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE iac_runtime NOLOGIN;
CREATE ROLE iac_app LOGIN PASSWORD :'app_password' IN ROLE iac_runtime;
SQL
