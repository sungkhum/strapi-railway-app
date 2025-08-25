'use strict';

/**
 * This migration creates a PostgreSQL function to normalize Khmer text for searching
 * by removing zero-width space characters (U+200B)
 */
async function up(knex) {
  // Create the normalize_khmer_search function
  return knex.raw(`
    CREATE OR REPLACE FUNCTION normalize_khmer_search(input_text TEXT) 
    RETURNS TEXT AS $$
    BEGIN
      -- Check for null input
      IF input_text IS NULL THEN
        RETURN NULL;
      END IF;
      
      -- Remove all zero-width spaces (U+200B)
      RETURN REPLACE(input_text, U&'\\200B', '');
    END;
    $$ LANGUAGE plpgsql;
  `);
}

/**
 * Function to revert the migration
 */
async function down(knex) {
  // Drop the function if it exists
  return knex.raw(`
    DROP FUNCTION IF EXISTS normalize_khmer_search(TEXT);
  `);
}

module.exports = { up, down };