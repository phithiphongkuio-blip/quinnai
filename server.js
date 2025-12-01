require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// 1. เชื่อมต่อ Database
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ [Quinn AI] Database Connected!"))
    .catch(err => console.error("❌ Database Error:", err));

// 2. User Schema
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
    settings: {
        fbToken: { type: String, default: '' },
        adAccountId: { type: String, default: '' },
        isBotActive: { type: Boolean, default: false },
        stopLossLimit: { type: Number, default: 500 },
        minPurchase: { type: Number, default: 1 },
        targetRoas: { type: Number, default: 2.5 },
        scalingMinPurchase: { type: Number, default: 5 },
        profitMargin: { type: Number, default: 40 },
        fatigue: { maxFrequency: { type: Number, default: 2.5 }, minCtr: { type: Number, default: 1.0 }, minImpression: { type: Number, default: 1000 } },
        dropoff: { minRatio: { type: Number, default: 0.5 }, minClicks: { type: Number, default: 10 } },
        dayparting: { enabled: { type: Boolean, default: false }, startHour: { type: Number, default: 8 }, endHour: { type: Number, default: 23 } },
        simulationMode: { type: Boolean, default: true }
    },
    logs: [{ timestamp: String, type: String, message: String, adName: String }]
});
const User = mongoose.model('User', userSchema);

// Middleware
const authMiddleware = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ message: 'No Token' });
    try { req.user = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET); next(); } 
    catch (e) { res.status(401).json({ message: 'Invalid Token' }); }
};

// ==========================================
// 🕵️‍♂️ Feature 3: Spy Tool (Page Search) ** NEW **
// ==========================================
app.get('/api/tools/search-pages', authMiddleware, async (req, res) => {
    try {
        const { q } = req.query;
        const user = await User.findById(req.user.id);
        
        if (!user.settings.fbToken) return res.status(400).json({ message: 'No FB Token' });

        console.log(`🕵️‍♂️ Searching Pages: ${q}`);

        // ใช้ Facebook Search API (ค้นหา Page)
        const url = `https://graph.facebook.com/v18.0/search`;
        const fbRes = await axios.get(url, {
            params: {
                type: 'page',
                q: q,
                access_token: user.settings.fbToken,
                limit: 10,
                fields: 'id,name,picture'
            }
        });

        const pages = fbRes.data.data.map(p => ({
            id: p.id,
            name: p.name,
            picture: p.picture?.data?.url || 'https://via.placeholder.com/50'
        }));

        res.json({ status: 'Success', data: pages });

    } catch (error) {
        console.error("Spy Tool Error:", error.response?.data || error.message);
        
        // กรณีค้นหาไม่เจอ หรือติด Permission (Facebook ชอบกั๊ก API Search)
        // เราจะส่ง Error กลับไปให้หน้าเว็บรู้
        res.status(500).json({ 
            status: 'Error', 
            message: error.response?.data?.error?.message || 'ค้นหาไม่สำเร็จ (Facebook API Restriction)' 
        });
    }
});

// ==========================================
// 🛠️ Feature 1 & 2: AI Writer & Interest Hunter
// ==========================================
app.post('/api/ai/generate-copy', authMiddleware, async (req, res) => {
    try {
        const { product, tone } = req.body;
        if (!process.env.GEMINI_API_KEY) return res.json({ status: 'Success', result: `(Simulation)\n🔥 ${product} ดีจริง!` });
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `เขียนแคปชั่นขายของ Facebook: "${product}"\nสไตล์: "${tone}"\nขอ 3 แบบ ใส่ Emoji เว้นบรรทัดสวยๆ ภาษาไทย`;
        const result = await model.generateContent(prompt);
        res.json({ status: 'Success', result: result.response.text() });
    } catch (e) { res.status(500).json({ status: 'Error', message: e.message }); }
});

app.get('/api/tools/search-interests', authMiddleware, async (req, res) => {
    try {
        const { q } = req.query;
        const user = await User.findById(req.user.id);
        const fbRes = await axios.get(`https://graph.facebook.com/v18.0/search`, { params: { type: 'adinterest', q, access_token: user.settings.fbToken, limit: 20, locale: 'th_TH' } });
        res.json({ status: 'Success', data: fbRes.data.data.map(i => ({ id: i.id, name: i.name, audience_size: i.audience_size_upper_bound, topic: i.topic })) });
    } catch (e) { res.status(500).json({ message: 'FB Error' }); }
});

// ==========================================
// 🧠 Core Logic Engine
// ==========================================
async function checkAdsForUser(user) {
    const config = user.settings;
    if (!config.fbToken || !config.adAccountId || !config.isBotActive) return;
    console.log(`🤖 Checking user: ${user.name}`);
    try {
        if (config.dayparting.enabled) {
            const h = new Date().getHours();
            if (h >= config.dayparting.endHour || h < config.dayparting.startHour) return;
        }
        const url = `https://graph.facebook.com/v18.0/${config.adAccountId}/insights`;
        const res = await axios.get(url, {
            params: { access_token: config.fbToken, level: 'ad', fields: 'ad_id,ad_name,spend,actions,action_values,reach,impressions,ctr', date_preset: 'today', limit: 500 }
        });
        const ads = res.data.data || [];

        for (let ad of ads) {
            const spend = parseFloat(ad.spend || 0);
            const purchase = ad.actions?.find(a => a.action_type === 'purchase')?.value || 0;
            const linkClicks = ad.actions?.find(a => a.action_type === 'link_click')?.value || 0;
            const landingViews = ad.actions?.find(a => a.action_type === 'landing_page_view')?.value || 0;
            const viewRatio = linkClicks > 0 ? (landingViews / linkClicks) : 0;
            const impressions = parseInt(ad.impressions || 0);
            const reach = parseInt(ad.reach || 0);
            const frequency = reach > 0 ? (impressions / reach) : 0;

            if (spend > config.stopLossLimit && purchase < config.minPurchase) {
                if (!config.simulationMode) {
                    await updateAdStatus(ad.ad_id, 'PAUSED', config.fbToken);
                    await addLog(user, 'ACTION', `ปิดแอดขาดทุน (${spend.toLocaleString()} บ.)`, ad.ad_name);
                    await suggestNewInterest(user, ad.ad_name); 
                } else await addLog(user, 'WARNING', `(Sim) ปิดแอดขาดทุน`, ad.ad_name);
            } else if (linkClicks > config.dropoff.minClicks && viewRatio < config.dropoff.minRatio) {
                await addLog(user, 'WARNING', `Drop-off สูง (${(viewRatio*100).toFixed(0)}%)`, ad.ad_name);
            } else if (impressions > config.fatigue.minImpression && frequency > config.fatigue.maxFrequency) {
                await addLog(user, 'WARNING', `แอดช้ำ (Freq ${frequency.toFixed(2)})`, ad.ad_name);
            }
        }
    } catch (e) { console.error(`Logic Error: ${e.message}`); }
}

async function suggestNewInterest(user, adName) {
    try {
        const keyword = adName.split(/[_ -]/)[0];
        if (!keyword || keyword.length < 2) return;
        const url = `https://graph.facebook.com/v18.0/search`;
        const res = await axios.get(url, { params: { type: 'adinterest', q: keyword, access_token: user.settings.fbToken, limit: 1, locale: 'th_TH' } });
        if (res.data.data.length > 0) {
            const suggestion = res.data.data[0];
            await addLog(user, 'IDEA', `ลองยิงกลุ่มนี้แทนไหม?: ${suggestion.name} (คน ${suggestion.audience_size_upper_bound})`, 'AI Suggestion');
        }
    } catch (e) {}
}

async function addLog(user, type, message, adName) { user.logs.unshift({ timestamp: new Date().toLocaleString('th-TH'), type, message, adName }); if (user.logs.length > 50) user.logs = user.logs.slice(0, 50); await user.save(); }
async function updateAdStatus(adId, status, token) { try { await axios.post(`https://graph.facebook.com/v18.0/${adId}`, { status, access_token: token }); } catch (e) {} }

// APIs
app.post('/api/register', async (req, res) => { try { const { name, email, password } = req.body; if(await User.findOne({ email })) return res.status(400).json({ message: 'Email Exists' }); const user = new User({ name, email, password: await bcrypt.hash(password, 10) }); await user.save(); res.json({ status: 'Success' }); } catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/login', async (req, res) => { try { const { email, password } = req.body; const user = await User.findOne({ email }); if(!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ message: 'Invalid' }); res.json({ status: 'Success', token: jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' }), user: { name: user.name } }); } catch(e){ res.status(500).json({message:e.message}); } });
app.get('/api/me/settings', authMiddleware, async (req, res) => res.json((await User.findById(req.user.id)).settings));
app.post('/api/me/settings', authMiddleware, async (req, res) => { const u = await User.findById(req.user.id); u.settings = { ...u.settings, ...req.body }; await u.save(); res.json({ status: 'Success' }); });
app.get('/api/me/logs', authMiddleware, async (req, res) => res.json((await User.findById(req.user.id)).logs));
app.get('/api/connect-facebook', authMiddleware, (req, res) => { res.json({ url: `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_CALLBACK_URL}&state=${req.header('Authorization').replace('Bearer ', '')}&scope=ads_management,ads_read,public_profile` }); });
app.get('/api/facebook/callback', async (req, res) => { try { const { code, state } = req.query; const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', { params: { client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, redirect_uri: process.env.FB_CALLBACK_URL, code } }); const user = await User.findById(jwt.verify(state, process.env.JWT_SECRET).id); user.settings.fbToken = tokenRes.data.access_token; await user.save(); res.redirect('/dashboard.html?status=success'); } catch (e) { res.send('Error: ' + e.message); } });
app.get('/api/me/adaccounts', authMiddleware, async (req, res) => { try { const user = await User.findById(req.user.id); const fbRes = await axios.get(`https://graph.facebook.com/v18.0/me/adaccounts`, { params: { access_token: user.settings.fbToken, fields: 'name,account_id,currency,account_status', limit: 50 } }); res.json({ status: 'Success', accounts: fbRes.data.data.map(a => ({ id: `act_${a.account_id}`, name: a.name, currency: a.currency, status: a.account_status===1?'Active':'Inactive' })) }); } catch (e) { res.status(500).json({ message: 'Load Error' }); } });

app.get('/api/check-now', authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id);
    try {
        const url = `https://graph.facebook.com/v18.0/${user.settings.adAccountId}/insights`;
        const apiRes = await axios.get(url, { params: { access_token: user.settings.fbToken, level: 'ad', fields: 'ad_name,spend,actions,ctr,impressions,reach,action_values', date_preset: 'today', limit: 500 } });
        const report = (apiRes.data.data || []).map(ad => {
            const purchase = ad.actions?.find(a => a.action_type === 'purchase')?.value || 0;
            const revenue = ad.action_values?.find(a => a.action_type === 'purchase')?.value || 0;
            const spend = parseFloat(ad.spend || 0);
            const roas = spend > 0 ? (revenue/spend).toFixed(2) : 0;
            const margin = user.settings.profitMargin || 40;
            const netProfit = (revenue * (margin/100)) - spend;
            let status = 'OK';
            if (spend > user.settings.stopLossLimit && purchase < user.settings.minPurchase) status = 'DANGER';
            else if (roas >= user.settings.targetRoas && purchase >= user.settings.scalingMinPurchase) status = 'SCALING';
            return { name: ad.ad_name, spend, purchases: purchase, roas, ctr: ad.ctr, status, netProfit };
        });
        res.json({ status: 'Success', data: report });
    } catch(e) { res.json({ status: 'Error', message: e.message }); }
});

cron.schedule('*/15 * * * *', async () => { const activeUsers = await User.find({ 'settings.isBotActive': true, 'settings.fbToken': { $ne: '' } }); for (const user of activeUsers) await checkAdsForUser(user); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server Running Port ${PORT}`));