import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors({
origin: process.env.FRONTEND_URL || '*',
credentials: true,
}));

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
res.json({ status: 'ok', message: 'FlipLogic API running' });
});

// Register
app.post('/api/auth/register', async (req, res) => {
try {
const { email, password, firstName, lastName, dealershipName } = req.body;

// Create users table if it doesn't exist
await pool.query(`
CREATE TABLE IF NOT EXISTS users (
id SERIAL PRIMARY KEY,
email VARCHAR(255) UNIQUE NOT NULL,
password VARCHAR(255) NOT NULL,
first_name VARCHAR(255),
last_name VARCHAR(255),
dealership_name VARCHAR(255),
created_at TIMESTAMP DEFAULT NOW()
)
`);

// Check if user exists
const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
if (existing.rows.length > 0) {
return res.status(400).json({ error: 'Email already registered' });
}

// Hash password
const hashedPassword = await bcrypt.hash(password, 10);

// Create user
const result = await pool.query(
'INSERT INTO users (email, password, first_name, last_name, dealership_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, first_name, last_name, dealership_name',
[email, hashedPassword, firstName, lastName, dealershipName]
);

const user = result.rows[0];
const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'fliplogic-secret', { expiresIn: '7d' });

res.json({ token, user });
} catch (err) {
console.error('Register error:', err);
res.status(500).json({ error: err.message });
}
});

// Login
app.post('/api/auth/login', async (req, res) => {
try {
const { email, password } = req.body;

const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
if (result.rows.length === 0) {
return res.status(401).json({ error: 'Invalid email or password' });
}

const user = result.rows[0];
const valid = await bcrypt.compare(password, user.password);
if (!valid) {
return res.status(401).json({ error: 'Invalid email or password' });
}

const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'fliplogic-secret', { expiresIn: '7d' });

res.json({ token, user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, dealershipName: user.dealership_name } });
} catch (err) {
console.error('Login error:', err);
res.status(500).json({ error: err.message });
}
});

app.listen(PORT, () => {
console.log(`FlipLogic API running on port ${PORT}`);
});
