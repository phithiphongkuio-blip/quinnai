require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  console.log("กำลังเช็ครายชื่อโมเดล...");
  try {
    // โค้ดสำหรับเช็คโมเดล (Hack วิธีเช็คโดยการลองเรียกตัวมาตรฐาน)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Test");
    console.log("✅ เย้! gemini-1.5-flash ใช้ได้ครับ!");
  } catch (error) {
    console.log("❌ Error:", error.message);
    console.log("--------------------------------");
    console.log("ลองเปลี่ยนชื่อโมเดลใน server.js เป็น: gemini-1.0-pro ดูครับ");
  }
}

listModels();