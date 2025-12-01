require('dotenv').config();
const axios = require('axios');

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.log("❌ ไม่พบ GEMINI_API_KEY ในไฟล์ .env");
        return;
    }

    console.log("🔍 กำลังตรวจสอบรายชื่อโมเดลที่ใช้ได้...");
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    try {
        const res = await axios.get(url);
        console.log("\n✅ รายชื่อโมเดลที่คุณใช้ได้ชัวร์ 100% :");
        console.log("--------------------------------------");
        
        let found = false;
        res.data.models.forEach(m => {
            // คัดเฉพาะตัวที่ใช้ Gen ข้อความได้
            if(m.supportedGenerationMethods.includes('generateContent')) {
                // ตัดคำว่า models/ ออกเพื่อให้ก๊อปไปใช้ง่ายๆ
                const modelName = m.name.replace('models/', '');
                console.log(`👉 "${modelName}"`);
                found = true;
            }
        });

        if (!found) console.log("⚠️ ไม่พบโมเดลสำหรับ Gen ข้อความ (อาจต้องสร้าง Key ใหม่)");

    } catch (error) {
        console.error("❌ Error:", error.response ? error.response.data : error.message);
    }
}

listModels();