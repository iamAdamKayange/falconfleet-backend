BEGIN;
CREATE TABLE IF NOT EXISTS workspace_records (
 school_id text NOT NULL,
 collection text NOT NULL,
 id text NOT NULL,
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (school_id, collection, id)
);
CREATE INDEX IF NOT EXISTS workspace_records_collection ON workspace_records (school_id, collection, created_at DESC);
CREATE TABLE IF NOT EXISTS workspace_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 school_id text NOT NULL,
 collection text NOT NULL,
 record_id text NOT NULL,
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
