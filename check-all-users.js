require('dotenv').config();
const mongoose = require('mongoose');

// ใช้ Schema แบบเปิดกว้าง (strict: false) เพื่อดึงข้อมูลออกมาดูให้หมด
const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', userSchema);

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log("🔌 เชื่อมต่อ Database สำเร็จ...");
        console.log("🔍 กำลังค้นหารายชื่อทั้งหมด...");
        
        const users = await User.find({});
        
        if (users.length === 0) {
            console.log("\n⚠️ ไม่พบข้อมูลผู้ใช้เลย (Database ว่างเปล่า)");
            console.log("👉 คำแนะนำ: ให้ไปหน้าเว็บ แล้วกด Register สมัครสมาชิกใหม่ก่อนครับ");
        } else {
            console.log(`\n✅ พบผู้ใช้งานทั้งหมด ${users.length} คน:`);
            console.log("------------------------------------------------");
            users.forEach(u => {
                console.log(`🆔 ID: ${u._id}`);
                console.log(`👤 Name: ${u.name}`);
                console.log(`📧 Email: "${u.email}"`); // ใส่เครื่องหมายคำพูดเพื่อให้เห็นชัดๆ เผื่อมีวรรคเกิน
                console.log(`👑 Role: ${u.role || 'user'}`);
                console.log(`🟢 Active: ${u.isActive}`);
                console.log("------------------------------------------------");
            });
        }
        mongoose.disconnect();
    })
    .catch(err => console.error("❌ Error:", err));