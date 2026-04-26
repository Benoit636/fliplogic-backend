import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());

app.use(cors({
origin: process.env.FRONTEND_URL || 'http://localhost:3001',
credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(morgan('combined'));

const limiter = rateLimit({
windowMs: 15 * 60 * 1000,
max: 100,
message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

export const pool = new Pool({
connectionString: process.env.DATABASE_URL,
});

try {
const result = await pool.query('SELECT NOW()');
console.log('Database connected:', result.rows[0]);
} catch (err) {
console.error('Database connection failed:', err);
process.exit(1);
}

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);

app.use((req, res) => {
res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
console.error('Error:', err);
res.status(err.status || 500).json({
error: err.message || 'Internal server error',
});
});

app.listen(PORT, () => {
console.log(`FlipLogic API running on port ${PORT}`);
});

export default app;
