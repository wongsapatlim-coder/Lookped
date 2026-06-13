const express = require('express');
const client = require('../lineClient');
const config = require('../config');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// ==========================================
// เส้นทาง /push : ประตูส่งข้อความ LINE กลางสำหรับ Backend (Render)
// Backend ยิงมาที่นี่แทนการเรียก LINE API เอง บอทจึงเป็นที่เดียวที่ถือ
// channel access token. ป้องกันด้วย shared-secret (X-Internal-Secret)
// Body: { to: ["Uxxx", ...], messages: [ <LINE message object>, ... ] }
// ==========================================
router.post('/', asyncHandler(async (req, res) => {
  // ตรวจ shared-secret (บังคับ — เพราะเส้นนี้ส่งข้อมูลสำคัญ เช่น รหัสผ่านชั่วคราว)
  const provided = req.headers['x-internal-secret'];
  if (!config.internalSecret || provided !== config.internalSecret) {
    return res.status(401).json({ status: 'Unauthorized' });
  }

  const { to, messages } = req.body || {};
  if (!Array.isArray(to) || to.length === 0 || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ status: 'Bad Request', error: 'to[] and messages[] are required' });
  }

  try {
    if (to.length === 1) {
      await client.pushMessage({ to: to[0], messages });
    } else {
      await client.multicast({ to, messages });
    }
    return res.status(200).json({ status: 'Success', recipients: to.length });
  } catch (err) {
    console.error('push failed:', err);
    return res.status(502).json({ status: 'Error' });
  }
}));

module.exports = router;
