// The Cloud Infrastructure Architect — web server.
// Serves the SPA from /public and exposes /api/design and /api/regions.

require('dotenv').config();

const express = require('express');
const path = require('path');

const { listRegions } = require('./lib/catalog');
const { design } = require('./lib/architect');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/regions', (_req, res) => {
  res.json({ regions: listRegions() });
});

app.post('/api/design', async (req, res) => {
  const { brief, region, compliance } = req.body || {};
  if (!brief || !region) {
    return res.status(400).json({ error: 'brief and region are required' });
  }
  try {
    const result = await design({
      brief: String(brief),
      regionCode: String(region),
      additionalCompliance: Array.isArray(compliance) ? compliance : [],
    });
    res.json(result);
  } catch (err) {
    console.error('[design] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`☁️  Cloud Infrastructure Architect running at http://localhost:${PORT}`);
});
