CREATE TABLE IF NOT EXISTS falconfleet_identity (
  id integer PRIMARY KEY CHECK (id=1),
  data jsonb NOT NULL
);
