'use strict';

/**
 * This migration enables the pg_trgm extension and creates GIN indexes
 * on the normalized Khmer text columns for faster ILIKE searches.
 *
 * If pg_trgm is not available on the host (e.g. Railway), the migration
 * logs a warning and completes successfully without creating indexes.
 */
async function up(knex) {
  if (process.env.ENABLE_KHMER_SEARCH !== 'true') return;

  try {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  } catch (err) {
    console.warn(
      '[migration] pg_trgm extension is not available on this database. ' +
      'Khmer search will still work but without trigram indexes. ' +
      'Error:', err.message
    );
    return;
  }

  try {
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
      '[migration] Failed to create trigram indexes. ' +
      'Khmer search will still work but without index optimization. ' +
      'Error:', err.message
    );
  }
}

async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_resources_khmer_description_trgm;');
  await knex.raw('DROP INDEX IF EXISTS idx_resources_khmer_title_trgm;');
}

module.exports = { up, down };
