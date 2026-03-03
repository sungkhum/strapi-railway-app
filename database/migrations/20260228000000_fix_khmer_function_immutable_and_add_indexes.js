'use strict';

/**
 * Re-creates normalize_khmer_search() as IMMUTABLE so it can be used
 * in index expressions, then attempts to create pg_trgm GIN indexes.
 * Index creation fails gracefully if pg_trgm is not available.
 */
async function up(knex) {
  if (process.env.ENABLE_KHMER_SEARCH !== 'true') return;

  // Re-create the function with IMMUTABLE volatility
  await knex.raw(`
    CREATE OR REPLACE FUNCTION normalize_khmer_search(input_text TEXT)
    RETURNS TEXT AS $$
    BEGIN
      IF input_text IS NULL THEN
        RETURN NULL;
      END IF;
      RETURN REPLACE(input_text, U&'\\200B', '');
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  // Attempt to create trigram indexes — fails gracefully if pg_trgm is unavailable
  try {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_resources_khmer_title_trgm
      ON resources USING GIN (normalize_khmer_search(khmer_title) gin_trgm_ops);
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_resources_khmer_description_trgm
      ON resources USING GIN (normalize_khmer_search(khmer_description) gin_trgm_ops);
    `);
  } catch (err) {
    console.warn(
      '[migration] Could not create trigram indexes. ' +
      'Khmer search will still work but without index optimization. ' +
      'Error:', err.message
    );
  }
}

async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_resources_khmer_description_trgm;');
  await knex.raw('DROP INDEX IF EXISTS idx_resources_khmer_title_trgm;');

  await knex.raw(`
    CREATE OR REPLACE FUNCTION normalize_khmer_search(input_text TEXT)
    RETURNS TEXT AS $$
    BEGIN
      IF input_text IS NULL THEN
        RETURN NULL;
      END IF;
      RETURN REPLACE(input_text, U&'\\200B', '');
    END;
    $$ LANGUAGE plpgsql;
  `);
}

module.exports = { up, down };
