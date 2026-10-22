-- Local development/test roles only. Production roles are provisioned outside this repo.
CREATE ROLE app_migrator LOGIN PASSWORD 'migrator';
CREATE ROLE app_runtime LOGIN PASSWORD 'runtime';
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO app_migrator', current_database());
END $$;
ALTER SCHEMA public OWNER TO app_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;
