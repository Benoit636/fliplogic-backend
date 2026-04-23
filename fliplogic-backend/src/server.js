const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
res.json({ status: 'ok', message: 'FlipLogic API running!' });
});

app.listen(PORT, () => {
console.log(`FlipLogic API running on port ${PORT}`);
});

module.exports = app;
