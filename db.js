const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const SALT_ROUNDS = 10;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});

const db = {
    async init() {
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS characters (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(32) UNIQUE NOT NULL,
                    faceclaim VARCHAR(100) NOT NULL,
                    image TEXT NOT NULL,
                    bio TEXT NOT NULL,
                    password TEXT NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_characters_name 
                ON characters(name)
            `);

            console.log('✓ Database initialized successfully');
        } catch (error) {
            console.error('Database initialization error:', error);
            throw error;
        } finally {
            client.release();
        }
    },

    async createCharacter({ name, faceclaim, image, bio, password }) {
        const client = await pool.connect();
        try {
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

            const query = `
                INSERT INTO characters (name, faceclaim, image, bio, password)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, name, faceclaim, image, bio, created_at
            `;
            const values = [name.toLowerCase(), faceclaim, image, bio, hashedPassword];
            const result = await client.query(query, values);
            return result.rows[0];
        } catch (error) {
            if (error.code === '23505') { // Unique violation
                throw new Error(`Character name "${name}" is already taken`);
            }
            throw error;
        } finally {
            client.release();
        }
    },

    async deleteCharacter(name, password) {
        const client = await pool.connect();
        try {
            const getChar = await client.query(
                'SELECT password FROM characters WHERE name = $1',
                [name.toLowerCase()]
            );

            if (!getChar.rows[0]) return null;

            const isAdmin = password === process.env.ADMIN_PASSWORD;
            const isValidPassword = isAdmin || 
                await bcrypt.compare(password, getChar.rows[0].password);

            if (!isValidPassword) return null;

            const query = `
                DELETE FROM characters
                WHERE name = $1
                RETURNING id, name, faceclaim, image, bio
            `;
            const result = await client.query(query, [name.toLowerCase()]);
            return result.rows[0];
        } finally {
            client.release();
        }
    },

    async editCharacter({ name, faceclaim, image, bio, password }) {
        const client = await pool.connect();
        try {
            const getChar = await client.query(
                'SELECT password FROM characters WHERE name = $1',
                [name.toLowerCase()]
            );

            if (!getChar.rows[0]) return null;

            const isAdmin = password === process.env.ADMIN_PASSWORD;
            const isValidPassword = isAdmin || 
                await bcrypt.compare(password, getChar.rows[0].password);

            if (!isValidPassword) return null;

            const updates = [];
            const values = [name.toLowerCase()];
            let valueCount = 2;

            if (faceclaim) {
                updates.push(`faceclaim = $${valueCount}`);
                values.push(faceclaim);
                valueCount++;
            }
            if (image) {
                updates.push(`image = $${valueCount}`);
                values.push(image);
                valueCount++;
            }
            if (bio) {
                updates.push(`bio = $${valueCount}`);
                values.push(bio);
                valueCount++;
            }
            updates.push(`updated_at = CURRENT_TIMESTAMP`);

            const query = `
                UPDATE characters
                SET ${updates.join(', ')}
                WHERE name = $1
                RETURNING id, name, faceclaim, image, bio, updated_at
            `;
            const result = await client.query(query, values);
            return result.rows[0];
        } finally {
            client.release();
        }
    },

    async getCharacter(name) {
        const client = await pool.connect();
        try {
            const query = `
                SELECT id, name, faceclaim, image, bio, created_at, updated_at
                FROM characters 
                WHERE name = $1
            `;
            const result = await client.query(query, [name.toLowerCase()]);
            return result.rows[0];
        } finally {
            client.release();
        }
    },

    async getAllCharacters() {
        const client = await pool.connect();
        try {
            const query = `
                SELECT id, name, faceclaim, image, bio, created_at, updated_at
                FROM characters 
                ORDER BY name
            `;
            const result = await client.query(query);
            return result.rows;
        } finally {
            client.release();
        }
    },

    async searchCharacters(searchTerm) {
        const client = await pool.connect();
        try {
            const query = `
                SELECT name
                FROM characters
                WHERE name ILIKE $1
                ORDER BY name
                LIMIT 25
            `;
            const result = await client.query(query, [`%${searchTerm.toLowerCase()}%`]);
            return result.rows;
        } finally {
            client.release();
        }
    }
};

module.exports = db;