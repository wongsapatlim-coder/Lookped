const config = require('../config');

// ปลายทาง API ของระบบจัดการกิลด์ สำหรับลงทะเบียนผู้ใช้จาก LINE (ตั้งผ่าน NEXT_PUBLIC_API_URL)
const REGISTER_URL = `${config.backendApiUrl}/api/line/register`;

// ส่งข้อมูลผู้ใช้ไปลงทะเบียนที่ระบบ Render
// คืนค่าเป็น Response object เพื่อให้ผู้เรียกเช็ก response.ok / อ่าน body เองได้
async function registerUser({ lineUserId, requestedUsername, lineDisplayName }) {
  const payloadRegister = {
    line_user_id: lineUserId,            // for line uuid
    requested_username: requestedUsername, // username
    line_display_name: lineDisplayName,    // charname
  };

  return fetch(REGISTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': config.internalSecret,
    },
    body: JSON.stringify(payloadRegister),
  });
}

module.exports = { registerUser };
