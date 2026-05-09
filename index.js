const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();

// ============================================================
// CONFIG — fill these in Railway environment variables
// ============================================================
const CONFIG = {
  VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'dmoon_giveaway_2026',
  FB_PAGE_ACCESS_TOKEN: process.env.FB_PAGE_ACCESS_TOKEN || '',
  IG_ACCESS_TOKEN: process.env.IG_ACCESS_TOKEN || '',
  IG_BUSINESS_ACCOUNT_ID: process.env.IG_BUSINESS_ACCOUNT_ID || '17841411697514213',
  FB_PAGE_ID: process.env.FB_PAGE_ID || '297209906812982',
  WEBSITE_LINK: 'https://www.dmoonadvertising.com',
};

// In-memory store for winners (persists while server runs)
const winners = [];
const processedComments = new Set();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// GENERATE UNIQUE CODE
// ============================================================
function generateCode(username) {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `EID-${rand}`;
}

// Save generated code to Google Sheet ValidCodes tab
async function saveValidCode(code, username, platform) {
  try {
    // Google Apps Script requires form-encoded POST with redirect following
    const params = new URLSearchParams();
    params.append('action', 'saveValidCode');
    params.append('code', code);
    params.append('username', username);
    params.append('platform', platform);
    params.append('created_at', new Date().toISOString());

    // Use GET with query params as fallback — Apps Script handles both
    const url = CONFIG.GOOGLE_SCRIPT_URL +
      '?action=saveValidCode' +
      '&code=' + encodeURIComponent(code) +
      '&username=' + encodeURIComponent(username) +
      '&platform=' + encodeURIComponent(platform);

    await axios.get(url, { maxRedirects: 5 });
    console.log(`[CODE] Saved valid code ${code} for ${username} to sheet`);
  } catch (err) {
    console.error('[CODE] Failed to save valid code:', err.message);
  }
}

// ============================================================
// BUILD DM MESSAGE
// ============================================================
function buildDMMessage(username, code) {
  return `🎉 Congratulations ${username}!

You've been selected as a participant in the D Moon Eid Special Giveaway! 🌙

🎁 Your Unique Code: *${code}*

👉 Click this link to claim your personalized coupon:
https://dmoon-giveaway-production.up.railway.app/giveaway

Simply enter your unique code on the page and fill in your details to generate and download your official coupon!

Winner announcement: 24 May 2026 🗓️

— D Moon Advertising Team`;
}

// ============================================================
// SEND INSTAGRAM DM
// ============================================================
async function sendInstagramDM(igUserId, message) {
  try {
    const url = `https://graph.facebook.com/v19.0/${CONFIG.IG_BUSINESS_ACCOUNT_ID}/messages`;
    await axios.post(url, {
      recipient: { id: igUserId },
      message: { text: message },
    }, {
      params: { access_token: CONFIG.IG_ACCESS_TOKEN }
    });
    return true;
  } catch (err) {
    console.error('IG DM error:', err.response?.data || err.message);
    return false;
  }
}

// ============================================================
// SEND FACEBOOK DM
// ============================================================
async function sendFacebookDM(fbUserId, message) {
  try {
    const url = `https://graph.facebook.com/v19.0/me/messages`;
    await axios.post(url, {
      recipient: { id: fbUserId },
      message: { text: message },
    }, {
      params: { access_token: CONFIG.FB_PAGE_ACCESS_TOKEN }
    });
    return true;
  } catch (err) {
    console.error('FB DM error:', err.response?.data || err.message);
    return false;
  }
}

// ============================================================
// CHECK IF COMMENT CONTAINS GIFT (case-insensitive)
// ============================================================
function isGiftComment(text) {
  if (!text) return false;
  return /dmoon\s*gift/i.test(text.trim());
}

// ============================================================
// WEBHOOK VERIFICATION (GET)
// ============================================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === CONFIG.VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================================================
// WEBHOOK EVENTS (POST)
// ============================================================
app.post('/webhook', async (req, res) => {
  const body = req.body;
  res.sendStatus(200); // Always respond fast

  // ---- INSTAGRAM COMMENTS ----
  if (body.object === 'instagram') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'comments') {
          const commentData = change.value;
          const commentId = commentData.id;
          const text = commentData.text;
          const fromId = commentData.from?.id;
          const fromUsername = commentData.from?.username || 'Unknown';

          if (!commentId || processedComments.has(commentId)) continue;
          if (!isGiftComment(text)) continue;

          processedComments.add(commentId);
          const code = generateCode(fromUsername);
          await saveValidCode(code, '@' + fromUsername, 'Instagram');
          const message = buildDMMessage('@' + fromUsername, code);

          console.log(`[IG] Gift comment from @${fromUsername} — sending DM with code ${code}`);
          const sent = await sendInstagramDM(fromId, message);

          winners.push({
            id: Date.now(),
            platform: 'Instagram',
            username: '@' + fromUsername,
            userId: fromId,
            code,
            comment: text,
            dmSent: sent,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  // ---- FACEBOOK COMMENTS ----
  if (body.object === 'page') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'feed' && change.value?.item === 'comment') {
          const commentData = change.value;
          const commentId = commentData.comment_id;
          const text = commentData.message;
          const fromId = commentData.from?.id;
          const fromName = commentData.from?.name || 'Unknown';

          if (!commentId || processedComments.has(commentId)) continue;
          if (!isGiftComment(text)) continue;

          processedComments.add(commentId);
          const code = generateCode(fromName);
          await saveValidCode(code, fromName, 'Facebook');
          const message = buildDMMessage(fromName, code);

          console.log(`[FB] Gift comment from ${fromName} — sending DM with code ${code}`);
          const sent = await sendFacebookDM(fromId, message);

          winners.push({
            id: Date.now(),
            platform: 'Facebook',
            username: fromName,
            userId: fromId,
            code,
            comment: text,
            dmSent: sent,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }
});

// ============================================================
// DASHBOARD
// ============================================================
app.get('/', (req, res) => {
  const rows = winners.map(w => {
    const profileUrl = w.platform === 'Instagram'
      ? `https://instagram.com/${w.username.replace('@', '')}`
      : `https://facebook.com/${w.userId}`;
    return `
    <tr>
      <td>${w.platform === 'Instagram' ? '📸' : '📘'} ${w.platform}</td>
      <td>
        <a href="${profileUrl}" target="_blank" style="color:#38bdf8;text-decoration:none;font-weight:700;display:flex;align-items:center;gap:6px;">
          ${w.username}
          <span style="font-size:11px;opacity:0.6">↗</span>
        </a>
      </td>
      <td><code>${w.code}</code></td>
      <td>${w.comment}</td>
      <td>${w.dmSent ? '✅ Sent' : '❌ Failed'}</td>
      <td style="font-size:12px">${new Date(w.timestamp).toLocaleString('en-IN')}</td>
      <td>
        <button onclick="copyDM('${w.username}','${w.code}')" style="background:#2563eb;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px">
          📋 Copy DM
        </button>
      </td>
    </tr>
  `}).join('');

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>D Moon Giveaway Dashboard</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    header { background: linear-gradient(135deg, #1e3a5f, #0ea5e9); padding: 24px 32px; display: flex; align-items: center; gap: 16px; }
    header h1 { font-size: 24px; font-weight: 700; }
    header p { font-size: 14px; opacity: 0.8; margin-top: 4px; }
    .moon { font-size: 36px; }
    .stats { display: flex; gap: 16px; padding: 24px 32px; flex-wrap: wrap; }
    .stat { background: #1e293b; border-radius: 12px; padding: 20px 28px; flex: 1; min-width: 160px; border: 1px solid #334155; }
    .stat-num { font-size: 36px; font-weight: 800; color: #0ea5e9; }
    .stat-label { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .table-wrap { padding: 0 32px 32px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
    th { background: #0f172a; padding: 14px 16px; text-align: left; font-size: 12px; text-transform: uppercase; color: #64748b; letter-spacing: 1px; }
    td { padding: 14px 16px; border-top: 1px solid #334155; font-size: 14px; vertical-align: middle; }
    tr:hover td { background: #263348; }
    code { background: #0f172a; padding: 4px 8px; border-radius: 6px; font-size: 13px; color: #f59e0b; font-weight: 700; letter-spacing: 1px; }
    .empty { text-align: center; padding: 60px; color: #475569; }
    .empty-icon { font-size: 48px; margin-bottom: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
    #toast { position: fixed; bottom: 24px; right: 24px; background: #10b981; color: white; padding: 12px 20px; border-radius: 10px; display: none; font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <div class="moon">🌙</div>
    <div>
      <h1>D Moon Giveaway Dashboard</h1>
      <p>Eid Special Giveaway — Auto-detecting "Gift" comments</p>
    </div>
  </header>

  <div class="stats">
    <div class="stat">
      <div class="stat-num">${winners.length}</div>
      <div class="stat-label">Total Commenters</div>
    </div>
    <div class="stat">
      <div class="stat-num">${winners.filter(w => w.platform === 'Instagram').length}</div>
      <div class="stat-label">Instagram</div>
    </div>
    <div class="stat">
      <div class="stat-num">${winners.filter(w => w.platform === 'Facebook').length}</div>
      <div class="stat-label">Facebook</div>
    </div>
    <div class="stat">
      <div class="stat-num">${winners.filter(w => w.dmSent).length}</div>
      <div class="stat-label">DMs Sent ✅</div>
    </div>
  </div>

  <div class="table-wrap">
    ${winners.length === 0 ? `
      <div class="empty">
        <div class="empty-icon">👀</div>
        <div>Waiting for "Gift" comments on your posts...</div>
        <div style="font-size:13px;margin-top:8px;color:#334155">System is live and monitoring FB + IG</div>
      </div>
    ` : `
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>User</th>
            <th>Code</th>
            <th>Comment</th>
            <th>DM Status</th>
            <th>Time</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `}
  </div>

  <div id="toast">✅ DM message copied!</div>

  <script>
    const website = '${CONFIG.WEBSITE_LINK}';
    function copyDM(username, code) {
      const msg = \`🎉 Congratulations \${username}!

You've been detected as a participant in the D Moon Eid Special Giveaway!

🎁 Your Unique Code: \${code}

👉 Visit us at: \${website}

Please share this code when claiming your personalized gift.

Thank you for participating! Winner announcement: 24 May 2026 🌙

— D Moon Advertising Team\`;
      navigator.clipboard.writeText(msg);
      const t = document.getElementById('toast');
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 2500);
    }
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`);
});

// ============================================================
// API — get winners as JSON
// ============================================================

// ============================================================
// API — get winners as JSON
// ============================================================
app.get('/api/winners', (req, res) => {
  res.json(winners);
});

// ============================================================
// GIVEAWAY PAGE
// ============================================================
const fs = require('fs');
const path = require('path');

app.get('/giveaway', (req, res) => {
  const filePath = path.join(__dirname, 'giveaway.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Giveaway page not found.');
  }
});

app.get('/coupon-bg.png', (req, res) => {
  const filePath = path.join(__dirname, 'coupon-bg.png');
  if (fs.existsSync(filePath)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(filePath);
  } else {
    res.status(404).send('Image not found.');
  }
});


app.get('/dmoon-logo.png', (req, res) => {
  const filePath = path.join(__dirname, 'dmoon-logo.png');
  if (fs.existsSync(filePath)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(filePath);
  } else {
    res.status(404).send('Logo not found.');
  }
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`D Moon Giveaway Server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Giveaway: http://localhost:${PORT}/giveaway`);
  console.log(`Webhook: http://localhost:${PORT}/webhook`);
});
