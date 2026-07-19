import postgres from "postgres";

export async function applyCheckpointSecurity(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundry_checkpoint_migrator') THEN CREATE ROLE foundry_checkpoint_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundry_checkpoint_runtime') THEN CREATE ROLE foundry_checkpoint_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
      END $$;

      REVOKE ALL ON SCHEMA langgraph_checkpoint FROM PUBLIC;
      REVOKE ALL ON ALL TABLES IN SCHEMA langgraph_checkpoint FROM PUBLIC;
      GRANT USAGE ON SCHEMA langgraph_checkpoint TO foundry_checkpoint_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        langgraph_checkpoint.checkpoints,
        langgraph_checkpoint.checkpoint_blobs,
        langgraph_checkpoint.checkpoint_writes
      TO foundry_checkpoint_runtime;
      GRANT SELECT ON langgraph_checkpoint.checkpoint_migrations TO foundry_checkpoint_runtime;

      CREATE SCHEMA IF NOT EXISTS foundry_checkpoint_private;
      REVOKE ALL ON SCHEMA foundry_checkpoint_private FROM PUBLIC;
      GRANT USAGE ON SCHEMA foundry_checkpoint_private TO foundry_checkpoint_runtime;
      CREATE OR REPLACE FUNCTION foundry_checkpoint_private.current_institution_id() RETURNS uuid
      LANGUAGE sql STABLE PARALLEL SAFE AS $$
        SELECT NULLIF(current_setting('foundry.institution_id', true), '')::uuid
      $$;
      REVOKE ALL ON FUNCTION foundry_checkpoint_private.current_institution_id() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION foundry_checkpoint_private.current_institution_id() TO foundry_checkpoint_runtime;

      ALTER TABLE langgraph_checkpoint.checkpoints ENABLE ROW LEVEL SECURITY;
      ALTER TABLE langgraph_checkpoint.checkpoints FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS checkpoint_tenant_scope ON langgraph_checkpoint.checkpoints;
      CREATE POLICY checkpoint_tenant_scope ON langgraph_checkpoint.checkpoints TO foundry_checkpoint_runtime
        USING (thread_id LIKE foundry_checkpoint_private.current_institution_id()::text || ':%')
        WITH CHECK (thread_id LIKE foundry_checkpoint_private.current_institution_id()::text || ':%');

      ALTER TABLE langgraph_checkpoint.checkpoint_blobs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE langgraph_checkpoint.checkpoint_blobs FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS checkpoint_blob_tenant_scope ON langgraph_checkpoint.checkpoint_blobs;
      CREATE POLICY checkpoint_blob_tenant_scope ON langgraph_checkpoint.checkpoint_blobs TO foundry_checkpoint_runtime
        USING (thread_id LIKE foundry_checkpoint_private.current_institution_id()::text || ':%')
        WITH CHECK (thread_id LIKE foundry_checkpoint_private.current_institution_id()::text || ':%');

      ALTER TABLE langgraph_checkpoint.checkpoint_writes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE langgraph_checkpoint.checkpoint_writes FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS checkpoint_write_tenant_scope ON langgraph_checkpoint.checkpoint_writes;
      CREATE POLICY checkpoint_write_tenant_scope ON langgraph_checkpoint.checkpoint_writes TO foundry_checkpoint_runtime
        USING (thread_id LIKE foundry_checkpoint_private.current_institution_id()::text || ':%')
        WITH CHECK (thread_id LIKE foundry_checkpoint_private.current_institution_id()::text || ':%');
    `);
  } finally {
    await sql.end();
  }
}
