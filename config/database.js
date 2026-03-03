module.exports = ({ env }) => ({
    connection: {
        client: 'postgres',
        connection: {
            connectionString: env('DATABASE_URL')
        },
        debug: env.bool('DATABASE_DEBUG', false),
        pool: { min: 0, max: 7 },
    }
});