const { createApp, ref, onMounted, computed } = Vue;

const app = createApp({
    setup() {
        const currentView = ref('overview');
        const user = ref({});
        const userPlan = ref({ plan: 'free', expire: null }); // ✅ เก็บสถานะแพ็กเกจ
        const isSidebarOpen = ref(false);
        const settings = ref({
            isBotActive: false,
            stopLossLimit: 0,
            targetRoas: 0,
            profitMargin: 0,
            autoScale: { increasePercent: 20, maxBudget: 5000, whitelistedAds: [], adLimits: {} }
        });

        const adsList = ref([]);
        const logsList = ref([]);
        const adAccountsList = ref([]);
        const facebookPagesList = ref([]);
        const loading = ref(false);
        const announcement = ref(null);
        let chartInstance = null;
        const currentPage = ref(1);
        const itemsPerPage = 25;
        const activeModal = ref(null); 
        
        // ... (ตัวแปรอื่นๆ เหมือนเดิม) ...
        const aiForm = ref({ product: '', tone: 'Hard Sell' }); 
        const aiResult = ref(''); 
        const aiLoading = ref(false);
        const hunterKeyword = ref(''); 
        const interestResults = ref([]); 
        const hunterLoading = ref(false);
        const spyKeyword = ref('');
        const spyLoading = ref(false);
        const spyResults = ref([]);
        const spySearched = ref(false);
        const audienceForm = ref({ pageId: '', country: 'TH' });
        const audienceLoading = ref(false);
        const launcher = ref({ campaignName: '', budget: 1000, caption: '', selectedImage: null, selectedImagePreview: null, selectedAudience: null, targeting: [], pageId: '' });
        const isLaunching = ref(false);
        const imageInput = ref(null);
        const savedAudiences = ref([{ id: 1, name: 'สายแฟชั่น', size: '2.5M' }, { id: 2, name: 'คนชอบแต่งบ้าน', size: '1.2M' }, { id: 3, name: 'CEO', size: '500k' }]);

        const token = localStorage.getItem('quinn_token');
        const adminBackupToken = localStorage.getItem('quinn_admin_backup');
        const isGhostMode = ref(!!adminBackupToken);

        const paginatedAds = computed(() => { const start = (currentPage.value - 1) * itemsPerPage; return adsList.value.slice(start, start + itemsPerPage); });
        const totalStats = computed(() => { const spend = adsList.value.reduce((a, b) => a + (b.spend || 0), 0); return { spend, sales: spend * 3, profit: spend * 1.5, roas: 3.0, fbSpend: spend }; });

        const openModal = (name) => activeModal.value = name;
        const closeModal = () => activeModal.value = null;
        const checkAccess = (platform) => { if (!user.value || user.value.role === 'admin') return true; return (user.value.access || []).includes(platform); };
        const exitGhostMode = () => { if (adminBackupToken) { localStorage.setItem('quinn_token', adminBackupToken); localStorage.removeItem('quinn_admin_backup'); window.location.href = 'admin.html'; } };

        const loadData = async () => {
            if (!token) return window.location.href = 'index.html';
            try {
                try { const configRes = await axios.get('/api/system/config'); user.value = JSON.parse(localStorage.getItem('quinn_user') || '{}'); if (configRes.data?.maintenanceMode && user.value.role !== 'admin') return window.location.href = 'maintenance.html'; } catch(e) {}
                user.value = JSON.parse(localStorage.getItem('quinn_user') || '{}');
                const accessList = user.value.access || [];
                if (currentView.value === 'overview' && accessList.length === 1 && accessList.includes('facebook')) currentView.value = 'facebook';

                const res = await axios.get('/api/me/settings', { headers: { 'Authorization': `Bearer ${token}` } });
                const data = res.data || {};
                
                // ✅ Update Settings & Plan Info
                const loadedSettings = { ...data };
                delete loadedSettings.userPlan; // แยก Plan ออกจาก Settings
                
                if (!loadedSettings.autoScale) loadedSettings.autoScale = { enabled: false, triggerRoas: 4.0, increasePercent: 20, maxBudget: 5000, whitelistedAds: [], adLimits: {} };
                if (!loadedSettings.autoScale.adLimits) loadedSettings.autoScale.adLimits = {};
                if (!loadedSettings.autoScale.whitelistedAds) loadedSettings.autoScale.whitelistedAds = [];
                
                settings.value = loadedSettings;
                if (data.userPlan) {
    userPlan.value = data.userPlan;
} else {
                
                try { const annRes = await axios.get('/api/announcement'); announcement.value = annRes.data.data; } catch(e){}
                if(checkAccess('facebook')) { fetchAdAccounts(); fetchFacebookPages(); }
                loadLogs();
            } catch (e) { if(e.response?.status === 401) logout(); }
        };

        const checkAdsNow = async () => { loading.value = true; try { const res = await axios.get('/api/check-now', { headers: { 'Authorization': `Bearer ${token}` } }); adsList.value = res.data.data || []; updateChart(adsList.value); loadLogs(); } catch(e) { alert(e.message); } finally { loading.value = false; } };
        const toggleAdScale = async (adId) => { if (!settings.value.autoScale.whitelistedAds) settings.value.autoScale.whitelistedAds = []; const index = settings.value.autoScale.whitelistedAds.indexOf(adId); if (index > -1) { settings.value.autoScale.whitelistedAds.splice(index, 1); } else { settings.value.autoScale.whitelistedAds.push(adId); } try { await axios.post('/api/me/settings', settings.value, { headers: { 'Authorization': `Bearer ${token}` } }); } catch(e) {} };
        
        // ✅ เพิ่มการจัดการ Error (เช่น สิทธิ์ไม่ถึง)
        const handleApiError = (e) => {
            const msg = e.response?.data?.message || e.message;
            alert(msg.includes('Upgrade') ? '🔒 ' + msg : '❌ Error: ' + msg);
        };

        const saveSettings = async (alertMsg = true) => { try { await axios.post('/api/me/settings', settings.value, { headers: { 'Authorization': `Bearer ${token}` } }); if(alertMsg) alert('Saved!'); } catch(e){ handleApiError(e); } }; // ใช้ handleApiError
        const connectFacebook = async () => { try { const res = await axios.get('/api/connect-facebook', { headers: { 'Authorization': `Bearer ${token}` } }); window.location.href = res.data.url; } catch(e){} };
        const disconnectFacebook = () => { if(confirm('Disconnect?')) { settings.value.fbToken = ''; settings.value.adAccountId = ''; adAccountsList.value = []; saveSettings(false); alert('Disconnected'); } };
        const logout = () => { if(confirm('Logout?')) { localStorage.clear(); window.location.href = 'index.html'; } };
        
        const fetchAdAccounts = async () => { try { const res = await axios.get('/api/me/adaccounts', { headers: { 'Authorization': `Bearer ${token}` } }); adAccountsList.value = res.data.accounts; if(adAccountsList.value.length === 1) settings.value.adAccountId = adAccountsList.value[0].id; } catch(e){} };
        const fetchFacebookPages = async () => { try { const res = await axios.get('/api/me/pages', { headers: { 'Authorization': `Bearer ${token}` } }); facebookPagesList.value = res.data.pages || []; } catch(e){} };
        const loadLogs = async () => { try { const res = await axios.get('/api/me/logs', { headers: { 'Authorization': `Bearer ${token}` } }); logsList.value = res.data; } catch(e){} };

        const handleImageUpload = (event) => { const file = event.target.files[0]; if (file) { launcher.value.selectedImage = file; launcher.value.selectedImagePreview = URL.createObjectURL(file); } };
        const triggerImageUpload = () => { if(imageInput.value) imageInput.value.click(); };
        
        // ✅ ใช้ handleApiError กับทุกฟังก์ชัน
        const quickGenerateAi = async (tone) => {
            if(!launcher.value.campaignName) { alert('กรุณาใส่ชื่อสินค้าหรือแคมเปญก่อนให้ AI เขียน'); return; }
            aiLoading.value = true;
            try {
                const res = await axios.post('/api/ai/generate-copy', { product: launcher.value.campaignName, tone: tone }, { headers: { 'Authorization': `Bearer ${token}` } });
                launcher.value.caption = res.data.result;
            } catch(e) { handleApiError(e); } finally { aiLoading.value = false; }
        };

        const addInterest = (item) => { const exists = launcher.value.targeting.some(t => t.id === item.id); if (!exists) { launcher.value.targeting.push({ id: item.id, name: item.name }); } };
        const searchInterests = async () => { hunterLoading.value = true; try { const res = await axios.get(`/api/tools/search-interests?q=${hunterKeyword.value}`, { headers: { 'Authorization': `Bearer ${token}` } }); interestResults.value = res.data.data; } catch (e) { alert(e.message); } finally { hunterLoading.value = false; } };

        const searchCompetitors = async () => {
            if (!spyKeyword.value) return;
            spyLoading.value = true;
            spySearched.value = true;
            try {
                // เรียก API จริง (ถ้าเป็น Pro จะผ่าน ถ้าไม่จะติด Error 403)
                const res = await axios.get('/api/tools/search-pages', { headers: { 'Authorization': `Bearer ${token}` } });
                // (Mockup Data ถ้าผ่าน)
                setTimeout(() => {
                    spyResults.value = [
                        { id: 1, name: `คู่แข่ง A (${spyKeyword.value})`, ads_count: 12, link: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=TH&q=' + spyKeyword.value },
                        { id: 2, name: 'ร้านขายดี B', ads_count: 5, link: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=TH&q=' + spyKeyword.value },
                    ];
                    spyLoading.value = false;
                }, 1000);
            } catch (e) { 
                handleApiError(e); // แจ้งเตือนให้ Upgrade
                spyLoading.value = false; 
            }
        };

        const createAudience = async () => {
            audienceLoading.value = true;
            try {
                const res = await axios.post('/api/facebook/audiences/create-lookalike', audienceForm.value, { headers: { 'Authorization': `Bearer ${token}` } });
                alert('✅ ' + res.data.message);
                closeModal();
            } catch (e) { handleApiError(e); } finally { audienceLoading.value = false; }
        };

        const launchCampaign = async () => {
            if (!launcher.value.campaignName || !launcher.value.selectedImage || !launcher.value.pageId) { alert('กรุณากรอกข้อมูลให้ครบ (ชื่อแคมเปญ + รูปภาพ + เพจ)'); return; }
            isLaunching.value = true;
            try {
                const formData = new FormData();
                formData.append('name', launcher.value.campaignName); formData.append('budget', launcher.value.budget); formData.append('caption', launcher.value.caption); formData.append('audience_id', JSON.stringify(launcher.value.targeting)); formData.append('image', launcher.value.selectedImage); formData.append('page_id', launcher.value.pageId);
                const res = await axios.post('/api/launch', formData, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } });
                closeModal(); announcement.value = { isActive: true, message: `🎉 Success! ID: ${res.data.data.campaignId}`, type: 'success' }; setTimeout(() => announcement.value.isActive = false, 5000);
            } catch (e) { handleApiError(e); } finally { isLaunching.value = false; }
        };

        const updateChart = (data) => { const ctx = document.getElementById('spendChart')?.getContext('2d'); if(!ctx) return; if(chartInstance) chartInstance.destroy(); chartInstance = new Chart(ctx, { type: 'bar', data: { labels: data.map(d => d.name.substring(0,10)), datasets: [{ label: 'Spend', data: data.map(d => d.spend), backgroundColor: '#4F46E5' }] } }); };
        const getStatusClass = (s) => s === 'DANGER' ? 'text-red-500' : (s === 'SCALING' ? 'text-indigo-600' : 'text-green-600');
        const formatNumber = (n) => new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(n);

        onMounted(() => loadData());

        return {
            currentView, user, settings, adsList, logsList, adAccountsList, facebookPagesList, loading, announcement, isSidebarOpen,
            paginatedAds, totalStats, activeModal, aiLoading, hunterKeyword, interestResults, hunterLoading,
            openModal, closeModal, checkAdsNow, searchInterests, saveSettings, connectFacebook, disconnectFacebook, logout,
            isGhostMode, exitGhostMode, toggleAdScale, checkAccess, addInterest,
            launcher, isLaunching, savedAudiences, imageInput, handleImageUpload, triggerImageUpload, quickGenerateAi, launchCampaign, getStatusClass, formatNumber,
            spyKeyword, spyLoading, spyResults, spySearched, searchCompetitors,
            audienceForm, audienceLoading, createAudience,
            userPlan // ✅ ส่งออกไปแสดงผล
        };
    }
});

app.mount('#app');