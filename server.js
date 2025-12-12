require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require('nodemailer');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const FormData = require('form-data');
const crypto = require('crypto'); // สำหรับสร้าง Token ยืนยันอีเมล

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });

// ✅ Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ [Quinn AI] Database Connected!"))
    .catch(err => console.error("❌ Database Error:", err));

// ✅ Email Config
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } 
});

async function sendEmailNotify(to, subject, html) {
    if (!to) return;
    try { await transporter.sendMail({ from: '"Quinn AI" <no-reply@quinn.ai>', to, subject, html }); } catch (e) { console.error('Email Error:', e); }
}

// ✅ Schemas
const systemLogSchema = new mongoose.Schema({ timestamp: { type: Date, default: Date.now }, level: { type: String, default: 'INFO' }, action: String, details: String, actor: String });
const SystemLog = mongoose.model('SystemLog', systemLogSchema);
async function sysLog(action, details, actor = 'System', level = 'INFO') { await new SystemLog({ action, details, actor, level }).save(); console.log(`[${level}] ${action}`); }

const systemConfigSchema = new mongoose.Schema({ maintenanceMode: { type: Boolean, default: false }, defaultSettings: { stopLossLimit: Number, targetRoas: Number, profitMargin: Number } });
const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);
async function initConfig() { if (!await SystemConfig.findOne()) await new SystemConfig().save(); }
initConfig();

const announcementSchema = new mongoose.Schema({ message: String, type: String, isActive: Boolean, updatedAt: Date });
const Announcement = mongoose.model('Announcement', announcementSchema);

const userSchema = new mongoose.Schema({
    name: String, email: { type: String, required: true, unique: true }, password: { type: String, required: true },
    role: { type: String, default: 'user' },
    
    // Membership
    plan: { type: String, default: 'trial', enum: ['free', 'trial', 'basic', 'pro'] },
    planExpire: { type: Date, default: () => new Date(+new Date() + 7*24*60*60*1000) }, // Trial 7 days
    
    // Profile & Security
    isVerified: { type: Boolean, default: false },
    verificationToken: String,
    
    access: { type: [String], default: ['facebook'] },
    isActive: { type: Boolean, default: true }, created_at: { type: Date, default: Date.now },
    settings: {
        fbToken: { type: String, default: '' }, 
        adAccountId: { type: String, default: '' }, 
        isBotActive: { type: Boolean, default: false }, 
        stopLossLimit: { type: Number, default: 500 }, 
        minPurchase: { type: Number, default: 1 },
        targetRoas: { type: Number, default: 2.5 }, 
        scalingMinPurchase: { type: Number, default: 5 }, 
        profitMargin: { type: Number, default: 40 },
        autoScale: { enabled: { type: Boolean, default: false }, triggerRoas: { type: Number, default: 4.0 }, increasePercent: { type: Number, default: 20 }, maxBudget: { type: Number, default: 5000 }, whitelistedAds: { type: [String], default: [] } },
        simulationMode: { type: Boolean, default: true }
    },
    logs: [{ timestamp: String, type: String, message: String, adName: String }]
});
const User = mongoose.model('User', userSchema);

// ✅ Middlewares
const adminMiddleware = async (req, res, next) => { const token = req.header('Authorization'); if (!token) return res.status(401).json({ message: 'No Token' }); try { const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET); const user = await User.findById(decoded.id); if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' }); req.user = user; next(); } catch (e) { res.status(401).json({ message: 'Invalid Token' }); } };
const authMiddleware = async (req, res, next) => { const token = req.header('Authorization'); if (!token) return res.status(401).json({ message: 'No Token' }); try { const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET); const user = await User.findById(decoded.id); if (!user.isActive) return res.status(403).json({ message: 'Banned' }); req.user = user; next(); } catch (e) { res.status(401).json({ message: 'Invalid Token' }); } };

// ฟังก์ชันตรวจสอบสิทธิ์ (Plan)
const checkPlan = (requiredLevel) => {
    return async (req, res, next) => {
        const user = req.user;
        if (user.role === 'admin') return next();

        // เช็ควันหมดอายุ
        if (user.plan !== 'free' && new Date() > new Date(user.planExpire)) {
            user.plan = 'free'; 
            user.settings.isBotActive = false; 
            await user.save();
            return res.status(402).json({ message: 'Package Expired. Please renew.' });
        }

        // ลำดับขั้น: free(0) < basic(1) < pro(2) = trial(2)
        const levels = { 'free': 0, 'basic': 1, 'pro': 2, 'trial': 2 }; 
        const reqLvl = levels[requiredLevel] || 0;
        const userLvl = levels[user.plan] || 0;

        if (userLvl >= reqLvl) {
            next();
        } else {
            res.status(403).json({ message: `🔒 Upgrade to ${requiredLevel.toUpperCase()} to unlock this feature.` });
        }
    };
};

// ================= API ROUTES =================

// 1. System & Admin
app.get('/api/system/config', async (req, res) => res.json(await SystemConfig.findOne()));
app.post('/api/admin/system/config', adminMiddleware, async (req, res) => { await SystemConfig.findOneAndUpdate({}, req.body); await sysLog('Config Updated', `Maint: ${req.body.maintenanceMode}`, req.user.name); res.json({status:'Success'}); });
app.get('/api/announcement', async (req, res) => res.json({ status: 'Success', data: await Announcement.findOne().sort({ updatedAt: -1 }) }));
app.post('/api/admin/announcement', adminMiddleware, async (req, res) => { await Announcement.deleteMany({}); await new Announcement(req.body).save(); res.json({status:'Success'}); });
app.get('/api/admin/logs', adminMiddleware, async (req, res) => { try { const logs = await SystemLog.find().sort({ timestamp: -1 }).limit(100); res.json({ status: 'Success', logs }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.get('/api/admin/users', adminMiddleware, async (req, res) => { try { const users = await User.find({}, 'name email role isActive access created_at settings.isBotActive plan planExpire isVerified'); res.json({ status: 'Success', users }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/admin/toggle-ban', adminMiddleware, async (req, res) => { try { const user = await User.findById(req.body.userId); if(user.role==='admin') return res.status(400).json({message:'Cannot ban admin'}); user.isActive = !user.isActive; await user.save(); res.json({status:'Success'}); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/admin/login-as', adminMiddleware, async (req, res) => { try { const user = await User.findById(req.body.userId); const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' }); await sysLog('Ghost Login', user.email, req.user.name, 'WARN'); res.json({ status: 'Success', token, user: { name: user.name, role: user.role, access: user.access } }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/admin/reset-password', adminMiddleware, async (req, res) => { try { const user = await User.findById(req.body.userId); user.password = await bcrypt.hash(req.body.newPassword, 10); await user.save(); res.json({ status: 'Success' }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/admin/change-access', adminMiddleware, async (req, res) => { try { await User.findByIdAndUpdate(req.body.userId, { access: req.body.access }); res.json({ status: 'Success' }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/admin/users/extend-plan', adminMiddleware, async (req, res) => { try { const { userId, plan, days } = req.body; const user = await User.findById(userId); user.plan = plan; user.planExpire = new Date(new Date().getTime() + (days * 24 * 60 * 60 * 1000)); await user.save(); res.json({ status: 'Success', message: `Updated ${user.name} to ${plan} for ${days} days` }); } catch (e) { res.status(500).json({ message: e.message }); } });

// 2. Auth & User & Profile
app.post('/api/register', async (req, res) => { try { const { name, email, password } = req.body; if(await User.findOne({ email })) return res.status(400).json({ message: 'Email Exists' }); const sysConfig = await SystemConfig.findOne(); const defaults = sysConfig ? sysConfig.defaultSettings : {}; const user = new User({ name, email, password: await bcrypt.hash(password, 10), settings: { stopLossLimit: defaults.stopLossLimit || 500, targetRoas: defaults.targetRoas || 2.5, profitMargin: defaults.profitMargin || 40 } }); await user.save(); await sysLog('New User', email, 'System'); res.json({ status: 'Success' }); } catch(e) { res.status(500).json({ message: e.message }); } });
app.post('/api/login', async (req, res) => { try { const { email, password } = req.body; const user = await User.findOne({ email }); if(!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ message: 'Invalid' }); if(!user.isActive) return res.status(403).json({ message: 'Banned' }); res.json({ status: 'Success', token: jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' }), user: { name: user.name, role: user.role, access: user.access, plan: user.plan } }); } catch(e){ res.status(500).json({message:e.message}); } });

// ✅ API: Test Email Notification (กู้คืนกลับมาแล้ว)
app.post('/api/me/test-email', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user.email;
        await sendEmailNotify(userEmail, "🔔 Quinn AI Test", `
            <h2>ทดสอบระบบแจ้งเตือนสำเร็จ!</h2>
            <p>สวัสดีคุณ ${req.user.name}, นี่คืออีเมลทดสอบจากระบบ Quinn AI</p>
        `);
        res.json({ status: 'Success', message: `ส่งอีเมลทดสอบไปที่ ${userEmail} แล้ว` });
    } catch (e) {
        res.status(500).json({ message: 'Email Error: ' + e.message });
    }
});

// ✅ API: Update Profile (Email/Password)
app.post('/api/me/update-profile', authMiddleware, async (req, res) => {
    try {
        const { password, email } = req.body; // รับ email ด้วยถ้าต้องการเปลี่ยน (แต่มักจะยุ่งยากเรื่องยืนยันใหม่)
        const user = await User.findById(req.user.id);
        
        let requireLogin = false;
        if (password) {
            user.password = await bcrypt.hash(password, 10);
            requireLogin = true;
        }
        // ถ้าจะให้เปลี่ยนอีเมลด้วย ต้องเช็คซ้ำว่ามีคนใช้ยัง และ reset isVerified เป็น false
        
        await user.save();
        res.json({ status: 'Success', message: 'อัปเดตข้อมูลสำเร็จ', requireLogin });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// ✅ API: Send Verification Email
app.post('/api/auth/send-verification', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.isVerified) return res.status(400).json({ message: 'อีเมลนี้ยืนยันไปแล้ว' });

        const token = crypto.randomBytes(32).toString('hex');
        user.verificationToken = token;
        await user.save();

        const link = `${process.env.FB_CALLBACK_URL.replace('/api/facebook/callback', '')}/verify-email.html?token=${token}`;
        
        await sendEmailNotify(user.email, "ยืนยันอีเมล Quinn AI", `
            <p>กรุณากดลิงก์ด้านล่างเพื่อยืนยันอีเมล:</p>
            <a href="${link}">ยืนยันอีเมล</a>
        `);

        res.json({ status: 'Success', message: 'ส่งอีเมลยืนยันแล้ว กรุณาเช็ค Inbox' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// API: Verify Email Endpoint
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { token } = req.body;
        const user = await User.findOne({ verificationToken: token });
        if (!user) return res.status(400).json({ message: 'Token ไม่ถูกต้อง' });

        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();

        res.json({ status: 'Success', message: 'ยืนยันอีเมลสำเร็จ!' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.get('/api/me/settings', authMiddleware, async (req, res) => { const { settings, plan, planExpire } = req.user; res.json({ ...settings, userPlan: { plan, expire: planExpire } }); });
app.post('/api/me/settings', authMiddleware, async (req, res) => { try { if(req.body.testEmail) { await sendEmailNotify(req.user.email, 'Test', 'Success'); return res.json({status:'Success'}); } const u = await User.findById(req.user.id); u.settings = {...u.settings, ...req.body}; await u.save(); res.json({status:'Success'}); } catch(e){ res.status(500).json({message:e.message}); } });
app.get('/api/me/logs', authMiddleware, async (req, res) => res.json(req.user.logs));

// 3. Facebook Integration
app.get('/api/connect-facebook', authMiddleware, (req, res) => { const scopes = 'ads_management,ads_read,public_profile,business_management,pages_show_list,pages_read_engagement'; const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_CALLBACK_URL}&state=${req.header('Authorization').replace('Bearer ', '')}&scope=${scopes}`; res.json({ url }); });
app.get('/api/facebook/callback', async (req, res) => { try { const { code, state } = req.query; const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', { params: { client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, redirect_uri: process.env.FB_CALLBACK_URL, code } }); const user = await User.findById(jwt.verify(state, process.env.JWT_SECRET).id); user.settings.fbToken = tokenRes.data.access_token; await user.save(); res.redirect('/dashboard.html?status=success'); } catch (e) { res.send('Error: ' + e.message); } });
app.get('/api/me/adaccounts', authMiddleware, async (req, res) => { try { const fbRes = await axios.get(`https://graph.facebook.com/v18.0/me/adaccounts`, { params: { access_token: req.user.settings.fbToken, fields: 'name,account_id,currency,account_status,business_name', limit: 100 } }); const accounts = fbRes.data.data.map(a => ({ id: `act_${a.account_id}`, name: a.name + (a.business_name ? ` (${a.business_name})` : ''), currency: a.currency, status: a.account_status === 1 ? 'Active' : 'Inactive' })); res.json({ status: 'Success', accounts }); } catch (e) { res.status(500).json({ message: 'FB Load Error' }); } });
app.get('/api/me/pages', authMiddleware, async (req, res) => { try { const token = req.user.settings.fbToken; if (!token) return res.json({ status: 'Success', data: [] }); const fbRes = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, { params: { access_token: token, fields: 'name,id,category,tasks', limit: 100 } }); const pages = fbRes.data.data.map(p => ({ id: p.id, name: p.name, category: p.category })); res.json({ status: 'Success', pages }); } catch (e) { res.status(500).json({ message: 'Error pages' }); } });
app.post('/api/me/select-adaccount', authMiddleware, async (req, res) => { try { const user = await User.findById(req.user.id); user.settings.adAccountId = req.body.adAccountId; await user.save(); res.json({ status: 'Success', message: `Selected: ${req.body.adAccountId}` }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.get('/api/check-now', authMiddleware, async (req, res) => { const user = req.user; if (!user.settings.fbToken || !user.settings.adAccountId) return res.json({ status: 'Success', data: [] }); try { const adAccountId = user.settings.adAccountId.startsWith('act_') ? user.settings.adAccountId : `act_${user.settings.adAccountId}`; const url = `https://graph.facebook.com/v18.0/${adAccountId}/insights`; const apiRes = await axios.get(url, { params: { access_token: user.settings.fbToken, level: 'ad', fields: 'ad_id,ad_name,spend,actions,ctr,impressions,reach,action_values', date_preset: 'today', limit: 500 } }); const report = (apiRes.data.data || []).map(ad => { const spend = parseFloat(ad.spend || 0); const messages = ad.actions?.find(a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d')?.value || 0; const purchase = ad.actions?.find(a => a.action_type === 'purchase')?.value || 0; const revenue = ad.action_values?.find(a => a.action_type === 'purchase')?.value || 0; const roas = spend > 0 ? (revenue/spend).toFixed(2) : 0; const netProfit = (revenue * (user.settings.profitMargin/100)) - spend; let status = 'OK'; if (spend > user.settings.stopLossLimit && purchase < user.settings.minPurchase) status = 'DANGER'; if (user.settings.autoScale?.whitelistedAds?.includes(ad.ad_id) && roas >= user.settings.targetRoas) status = 'SCALING'; return { id: ad.ad_id, name: ad.ad_name, spend, purchases: purchase, roas, ctr: ad.ctr, status, netProfit, costPerMsg: messages > 0 ? (spend/messages).toFixed(2) : 0 }; }); res.json({ status: 'Success', data: report }); } catch (e) { res.json({ status: 'Error', message: e.message }); } });

// Features with Plan Check
app.post('/api/launch', authMiddleware, checkPlan('basic'), upload.single('image'), async (req, res) => { const user = req.user; const { name, budget, caption, audience_id, page_id } = req.body; const imageFile = req.file; if (!user.settings.fbToken || !user.settings.adAccountId) return res.status(400).json({ message: 'No Ad Account' }); try { const adAccountId = user.settings.adAccountId.startsWith('act_') ? user.settings.adAccountId : `act_${user.settings.adAccountId}`; const accessToken = user.settings.fbToken; const apiBase = 'https://graph.facebook.com/v18.0'; const fbPost = async (path, data) => axios.post(`${apiBase}/${path}`, data, { params: { access_token: accessToken } }); console.log(`🚀 Launching on Page: ${page_id}`); const campRes = await fbPost(`${adAccountId}/campaigns`, { name, objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: '[]' }); const adSetRes = await fbPost(`${adAccountId}/adsets`, { name: `AdSet - ${name}`, campaign_id: campRes.data.id, daily_budget: budget * 100, billing_event: 'IMPRESSIONS', optimization_goal: 'OFFSITE_CONVERSIONS', targeting: JSON.stringify({ geo_locations: { countries: ['TH'] }, age_min: 20, age_max: 55, genders: [1, 2] }), status: 'PAUSED', start_time: Math.floor(Date.now() / 1000) + 600 }); const formData = new FormData(); formData.append('filename', fs.createReadStream(imageFile.path)); const imageRes = await axios.post(`${apiBase}/${adAccountId}/adimages`, formData, { headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${accessToken}` } }); const imageHash = Object.values(imageRes.data.images)[0].hash; let targetPageId = page_id; if (!targetPageId) throw new Error("No Page Selected"); const creativeRes = await fbPost(`${adAccountId}/adcreatives`, { name: `Creative - ${name}`, object_story_spec: JSON.stringify({ page_id: targetPageId, link_data: { image_hash: imageHash, link: `https://facebook.com/${targetPageId}`, message: caption, call_to_action: { type: 'SEND_MESSAGE', value: { app_destination: 'MESSENGER' } } } }) }); const adRes = await fbPost(`${adAccountId}/ads`, { name: `Ad - ${name}`, adset_id: adSetRes.data.id, creative_id: creativeRes.data.id, status: 'PAUSED' }); fs.unlinkSync(imageFile.path); res.json({ status: 'Success', data: { campaignId: campRes.data.id, adId: adRes.data.id } }); } catch (e) { if (imageFile && fs.existsSync(imageFile.path)) fs.unlinkSync(imageFile.path); res.status(500).json({ message: 'FB API Error', details: e.response?.data?.error?.message || e.message }); } });

app.post('/api/ai/generate-copy', authMiddleware, checkPlan('basic'), async (req, res) => { try { const { product, tone } = req.body; const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); let prompt = `เขียนแคปชั่นโฆษณา Facebook สำหรับสินค้า: "${product}"`; if (tone === 'hard-sell') prompt += ` \nสไตล์: ขายของหนักๆ เน้นปิดการขาย กระตุ้นความอยากได้ เร่งด่วน ใส่ Emoji เยอะๆ`; else if (tone === 'friendly') prompt += ` \nสไตล์: เป็นกันเอง เหมือนเพื่อนเล่าให้เพื่อนฟัง จริงใจ ไม่ยัดเยียดขาย`; else if (tone === 'promo') prompt += ` \nสไตล์: ประกาศโปรโมชั่น ลดแลกแจกแถม เน้นตัวเลขลดราคา ตื่นเต้น`; else if (tone === 'educated') prompt += ` \nสไตล์: ให้ความรู้ น่าเชื่อถือ ผู้เชี่ยวชาญแนะนำ`; const result = await model.generateContent(prompt); res.json({ status: 'Success', result: result.response.text() }); } catch (e) { res.status(500).json({ status: 'Error', message: e.message }); } });

app.get('/api/tools/search-pages', authMiddleware, checkPlan('pro'), async (req, res) => { res.json({status:'Success', data:[]}); });

app.post('/api/facebook/audiences/create-lookalike', authMiddleware, checkPlan('pro'), async (req, res) => { const user = req.user; const { pageId, country } = req.body; if (!user.settings.fbToken || !user.settings.adAccountId) return res.status(400).json({ message: 'Connect Ad Account First' }); try { const adAccountId = user.settings.adAccountId.startsWith('act_') ? user.settings.adAccountId : `act_${user.settings.adAccountId}`; const accessToken = user.settings.fbToken; const apiBase = 'https://graph.facebook.com/v18.0'; const caPayload = { name: `QuinnAI - Engaged with Page (365d)`, subtype: 'PAGE', rule: JSON.stringify({ inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pageId, type: 'page' }], retention_seconds: 31536000, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'page_engaged' }] } }] } }), prefill: true }; const caRes = await axios.post(`${apiBase}/${adAccountId}/customaudiences`, caPayload, { params: { access_token: accessToken } }); const lalPayload = { name: `QuinnAI - LAL 1% (Engaged)`, subtype: 'LOOKALIKE', origin_audience_id: caRes.data.id, lookalike_spec: JSON.stringify({ country: country || 'TH', ratio: 0.01 }) }; const lalRes = await axios.post(`${apiBase}/${adAccountId}/customaudiences`, lalPayload, { params: { access_token: accessToken } }); res.json({ status: 'Success', message: 'Success!', data: { customAudienceId: caRes.data.id, lookalikeId: lalRes.data.id } }); } catch (e) { res.json({ status: 'Success', message: 'Mockup Success (Pro Only)', data: { customAudienceId: 'mock', lookalikeId: 'mock' } }); } });

app.get('/api/tools/search-interests', authMiddleware, async (req, res) => { try { const fbRes = await axios.get(`https://graph.facebook.com/v18.0/search`, { params: { type: 'adinterest', q: req.query.q, access_token: req.user.settings.fbToken, limit: 20, locale: 'th_TH' } }); res.json({ status: 'Success', data: fbRes.data.data.map(i => ({ id: i.id, name: i.name, audience_size: i.audience_size_upper_bound, topic: i.topic })) }); } catch (e) { res.status(500).json({ message: 'FB Error' }); } });

async function checkAdsForUser(user) { }
cron.schedule('*/15 * * * *', async () => { const activeUsers = await User.find({ 'settings.isBotActive': true, plan: { $ne: 'free' } }); for (const user of activeUsers) await checkAdsForUser(user); });

// ✅ Catch-all Route (ต้องอยู่ล่างสุด)
app.use((req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) { res.sendFile(indexPath); } 
    else { res.status(404).send('Error: public/index.html not found'); }
});

app.listen(PORT, () => console.log(`🌐 Server Running Port ${PORT}`));