'use strict';

module.exports = {
  async khmerSearch(ctx) {
    try {
      const { search } = ctx.query;

      if (!search) {
        return { data: [], meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } } };
      }

      const knex = strapi.db.connection;
      const tableName = 'resources';

      const page = parseInt(ctx.query.page) || 1;
      const pageSize = parseInt(ctx.query.pageSize) || 25;
      const start = (page - 1) * pageSize;

      // Remove zero-width spaces for phrase search
      const searchNoZWS = search.replace(/\u200B/g, '');

      const phraseSqlQuery = `
        SELECT id, document_id FROM "${tableName}"
        WHERE (
          normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
          OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?)
        )
        AND published_at IS NOT NULL
        LIMIT ? OFFSET ?
      `;

      const phraseResults = await knex.raw(
        phraseSqlQuery,
        [`%${searchNoZWS}%`, `%${searchNoZWS}%`, pageSize, start]
      );

      let documentIds = phraseResults.rows.map(row => row.document_id);
      let total = 0;

      if (documentIds.length > 0) {
        const countResult = await knex.raw(
          `SELECT COUNT(*) FROM "${tableName}"
           WHERE (
             normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
             OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?)
           )
           AND published_at IS NOT NULL`,
          [`%${searchNoZWS}%`, `%${searchNoZWS}%`]
        );
        total = parseInt(countResult.rows[0].count);
      } else {
        // Treat zero-width spaces as word separators and search for each word
        const searchTerms = search.split(/[\s\u200B]+/).filter(term => term.length > 0);

        if (searchTerms.length > 0) {
          let queryConditions = searchTerms.map(() => {
            return `(normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
                    OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?))`;
          }).join(' AND ');

          let searchParams = [];
          searchTerms.forEach(term => {
            searchParams.push(`%${term}%`);
            searchParams.push(`%${term}%`);
          });

          searchParams.push(pageSize);
          searchParams.push(start);

          const wordSqlQuery = `
            SELECT id, document_id FROM "${tableName}"
            WHERE ${queryConditions}
            AND published_at IS NOT NULL
            LIMIT ? OFFSET ?
          `;

          const wordResults = await knex.raw(wordSqlQuery, searchParams);
          documentIds = wordResults.rows.map(row => row.document_id);

          if (documentIds.length > 0) {
            let countParams = searchParams.slice(0, -2);
            const countQuery = `
              SELECT COUNT(*) FROM "${tableName}"
              WHERE ${queryConditions}
              AND published_at IS NOT NULL
            `;

            const countResult = await knex.raw(countQuery, countParams);
            total = parseInt(countResult.rows[0].count);
          }
        }
      }

      // Third attempt: auto-segmentation using Intl.Segmenter for Khmer
      if (documentIds.length === 0) {
        let segmentedTerms = [];
        try {
          const segmenter = new Intl.Segmenter('km', { granularity: 'word' });
          segmentedTerms = Array.from(segmenter.segment(search))
            .map(segment => segment.segment)
            .filter(Boolean);
        } catch (err) {
          strapi.log.error('Intl.Segmenter failed for Khmer segmentation', err);
        }

        if (segmentedTerms.length > 0) {
          let queryConditions = segmentedTerms.map(() => {
            return `(normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
                    OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?))`;
          }).join(' AND ');

          let searchParams = [];
          segmentedTerms.forEach(term => {
            searchParams.push(`%${term}%`);
            searchParams.push(`%${term}%`);
          });

          searchParams.push(pageSize);
          searchParams.push(start);

          const segmentedSqlQuery = `
            SELECT id, document_id FROM "${tableName}"
            WHERE ${queryConditions}
            AND published_at IS NOT NULL
            LIMIT ? OFFSET ?
          `;

          const segmentedResults = await knex.raw(segmentedSqlQuery, searchParams);
          documentIds = segmentedResults.rows.map(row => row.document_id);

          if (documentIds.length > 0) {
            let countParams = searchParams.slice(0, -2);
            const countQuery = `
              SELECT COUNT(*) FROM "${tableName}"
              WHERE ${queryConditions}
              AND published_at IS NOT NULL
            `;
            const countResult = await knex.raw(countQuery, countParams);
            total = parseInt(countResult.rows[0].count);
          }
        }
      }

      if (documentIds.length === 0) {
        return {
          data: [],
          meta: {
            pagination: {
              page,
              pageSize,
              pageCount: 0,
              total: 0
            }
          }
        };
      }

      // Use Strapi's Document Service API to get complete data
      const fullResults = await strapi.documents('api::resource.resource').findMany({
        filters: {
          documentId: {
            $in: documentIds
          }
        },
        status: 'published',
        populate: {
          FeaturedImage: true,
          eBook: true,
          authors: { fields: ['Name', 'slug'] },
          categories: { fields: ['EnglishName', 'KhmerName', 'slug'] },
          publishers: { fields: ['EnglishName', 'KhmerName', 'slug'] },
          type: { fields: ['EnglishName', 'KhmerName', 'slug'] },
        },
      });

      // Helper function to sanitize user objects
      const sanitizeUser = (user) => {
        if (!user) return null;
        return {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname
        };
      };

      // Recursively sanitize sensitive fields from response data
      const sanitizeData = (data) => {
        if (!data) return null;
        if (Array.isArray(data)) {
          return data.map(item => sanitizeData(item));
        }
        if (typeof data === 'object') {
          const result = {};
          for (const [key, value] of Object.entries(data)) {
            if (['password', 'resetPasswordToken', 'registrationToken', 'email'].includes(key)) {
              continue;
            }
            if (key === 'createdBy' || key === 'updatedBy') {
              result[key] = sanitizeUser(value);
              continue;
            }
            result[key] = sanitizeData(value);
          }
          return result;
        }
        return data;
      };

      // Sanitize and preserve the original order from the SQL query
      const sanitizedResults = sanitizeData(fullResults);
      const orderedResults = [];
      for (const docId of documentIds) {
        const matchingResource = sanitizedResults.find(r => r.documentId === docId);
        if (matchingResource) {
          orderedResults.push(matchingResource);
        }
      }

      return {
        data: orderedResults,
        meta: {
          pagination: {
            page,
            pageSize,
            pageCount: Math.ceil(total / pageSize),
            total
          }
        }
      };
    } catch (error) {
      strapi.log.error('Khmer search error:', error);
      ctx.throw(500, 'Error performing Khmer search');
    }
  }
};
