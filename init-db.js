const db = require('./db');

async function initializeDatabase() {
    try {
        await db.init();
        console.log('Database initialization complete!');
    } catch (error) {
        console.error('Failed to initialize database:', error);
    } finally {
        process.exit();
    }
}

initializeDatabase();