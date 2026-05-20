const express = require('express');
const app = express();
const PORT = 4000;

app.use(express.json({ limit: '10mb' }));

const alerts = [];

app.post('/api/alerts', (req, res) => {
  const alert = req.body;
  const time = new Date().toLocaleTimeString();

  alerts.push({ ...alert, receivedAt: new Date().toISOString() });

  console.log('\n' + '='.repeat(60));
  console.log(`ALERT RECEIVED at ${time}`);
  console.log(`   Type:       ${alert.alertType}`);
  console.log(`   Severity:   ${alert.severity}`);
  console.log(`   Camera:     ${alert.cameraId}`);
  console.log(`   Alert ID:   ${alert.alertId}`);
  console.log(`   Confidence: ${JSON.stringify(alert.confidence)}`);
  console.log(`   Metadata:   ${JSON.stringify(alert.metadata)}`);
  console.log(`   Snapshot:   ${alert.snapshot ? 'YES (' + Math.round(alert.snapshot.length / 1024) + ' KB)' : 'NO'}`);
  console.log(`   Total alerts received: ${alerts.length}`);
  console.log('='.repeat(60));

  res.json({
    success: true,
    message: 'Alert received and logged',
    alertId: alert.alertId,
    totalAlerts: alerts.length,
  });
});

app.get('/api/alerts', (req, res) => {
  res.json({ total: alerts.length, alerts });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', totalAlerts: alerts.length });
});

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('  Test Alert API - Ready');
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  POST endpoint: http://localhost:${PORT}/api/alerts`);
  console.log(`  GET  all alerts: http://localhost:${PORT}/api/alerts`);
  console.log('='.repeat(60));
  console.log('\nWaiting for alerts...\n');
});
