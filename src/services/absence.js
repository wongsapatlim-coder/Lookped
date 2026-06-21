const config = require('../config');

// ปลายทาง API ของระบบจัดการกิลด์ สำหรับแจ้งลา/ยกเลิกลาของสมาชิกจาก LINE (ตั้งผ่าน NEXT_PUBLIC_API_URL)
const ABSENCE_URL = `${config.backendApiUrl}/api/line/absence`;

// แจ้งลา (absent) หรือยกเลิกการลา (unabsent) ของสมาชิกหนึ่งคนสำหรับวันเดียว
// ระบบหลังบ้านจะ resolve สมาชิกจาก line_user_id เอง (ฝั่ง LINE ไม่ต้องรู้ UUID)
// คืนค่าเป็น Response object เพื่อให้ผู้เรียกเช็ก response.ok / อ่าน body เองได้
async function setAbsence({ lineUserId, date, action }) {
  const payload = {
    line_user_id: lineUserId, // LINE user id (ระบบหลังบ้านแปลงเป็นสมาชิกเอง)
    date,                     // YYYY-MM-DD
    action,                   // 'absent' | 'unabsent'
  };

  return fetch(ABSENCE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': config.internalSecret,
    },
    body: JSON.stringify(payload),
  });
}

module.exports = { setAbsence };
