require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// 👇👇👇 แก้ไขตรงนี้เป็นอีเมลของคุณ 👇👇👇
const TARGET_EMAIL = 'phithiphong_k@yahoo.com'; 
const NEW_PASSWORD = '02Ea2423'; // รหัสผ่านใหม่ที่จะใช้
// 👆👆👆

const userSchema = new mongoose.Schema({ 
    name: String, 
    email: String, 
    password: String, 
    role: String, 
    isActive: Boolean 
}, { strict: false });

const User = mongoose.model('User', userSchema);

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log("🔌 Connecting to DB...");
        
        const user = await User.findOne({ email: TARGET_EMAIL });
        
        if (user) {
            console.log(`👤 Found user: ${user.name}`);
            
            // 1. แก้สถานะ
            user.isActive = true;
            user.role = 'admin';
            
            // 2. รีเซ็ตรหัสผ่านใหม่ (เข้ารหัสด้วย)
            const hashedPassword = await bcrypt.hash(NEW_PASSWORD, 10);
            user.password = hashedPassword;

            await user.save();
            console.log("------------------------------------------------");
            console.log(`✅ ซ่อมบัญชีสำเร็จ!`);
            console.log(`📧 Email: ${TARGET_EMAIL}`);
            console.log(`🔑 Pass : ${NEW_PASSWORD}`);
            console.log(`👑 Role : ADMIN`);
            console.log("------------------------------------------------");
            console.log("👉 ลอง Login ใหม่ได้เลยครับ!");
        } else {
            console.log(`❌ หาอีเมล ${TARGET_EMAIL} ไม่เจอครับ (ลองเช็คตัวสะกดดูครับ)`);
        }
        
        mongoose.disconnect();
    })
    .catch(err => console.error("❌ DB Error:", err));