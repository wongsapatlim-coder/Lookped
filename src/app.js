const express = require('express');
const errorHandler = require('./middleware/errorHandler');
const webhookRouter = require('./routes/webhook');
const multicastRouter = require('./routes/multicast');
const gvgMulticastRouter = require('./routes/gvgMulticast');
const pushRouter = require('./routes/push');

const app = express();

//สำคัญมากสำหรับ Cloud Run: ต้องเก็บ rawBody ไว้เช็ก Signature ของ LINE ด้วย
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// ติดตั้งเส้นทางต่างๆ (mount ตาม path เดิม)
app.use('/multicast', multicastRouter);
app.use('/gvgmulticast', gvgMulticastRouter);
app.use('/push', pushRouter);
app.use('/', webhookRouter);

// ตัวจัดการ error กลาง ต้องอยู่ท้ายสุดเสมอ
app.use(errorHandler);

module.exports = app;
