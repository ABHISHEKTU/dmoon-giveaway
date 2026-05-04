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

// ============================================================
// BUILD DM MESSAGE
// ============================================================
function buildDMMessage(username, code) {
  return `🎉 Congratulations ${username}!

You've been detected as a participant in the D Moon Eid Special Giveaway!

🎁 Your Unique Code: *${code}*

👉 Visit us at: ${CONFIG.WEBSITE_LINK}

Please share this code when claiming your personalized gift.

Thank you for participating! Winner announcement: 24 May 2026 🌙

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
app.get('/api/winners', (req, res) => {
  res.json(winners);
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`D Moon Giveaway Server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
});

// ============================================================
// GIVEAWAY PAGE — customer facing
// ============================================================
app.get('/giveaway', (req, res) => {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbycSdgKKE9VtAu_LdT3pA_WNasrzmiM85fEBZ0VLVXo_pcwJAnCHmscr8OOSNE6BFXh/exec';
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dmoon Advertising | Eid Special Giveaway</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <style>
    :root{--purple-950:#210631;--purple-900:#2b0b42;--purple-700:#5e1f81;--magenta:#ef2f9a;--red:#ef1e28;--yellow:#ffca24;--cream:#fffaf0;--ink:#21152f;--muted:#776d82;--line:rgba(43,11,66,0.16);--shadow:0 24px 70px rgba(43,11,66,0.25)}
    *{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
    body{min-height:100vh;color:var(--ink);font-family:"Segoe UI",Arial,sans-serif;background:radial-gradient(circle at 80% 18%,rgba(239,47,154,0.2),transparent 28%),radial-gradient(circle at 12% 14%,rgba(255,202,36,0.14),transparent 25%),linear-gradient(135deg,#fffaf3 0%,#f7f1ff 48%,#fff2f8 100%)}
    button,input,select{font:inherit;cursor:pointer}
    .page{width:min(1240px,calc(100% - 28px));margin:0 auto;padding:24px 0 60px}
    .topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:24px}
    .brand{display:flex;align-items:center;gap:14px;color:var(--purple-950);font-weight:900;letter-spacing:.08em;text-transform:uppercase;text-decoration:none}
    .entry-screen{min-height:calc(100vh - 150px);display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,430px);gap:34px;align-items:center}
    .visual{position:relative;overflow:hidden;min-height:540px;padding:46px;border-radius:16px;color:white;background:radial-gradient(circle at 72% 45%,rgba(255,255,255,0.2),transparent 22%),linear-gradient(135deg,#260638 0%,#6f2595 56%,#2a063b 100%);box-shadow:var(--shadow)}
    .ribbon{position:relative;z-index:1;display:inline-flex;align-items:center;gap:14px;margin-bottom:30px;padding:14px 22px;border-radius:10px;background:var(--red);font-size:clamp(1.6rem,4vw,3.2rem);font-weight:950;line-height:.88;text-transform:uppercase}
    .gift-badge{display:grid;place-items:center;width:78px;height:78px;border-radius:8px;color:var(--purple-900);background:var(--yellow);font-size:46px}
    h1{position:relative;z-index:1;margin:0;color:white;font-family:Georgia,serif;font-size:clamp(3.5rem,9vw,8.6rem);line-height:.84;text-transform:uppercase}
    .visual p{position:relative;z-index:2;margin:26px 0 0;color:rgba(255,255,255,0.9);font-size:1.28rem;line-height:1.5}
    .phone{position:absolute;right:60px;bottom:54px;z-index:1;width:160px;height:292px;border:8px solid #1b1027;border-radius:31px;background:linear-gradient(#ffd226,#ffad32)}
    .phone::before{content:"";position:absolute;top:9px;left:50%;width:58px;height:16px;border-radius:0 0 12px 12px;background:#1b1027;transform:translateX(-50%)}
    .phone b{position:absolute;inset:115px 12px auto;color:var(--purple-700);font-size:2.05rem;line-height:.95;text-align:center;text-transform:uppercase}
    .entry-card{padding:32px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,0.97);box-shadow:var(--shadow)}
    .entry-card h2{margin:0 0 8px;color:var(--purple-950);font-size:1.65rem}
    .entry-card p{margin:0 0 20px;color:var(--muted);line-height:1.5}
    label{display:block;margin:14px 0 7px;color:var(--purple-950);font-weight:700;font-size:.9rem}
    input,select{width:100%;height:52px;border:1px solid rgba(43,11,66,0.2);border-radius:10px;padding:0 16px;color:var(--ink);background:white;outline:none;transition:border-color .2s,box-shadow .2s}
    input:focus,select:focus{border-color:var(--magenta);box-shadow:0 0 0 4px rgba(239,47,154,0.12)}
    .main-btn{width:100%;min-height:54px;margin-top:18px;border:0;border-radius:10px;color:white;background:linear-gradient(135deg,var(--magenta),var(--red));font-weight:900;font-size:1rem;box-shadow:0 14px 26px rgba(239,47,154,0.28);transition:opacity .2s,transform .1s}
    .main-btn:hover:not(:disabled){opacity:.92;transform:translateY(-1px)}
    .main-btn:disabled{opacity:.38;cursor:not-allowed;box-shadow:none}
    .message{display:none;margin-top:12px;padding:11px 14px;border-radius:10px;color:#9d2b22;background:#fff0ec;font-size:.92rem;line-height:1.45}
    .message.show{display:block}.message.ok{color:#2f7436;background:#eef9f1}
    .coupon-section{display:none;margin-top:40px}.coupon-section.show{display:block}
    .section-title{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:16px}
    .section-title h2{margin:0;color:var(--purple-950);font-size:1.65rem}
    .light-btn{min-height:42px;border:1px solid var(--line);border-radius:8px;padding:0 16px;color:var(--purple-950);background:rgba(255,255,255,0.92);font-weight:700}
    .coupon-shell{display:grid;grid-template-columns:176px minmax(0,1fr);overflow:hidden;min-height:420px;border-radius:16px;background:white;box-shadow:var(--shadow)}
    .stub{display:grid;grid-template-rows:110px 1fr;place-items:center;border-right:10px dotted #efe8f4;background:white}
    .vertical-code{writing-mode:vertical-rl;transform:rotate(180deg);display:flex;align-items:center;gap:14px;color:var(--purple-950);font-size:1.55rem;font-weight:900}
    .vertical-code strong{padding:14px 10px;border-radius:8px;color:white;background:var(--purple-950);letter-spacing:.08em}
    .coupon-art{position:relative;overflow:hidden;min-height:420px;padding:34px 34px 26px;color:white;background:radial-gradient(circle at 72% 42%,rgba(255,255,255,0.2),transparent 24%),linear-gradient(135deg,#28073d 0%,#6d238f 52%,#28073d 100%)}
    .coupon-content{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) 210px;gap:24px;min-height:360px}
    .coupon-title{display:flex;align-items:center;gap:18px;margin-bottom:26px}
    .coupon-title .gift-box{display:grid;place-items:center;width:96px;height:96px;border-radius:8px;color:var(--purple-900);background:var(--yellow);font-size:56px}
    .coupon-title h3{margin:0;font-family:Georgia,serif;font-size:clamp(2.1rem,5vw,4.6rem);line-height:.9;text-transform:uppercase}
    .coupon-title h3 span{display:block;font-size:.56em}
    .field-lines{display:grid;gap:18px;max-width:650px;margin-top:16px}
    .line-row{display:grid;grid-template-columns:140px minmax(0,1fr);gap:18px;align-items:end;color:white;font-size:clamp(1.2rem,2.4vw,1.8rem)}
    .line-row b{font-weight:500}
    .line-value{min-height:38px;border-bottom:2px dashed rgba(255,255,255,0.44);color:var(--cream);font-weight:800;overflow-wrap:anywhere}
    .script{margin-top:28px;color:#f6ff33;font-family:"Segoe Script",cursive;font-size:clamp(1rem,2.4vw,1.72rem)}
    .coupon-phone{align-self:center;justify-self:center;position:relative;width:160px;height:280px;border:8px solid #1b1027;border-radius:28px;background:linear-gradient(#ffd226,#ffad32)}
    .coupon-phone::before{content:"";position:absolute;top:8px;left:50%;width:56px;height:16px;border-radius:0 0 12px 12px;background:#1b1027;transform:translateX(-50%)}
    .coupon-phone .present{position:absolute;inset:56px 0 auto;text-align:center;font-size:36px}
    .coupon-phone b{position:absolute;inset:110px 14px auto;color:var(--purple-700);font-size:2.1rem;line-height:.95;text-align:center;text-transform:uppercase}
    .social{position:absolute;right:28px;bottom:20px;z-index:2;display:flex;gap:10px;align-items:center;color:white;font-size:1.1rem}
    .social i{display:grid;place-items:center;width:34px;height:34px;border-radius:8px;background:#315fb7;font-style:normal;font-weight:900}
    .social i:last-child{background:linear-gradient(135deg,#6f38d5,#ff6d3d)}
    .form-dock{margin-top:18px;padding:24px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,0.97);box-shadow:0 16px 36px rgba(43,11,66,0.12)}
    .form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
    .privacy{margin:14px 0 0;color:var(--muted);font-size:.85rem;line-height:1.4}
    .download-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:18px}
    .download-note{color:var(--muted);font-size:.9rem}
    .loading-overlay{display:none;position:fixed;inset:0;z-index:50;place-items:center;background:rgba(28,6,43,0.72)}
    .loading-overlay.show{display:grid}
    .loading-card{padding:40px 48px;border-radius:16px;background:white;text-align:center;box-shadow:0 28px 90px rgba(0,0,0,0.3)}
    .spinner{width:52px;height:52px;border:5px solid #efe8f4;border-top-color:var(--magenta);border-radius:50%;margin:0 auto 18px;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .loading-card p{color:var(--purple-950);font-weight:700;font-size:1.1rem}
    .loading-card small{color:var(--muted);font-size:.88rem}
    .modal{position:fixed;inset:0;z-index:30;display:none;place-items:center;padding:22px;background:rgba(28,6,43,0.64)}
    .modal.show{display:grid}
    .modal-card{width:min(520px,100%);border-radius:16px;padding:36px 30px;color:white;text-align:center;background:linear-gradient(135deg,var(--purple-950),var(--purple-700));box-shadow:0 28px 90px rgba(0,0,0,0.32)}
    .modal-card h2{margin:14px 0 8px;font-family:Georgia,serif;font-size:clamp(2.2rem,6vw,4rem);line-height:.95}
    .modal-card p{margin:0;color:rgba(255,255,255,0.86);line-height:1.5}
    .small-btn{min-height:44px;margin-top:22px;border:0;border-radius:10px;padding:0 24px;color:var(--purple-950);background:white;font-weight:900;font-size:1rem}
    .success-screen{display:none;text-align:center;padding:80px 20px}.success-screen.show{display:block}
    .success-icon{font-size:80px;margin-bottom:20px}
    .success-screen h2{color:var(--purple-950);font-family:Georgia,serif;font-size:clamp(2rem,5vw,3.5rem);margin-bottom:12px}
    .success-screen p{color:var(--muted);font-size:1.1rem;margin-bottom:28px}
    .redirect-bar{display:inline-block;padding:14px 28px;border-radius:10px;background:linear-gradient(135deg,var(--magenta),var(--red));color:white;font-weight:700;font-size:1rem;text-decoration:none}
    @media(max-width:960px){.entry-screen,.coupon-shell,.coupon-content,.form-grid{grid-template-columns:1fr}.stub{grid-template-columns:110px 1fr;grid-template-rows:auto;min-height:116px;border-right:0;border-bottom:10px dotted #efe8f4}.vertical-code{writing-mode:horizontal-tb;transform:none}.phone,.coupon-phone{display:none}}
    @media(max-width:560px){.page{padding-top:16px}.visual,.coupon-art{padding:24px}.line-row{grid-template-columns:1fr;gap:4px}.download-row .main-btn{width:100%}}
  </style>
</head>
<body>
  <main class="page">
    <header class="topbar">
      <a href="https://dmoonadvertising.com" class="brand">🌙 Dmoon Advertising</a>
    </header>
    <section class="entry-screen" id="entryScreen">
      <div class="visual">
        <div class="ribbon"><span class="gift-badge">🎁</span><span>Free<br>Gifts</span></div>
        <h1>Eid Special Giveaway</h1>
        <p>Celebrate Eid with Dmoon Advertising and unlock your official personalized raffle coupon using your private campaign code.</p>
        <div class="phone"><b>Give<br>Away</b></div>
      </div>
      <form class="entry-card" id="codeForm">
        <h2>Enter Your Code</h2>
        <p>Enter the unique code you received via DM to claim your personalized giveaway coupon.</p>
        <label for="codeInput">Your unique code</label>
        <input id="codeInput" maxlength="8" placeholder="e.g. EID-4829" autocomplete="one-time-code" required style="text-transform:uppercase;letter-spacing:.1em;font-size:1.2rem;font-weight:700">
        <button class="main-btn" type="submit">🎁 Generate My Coupon</button>
        <div class="message" id="codeMsg"></div>
      </form>
    </section>
    <section class="coupon-section" id="couponSection">
      <div class="section-title">
        <h2>Your Personalized Coupon</h2>
        <button class="light-btn" type="button" id="newEntryBtn">← Use Different Code</button>
      </div>
      <article class="coupon-shell" id="couponEl">
        <aside class="stub">
          <div style="font-size:48px">🌙</div>
          <div class="vertical-code"><span>Code:</span><strong id="couponCode">EID-0000</strong></div>
        </aside>
        <div class="coupon-art">
          <div class="coupon-content">
            <div>
              <div class="coupon-title"><div class="gift-box">🎁</div><h3><span>Eid Special</span>Giveaway</h3></div>
              <div class="field-lines">
                <div class="line-row"><b>Name</b><div class="line-value" id="couponName">—</div></div>
                <div class="line-row"><b>Phone</b><div class="line-value" id="couponPhone">—</div></div>
                <div class="line-row"><b>Emirate</b><div class="line-value" id="couponEmirate">—</div></div>
              </div>
              <div class="script">Congratulations — wishing you the very best of luck! 🌙</div>
            </div>
            <div class="coupon-phone"><div class="present">🎁</div><b>Give<br>Away</b></div>
          </div>
          <div class="social"><span>dmoonadvertising</span><i>f</i><i>◎</i></div>
        </div>
      </article>
      <form class="form-dock" id="detailsForm">
        <div class="form-grid">
          <div><label for="nameInput">Full Name</label><input id="nameInput" required placeholder="Your full name"></div>
          <div><label for="phoneInput">Mobile Number</label><input id="phoneInput" required placeholder="+971 50 000 0000" type="tel"></div>
          <div>
            <label for="emirateInput">Emirate</label>
            <select id="emirateInput" required>
              <option value="">Select Emirate</option>
              <option>Abu Dhabi</option><option>Dubai</option><option>Sharjah</option>
              <option>Ajman</option><option>Umm Al Quwain</option><option>Ras Al Khaimah</option><option>Fujairah</option>
            </select>
          </div>
        </div>
        <p class="privacy">By submitting, you agree that Dmoon Advertising may contact you regarding this giveaway.</p>
        <div class="download-row">
          <button class="main-btn" id="downloadBtn" type="submit" disabled style="width:auto;min-width:260px;margin-top:0">⬇ Save & Download Coupon PDF</button>
          <span class="download-note" id="downloadNote">Fill all fields to activate download.</span>
        </div>
        <div class="message" id="detailsMsg"></div>
      </form>
    </section>
    <div class="success-screen" id="successScreen">
      <div class="success-icon">🎉</div>
      <h2>Coupon Downloaded!</h2>
      <p>Your entry has been saved. Redirecting to our website...</p>
      <a href="https://dmoonadvertising.com" class="redirect-bar">Visit dmoonadvertising.com →</a>
    </div>
  </main>
  <div class="modal" id="successModal">
    <div class="modal-card">
      <div style="font-size:48px">🌙</div>
      <h2>Congratulations! 🎉</h2>
      <p>Your code is valid! Please enter your details to generate and download your personalized coupon.</p>
      <button class="small-btn" type="button" id="modalBtn">Continue →</button>
    </div>
  </div>
  <div class="loading-overlay" id="loadingOverlay">
    <div class="loading-card"><div class="spinner"></div><p>Generating your coupon...</p><small>Saving your details & creating PDF</small></div>
  </div>
  <script>
    const GS='${GOOGLE_SCRIPT_URL}',WU='https://dmoonadvertising.com';
    function validCode(c){return /^EID-\\d{4}$/.test(c)}
    let ac='';
    const $=id=>document.getElementById(id);
    const cf=$('codeForm'),ci=$('codeInput'),cm=$('codeMsg'),es=$('entryScreen'),cs=$('couponSection'),
          cc=$('couponCode'),cn=$('couponName'),cp=$('couponPhone'),ce=$('couponEmirate'),
          sm=$('successModal'),mb=$('modalBtn'),df=$('detailsForm'),ni=$('nameInput'),
          pi=$('phoneInput'),ei=$('emirateInput'),db=$('downloadBtn'),dn=$('downloadNote'),
          dm=$('detailsMsg'),nb=$('newEntryBtn'),lo=$('loadingOverlay'),ss=$('successScreen');
    const msg=(n,t,ok=false)=>{n.textContent=t;n.className='message show'+(ok?' ok':'')};
    const clr=n=>{n.className='message';n.textContent=''};
    const ok=()=>!!(ac&&ni.value.trim()&&pi.value.trim()&&ei.value);
    function upd(){cn.textContent=ni.value.trim()||'—';cp.textContent=pi.value.trim()||'—';ce.textContent=ei.value||'—';db.disabled=!ok();dn.textContent=ok()?'✅ Ready! Click to save and download your PDF.':'Fill all fields to activate download.';}
    ci.addEventListener('input',()=>{let v=ci.value.toUpperCase().replace(/[^A-Z0-9-]/g,'');if(v.startsWith('EID')&&v.length>3&&v[3]!=='-')v='EID-'+v.slice(3);ci.value=v;clr(cm);});
    cf.addEventListener('submit',async e=>{
      e.preventDefault();const c=ci.value.trim().toUpperCase();
      if(!validCode(c)){msg(cm,'❌ Please enter a valid code in format EID-XXXX (e.g. EID-4829).');return;}
      try{msg(cm,'⏳ Validating code...',true);const r=await fetch(GS+'?action=checkCode&code='+c);const d=await r.json();if(d.used){msg(cm,'❌ This code has already been used.');return;}}catch(e){console.warn(e);}
      ac=c;cc.textContent=c;es.style.display='none';cs.classList.add('show');sm.classList.add('show');upd();clr(cm);
    });
    mb.addEventListener('click',()=>{sm.classList.remove('show');ni.focus();cs.scrollIntoView({behavior:'smooth',block:'start'});});
    [ni,pi,ei].forEach(el=>{el.addEventListener('input',upd);el.addEventListener('change',upd);});
    df.addEventListener('submit',async e=>{
      e.preventDefault();if(!ok()){msg(dm,'Please fill all fields first.');return;}
      lo.classList.add('show');
      const entry={code:ac,name:ni.value.trim(),phone:pi.value.trim(),emirate:ei.value,created_at:new Date().toISOString()};
      try{await fetch(GS,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveEntry',...entry})});}catch(e){console.warn(e);}
      try{
        const {jsPDF}=window.jspdf;
        const canvas=await html2canvas(document.getElementById('couponEl'),{scale:2,useCORS:true,backgroundColor:null,logging:false});
        const img=canvas.toDataURL('image/png'),pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
        const pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight();
        const r=Math.min(pw/canvas.width*96,ph/canvas.height*96)*0.92;
        const fw=canvas.width*r/96,fh=canvas.height*r/96;
        pdf.addImage(img,'PNG',(pw-fw)/2,(ph-fh)/2,fw,fh);
        pdf.save('Dmoon-Eid-Giveaway-'+ac+'.pdf');
      }catch(e){console.warn(e);window.print();}
      lo.classList.remove('show');cs.classList.remove('show');ss.classList.add('show');
      ss.scrollIntoView({behavior:'smooth'});
      setTimeout(()=>window.location.href=WU,4000);
    });
    nb.addEventListener('click',()=>{ac='';ci.value='';df.reset();cs.classList.remove('show');es.style.display='';clr(cm);clr(dm);upd();ci.focus();});
  </script>
</body>
</html>`);
});
