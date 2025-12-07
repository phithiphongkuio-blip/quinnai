require('dotenv').config();
const mongoose = require('mongoose');

// เปลี่ยนอีเมลตรงนี้เป็นอีเมลที่คุณใช้สมัครสมาชิก
const TARGET_EMAIL = 'Phithiphong_k@yahoo.com'; 

const userSchema = new mongoose.Schema({ email: String, role: String }, { strict: false });
const User = mongoose.model('User', userSchema);

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log("Connected to DB...");
        const user = await User.findOne({ email: TARGET_EMAIL });
        if (user) {
            user.role = 'admin';
            await user.save();
            console.log(`✅ Success! ${TARGET_EMAIL} is now an ADMIN.`);
        } else {
            console.log(`❌ User not found: ${TARGET_EMAIL}`);
        }
        mongoose.disconnect();
    })
    .catch(err => console.error(err));