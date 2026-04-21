# FlipLogic API — Backend

Production-ready Express.js backend for the FlipLogic vehicle appraisal platform.

## Quick Start

### Prerequisites

- **Node.js 18+**
- **PostgreSQL 12+**
- **Redis** (for caching and job queues)
- Environment variables (.env file)

### Installation

1. **Clone and install:**
```bash
git clone <repo-url>
cd fliplogic-backend
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your API keys and database credentials
```

3. **Create database schema:**
```bash
# Log into PostgreSQL
psql -U postgres -d fliplogic_dev

# Run schema.sql
\i src/db/schema.sql
```

4. **Start development server:**
```bash
npm run dev
```

Server will be available at `http://localhost:3000`

---

## API Endpoints

### Authentication
- `POST /api/auth/login` — OAuth login via Firebase
- `POST /api/auth/logout` — Logout

### Appraisals
- `POST /api/appraisals` — Create new appraisal
- `POST /api/appraisals/:id/analyze` — Trigger appraisal analysis
- `GET /api/appraisals/:id` — Get appraisal details
- `GET /api/appraisals` — List user's appraisals

### Listings
- `POST /api/listings` — Create listing from appraisal
- `GET /api/listings` — List user's listings
- `GET /api/listings/:id` — Get listing details
- `POST /api/listings/:id/send-seller-email` — Send appraisal email to seller
- `PATCH /api/listings/:id` — Update listing status

### Users
- `GET /api/users/me` — Get current user profile
- `PATCH /api/users/me` — Update user profile
- `GET /api/users/stats` — Get user statistics

### Subscriptions
- `GET /api/subscriptions/status` — Check subscription status
- `POST /api/subscriptions/upgrade` — Upgrade subscription
- `POST /api/subscriptions/cancel` — Cancel subscription
- `POST /api/subscriptions/webhook` — Stripe webhook handler

### Health
- `GET /api/health` — Health check

---

## Architecture

```
fliplogic-backend/
├── src/
│   ├── server.js              # Express app entry point
│   ├── config/
│   │   └── logger.js          # Winston logging setup
│   ├── db/
│   │   └── schema.sql         # PostgreSQL schema
│   ├── middleware/
│   │   └── auth.js            # JWT authentication
│   ├── routes/                # API endpoints
│   │   ├── auth.js
│   │   ├── appraisals.js
│   │   ├── listings.js
│   │   ├── users.js
│   │   ├── subscriptions.js
│   │   └── health.js
│   ├── scrapers/
│   │   └── autotrader.js      # AutoTrader scraper (Puppeteer)
│   └── services/
│       ├── email.js           # SendGrid email
│       └── openai.js          # OpenAI integration
├── logs/
│   ├── error.log
│   └── combined.log
├── package.json
├── .env.example
└── README.md
```

---

## Key Technologies

- **Express.js** — Web framework
- **PostgreSQL** — Primary database
- **Redis** — Caching & job queue
- **Puppeteer** — Web scraping
- **OpenAI API** — Photo analysis & vehicle valuation
- **Stripe** — Payment processing
- **SendGrid** — Email delivery
- **Firebase** — Authentication
- **Winston** — Logging

---

## Development

### Run in development mode (with hot reload):
```bash
npm run dev
```

### Run tests:
```bash
npm test
```

### Database migrations:
```bash
npm run migrate
```

---

## Deployment

### Environment Variables
Before deploying, ensure all required env vars are set:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `OPENAI_API_KEY` — OpenAI API key
- `STRIPE_SECRET_KEY` — Stripe secret key
- `SENDGRID_API_KEY` — SendGrid API key
- `JWT_SECRET` — Long random string for JWT signing
- `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`

### Docker Deployment
```bash
docker build -t fliplogic-api .
docker run -p 3000:3000 --env-file .env fliplogic-api
```

### Kubernetes Deployment
```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

### Railway Deployment (Recommended for MVP)
```bash
railway login
railway link <project-id>
railway up
```

---

## Monitoring

- **Logs:** Check `logs/` directory or use CloudWatch
- **Performance:** DataDog or New Relic
- **Errors:** Sentry integration
- **Uptime:** UptimeRobot monitoring

---

## Scraping Configuration

### AutoTrader.ca
- Uses Puppeteer for JavaScript rendering
- Respects robots.txt and adds delays
- Caches results for 1 hour in Redis
- Retries up to 3 times with exponential backoff

### Other Platforms (TODO)
- Kijiji
- Facebook Marketplace
- Carfax / AutoCheck
- Manheim / Copart
- CarGurus
- Dealer websites

---

## Common Issues

### Database Connection Error
```
Error: ECONNREFUSED 127.0.0.1:5432
```
**Solution:** Ensure PostgreSQL is running and DATABASE_URL is correct.

### Redis Connection Error
```
Error: Redis connection failed
```
**Solution:** Start Redis server or update REDIS_URL.

### API Key Errors
```
Error: Invalid OpenAI API key
```
**Solution:** Verify OPENAI_API_KEY is set and valid in .env

---

## Support

For issues or questions, contact: benoit@fliplogic.com

---

## License

MIT License © 2026 FlipLogic
