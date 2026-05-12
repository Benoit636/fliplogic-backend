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
// ========================================
// APPRAISALS ENDPOINTS (Placeholder - returns mock data)
// TODO: Replace with real valuation engine
// ========================================

// In-memory storage for demo (resets on server restart)
const appraisalsStore = new Map();

// Helper: generate a fake but realistic appraisal
function generateMockAppraisal(vin, conditionData) {
  const retailValue = 18000 + Math.floor(Math.random() * 15000);
  const wholesaleValue = Math.floor(retailValue * 0.82);
  const margin = retailValue - wholesaleValue;
  const marginPercent = (margin / wholesaleValue) * 100;

  let rating = 'red';
  let ratingLabel = 'Break-even';
  if (marginPercent >= 12) {
    rating = 'green';
    ratingLabel = 'Strong profit opportunity';
  } else if (marginPercent >= 6) {
    rating = 'yellow';
    ratingLabel = 'Moderate profit potential';
  }

  return {
    vin,
    wholesaleValue,
    retailValue,
    margin,
    marginPercent: marginPercent.toFixed(1),
    rating,
    ratingLabel,
    confidence: 0.75,
    comparablesCount: Math.floor(Math.random() * 20) + 5,
    conditionScore: 7.5,
    conditionData,
    createdAt: new Date().toISOString(),
    note: 'PLACEHOLDER DATA - Real valuation engine coming soon'
  };
}

// POST /api/appraisals - Create new appraisal
app.post('/api/appraisals', async (req, res) => {
  try {
    const { vin, ...conditionData } = req.body;

    if (!vin) {
      return res.status(400).json({ error: 'VIN is required' });
    }

    const appraisalId = 'appraisal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const appraisal = generateMockAppraisal(vin, conditionData);
    appraisal.id = appraisalId;

    appraisalsStore.set(appraisalId, appraisal);

    res.json({ appraisalId, status: 'created' });
  } catch (err) {
    console.error('Create appraisal error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/appraisals/:id/analyze - Trigger analysis
app.post('/api/appraisals/:id/analyze', async (req, res) => {
  try {
    const { id } = req.params;
    const appraisal = appraisalsStore.get(id);

    if (!appraisal) {
      return res.status(404).json({ error: 'Appraisal not found' });
    }

    appraisal.status = 'analyzed';
    appraisalsStore.set(id, appraisal);

    res.json({ status: 'analyzed', appraisalId: id });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/appraisals/:id - Fetch appraisal results
app.get('/api/appraisals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const appraisal = appraisalsStore.get(id);

    if (!appraisal) {
      return res.status(404).json({ error: 'Appraisal not found' });
    }

    res.json({
      appraisal: {
        id: appraisal.id,
        vin: appraisal.vin,
        createdAt: appraisal.createdAt,
        conditionData: appraisal.conditionData
      },
      pricingStrategy: {
        wholesaleValue: appraisal.wholesaleValue,
        retailValue: appraisal.retailValue,
        margin: appraisal.margin,
        marginPercent: appraisal.marginPercent,
        rating: appraisal.rating,
        ratingLabel: appraisal.ratingLabel
      },
      analysis: {
        confidence: appraisal.confidence,
        comparablesCount: appraisal.comparablesCount,
        conditionScore: appraisal.conditionScore,
        note: appraisal.note
      }
    });
  } catch (err) {
    console.error('Get appraisal error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
console.log(`FlipLogic API running on port ${PORT}`);
});
