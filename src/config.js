// รวมค่า Environment Variables ทั้งหมดไว้ที่เดียว (Centralized config)
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  discordRegisterUrl: process.env.DISCORD_REGISTER_URL,
  discordLeaveUrl: process.env.DISCORD_LEAVE_URL,
  discordBoardcastUrl: process.env.DISCORD_BOARDCAST_URL,
  discordGVGUrl: process.env.DISCORD_GVG_URL,
  // ความลับสำหรับยืนยันตัวตนกับ Management Web และ Render API
  managementWebSecret: process.env.MANAGEMENT_WEB_SECRET,
  internalSecret: process.env.LP_INTERNAL_SECRET,
  // Base URL ของระบบจัดการกิลด์ (ตั้งผ่าน NEXT_PUBLIC_API_URL) — ตัด trailing slash กันเป็น //api
  backendApiUrl: (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, ''),
};

module.exports = config;
