const functions = require('@google-cloud/functions-framework');
const express = require('express'); //เปลี่ยนใช้ express สำหรับการทำงานแบบแยกกัน
const line = require('@line/bot-sdk');
const { GoogleAuth } = require('google-auth-library');

const app = express();

// กำหนดค่า Channel Secret และ Access Token จาก Environment Variables
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  discordRegisterUrl: process.env.DISCORD_REGISTER_URL,
  discordLeaveUrl: process.env.DISCORD_LEAVE_URL,
  discordBoardcastUrl: process.env.DISCORD_BOARDCAST_URL,
  discordGVGUrl: process.env.DISCORD_GVG_URL,
};

// สร้าง Client สำหรับส่งข้อความกลับ
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

const tempUserState = {};

//สำคัญมากสำหรับ Cloud Run: ต้องเก็บ rawBody ไว้เช็ก Signature ของ LINE ด้วย
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// ==========================================
// เส้นทางที่ 1: สำหรับรับ Webhook จาก LINE OA
// URL เวลาเอาไปกรอกใน LINE: https://your-cloud-run-url.a.run.app/
// ==========================================
app.post('/', async (req, res) => {
try {
    // Register Cloud Function HTTP
    //functions.http('lookpedWebhook', async (req, res) => {
    // 1. ตรวจสอบความถูกต้องของ Signature (Security)
    const signature = req.headers['x-line-signature'];

    if (!signature || !req.rawBody || !config.channelSecret) {
      console.error('❌ Missing verification data');
      return res.status(400).send('Bad Request');
    }
    
    // สำคัญ: GCP Functions เก็บ raw body ไว้ที่ req.rawBody
    if (!line.validateSignature(req.rawBody, config.channelSecret, signature)) {
        console.error('Invalid signature');
        return res.status(403).send('Invalid signature');
    }

    // 2. วนลูปจัดการ Events ที่เข้ามา (LINE อาจส่งมาหลาย Event พร้อมกัน)
    try {
        const events = req.body?.events;
        if (!events || !Array.isArray(events) || events.length === 0) {
            return res.status(200).send('OK'); 
        }

        await Promise.all(events.map(handleEvent));
        res.status(200).send('OK');
    } catch (err) {
        console.error(err);
        res.status(500).end();
    }
  } catch (err) {
    // 💡 ถ้าพังตรงไหน มันจะมาโผล่ตรงนี้ ไม่ทำให้ Server ดับชั่วงคราว
    console.error('💥 CRASH DETECTED:', err.message);
    res.status(500).send(`Internal Error: ${err.message}`);
  }
});

// ==========================================
// เส้นทางที่ 2: สำหรับให้ Management Web ยิงมาทำ บรอดแคสต์/มัลติแคสต์
// URL เวลายิงจากเว็บ: https://your-cloud-run-url.a.run.app/multicast
// ==========================================
app.post('/multicast', async (req, res) => {
try {    
  const webApiKey = req.headers['x-web-api-key'];
  const SECRET_KEY = process.env.MANAGEMENT_WEB_SECRET;
    let isFlexmessage = false;
    let flexMessage = "";
    let announcer = "Guild Master";
    const announceDate = getThaiFormattedDate();
  //ยังไม่ต้องเช็คสำหรับ boardcast
  //if (!webApiKey || webApiKey !== SECRET_KEY) {
  //  return res.status(401).send('Unauthorized');
  //}

  const { userIds, messageText, isBroadcast } = req.body;

    try {

        flexMessage = generateGuildAnnouncementFlex(messageText, announcer, announceDate);
        isFlexmessage = true;

        const payload = {
            embeds: [
                {
                title: "📢 ระบบส่งข้อความบรอดแคสต์ (LINE/DISCORD Broadcast)",
                color: 15844367, // สีทอง/เหลือง สำหรับการประกาศ (Hex: #F1C40F)
                // ใช้ description ในการโชว์ข้อความยาวๆ จะอ่านง่ายกว่าใส่ใน fields ครับ
                description: `**ข้อความที่ส่งหาทาง LINE/DISCORD:**\n\`\`\`\n${messageText}\n\`\`\``, 
                fields: [
                    { name: "👥 จำนวนผู้รับทั้งหมด", value: `${userIds.length} คน`, inline: true },
                    { name: "🌐 แหล่งที่มา", value: "Management Web", inline: true }
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: "LOOKPED Portal Hub"
                }
                }
            ]
        };

        await sendToDiscord(payload, config.discordBoardcastUrl);

        const botInfo = await client.getBotInfo();
        if (isBroadcast) {
            await client.broadcast({
                messages: [flexMessage]
            });
        } else if (userIds && userIds.length > 0) {
            await client.multicast({
                to: userIds,
                messages: [flexMessage]
            });
        }
        /*
        await client.multicast({
            to: userIds,
            messages: [{ type: 'text', text: messageText }]
        });*/

        return res.status(200).json({ status: 'Success', botName: botInfo.displayName });
    } catch (err) {
        console.error(err);
        return res.status(500).send('Internal Error');
    }
    } catch (err) {
    // 💡 ถ้าพังตรงไหน มันจะมาโผล่ตรงนี้ ไม่ทำให้ Server ดับชั่วงคราว
    console.error('💥 CRASH DETECTED:', err.message);
    res.status(500).send(`Internal Error: ${err.message}`);
  }
});

// ==========================================
// เส้นทางที่ 3: สำหรับให้ Management Web ยิงมาทำ บรอดแคสต์/มัลติแคสต์ GVG
// URL เวลายิงจากเว็บ: https://your-cloud-run-url.a.run.app/gvgmulticast
// ==========================================
app.post('/gvgmulticast', async (req, res) => {
try {    
  const webApiKey = req.headers['x-web-api-key'];
  const SECRET_KEY = process.env.MANAGEMENT_WEB_SECRET;

  //ยังไม่ต้องเช็คสำหรับ boardcast
  //if (!webApiKey || webApiKey !== SECRET_KEY) {
  //  return res.status(401).send('Unauthorized');
  //}

  // ดึงข้อมูลทั้งหมดที่ส่งมาจาก Postman (รวมถึงอาเรย์ teams 40 คนด้วย)
  const { userIds, messageText, teams } = req.body;

    try {
        let discordEmbeds = [];
            if (teams && Array.isArray(teams)) {
            discordEmbeds = teams.map(team => {
                // เรียกใช้ฟังก์ชันของคุณโดยตรง (ส่ง teamName และ partyData เข้าไป)
                return generateDiscordPayload(team.teamName, team.partyData);
            });
        }

        const discordPayload = {
            content: `📢 **[LOOKPED BROADCAST]**\n${messageText}`,
            embeds: discordEmbeds // ใส่ก้อน Embeds (TEAM A และ TEAM B) ที่เจนเสร็จแล้วเข้าไป
        };

        await sendToDiscord(discordPayload, config.discordGVGUrl);

        const botInfo = await client.getBotInfo();
        
        if (userIds && userIds.length > 0) {
            await client.multicast({
                to: userIds,
                messages: [{ type: 'text', text: messageText }]
            });
        }

        return res.status(200).json({ status: 'Success', botName: botInfo.displayName });
    } catch (err) {
        console.error(err);
        return res.status(500).send('Internal Error');
    }
    } catch (err) {
    // 💡 ถ้าพังตรงไหน มันจะมาโผล่ตรงนี้ ไม่ทำให้ Server ดับชั่วงคราว
    console.error('💥 CRASH DETECTED:', err.message);
    res.status(500).send(`Internal Error: ${err.message}`);
  }
});

// ฟังก์ชันแยกจัดการแต่ละ Event
async function handleEvent(event) {
    console.log("มีข้อความเข้าครับ");
    console.log("event.type : " + event.type);
    const userId = event.source.userId;
    console.log("userId:", userId);

    if (event.type === 'message' && event.message.type === 'text') {
        const text = event.message.text;

        // เช็กว่า User คนนี้กำลังอยู่ในสถานะ "รอพิมพ์ชื่อตัวละคร" อยู่หรือเปล่า?
        if (tempUserState[userId] && tempUserState[userId].status === 'WAITING_FOR_CHARNAME') {
            const characterName = text;
            console.log(`Character Name: ${characterName}`);
            tempUserState[userId] = { status: 'WAITING_FOR_USERNAME', uuid: userId, playerName: characterName, userName: '' };
            const flexMessage = generateAskUsernameFlexMessage();
            // ตอบกลับว่าบันทึกสำเร็จ
            return client.replyMessage({
                replyToken: event.replyToken,
                messages: [flexMessage]
            });
        } else if(tempUserState[userId] && tempUserState[userId].status === 'WAITING_FOR_USERNAME'){
            const userName = text;
            const charName = tempUserState[userId].playerName;
            console.log(`UserName: ${userName}`);
            tempUserState[userId] = { status: 'WAITING_FOR_USERNAME', uuid: userId, playerName: charName, userName: userName };

            //Connect to DB for sent user data

            const targetUrl = 'https://lp-guild-management.onrender.com/api/line/register';

            // 2. ข้อมูลที่คุณต้องการส่งไป (payloadRegister)
            const payloadRegister = {
                line_user_id: userId, //for line uuid
                requested_username: userName, //username
                line_display_name : charName //charname
            };

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Secret': `75545a349c9a925210844010912f59df513097c3b990af9b3871740ddc1db6cb` 
                },
                body: JSON.stringify(payloadRegister)
            });

            if (!response.ok) {
                // ตอบกลับว่าบันทึกสำเร็จ
                const flexMessage = generateRegisterErrorFlexMessage();
                return client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [flexMessage]
                });
                //throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('ส่งข้อมูลไป Render สำเร็จ:', data);

            
            // เมื่อบันทึกเสร็จ ต้อง "ล้างสถานะ" ทิ้ง เพื่อให้เขากลับไปเป็นสถานะปกติ
            delete tempUserState[userId];

            //send to Discord
            const payload = {
                embeds: [
                    {
                    title: "📢 สมาชิกใหม่ลงทะเบียนกิลด์ LOOKPEN",
                    color: 65280, // รหัสสีรูปแบบ Decimal (65280 = สีเขียว)
                    fields: [
                        { name: "👤 ชื่อตัวละคร", value: charName, inline: true },
                        { name: "🆔 LINE User ID", value: `\`${userId}\``, inline: true }
                    ],
                    timestamp: new Date().toISOString()
                    }
                ]
            };
            await sendToDiscord(payload, config.discordRegisterUrl);
            const flexMessage = generateRegisterSuccessFlexMessage(charName);
            // ตอบกลับว่าบันทึกสำเร็จ
            return client.replyMessage({
                replyToken: event.replyToken,
                messages: [flexMessage]
            });
        } else {
            return client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: `ขอบคุณที่ส่งข้อความถึงเรา
                
                ต้องขออภัยเป็นอย่างยิ่งที่บัญชีนี้ไม่สามารถตอบข้อความใดๆ ได้
                โปรดรอรับข่าวสารใหม่ๆ จากเราผ่านช่องทางนี้` }]
            });
        }

        // ถ้าพิมพ์ข้อความมาเล่นๆ โดยไม่ได้กด Register ก่อน ก็ปล่อยผ่าน (ไม่ต้องตอบ)
        return Promise.resolve(null);
    }

    // แปลงข้อมูล Postback String (เช่น action=leave&game=ROOC&date=2026-06-04) ให้เป็น Object
    const postbackData = new URLSearchParams(event.postback.data);
    const actionType = postbackData.get('action');
    const game = postbackData.get('game') || 'ROOC';
    let isFlexmessage = false;
    let replyText = "";
    let flexMessage = "";
    console.log("actionType:", actionType);
    // ลอจิกจัดการตามประเภท Action
    if (actionType === 'register') {
        // 💡 เปลี่ยนสถานะของ User คนนี้ให้กลายเป็น "กำลังรอชื่อ"
        tempUserState[userId] = { status: 'WAITING_FOR_CHARNAME', uuid: userId, playerName: '', userName: '' };
        
        flexMessage = generateAskNameFlexMessage();
        isFlexmessage = true;
        // ถามชื่อตัวละครกลับไป
        //replyText = "โปรดกรอกข้อมูลชื่อตัวละครในเกมส์ของคุณ พิมพ์ตอบกลับมาได้เลยครับ";
        
    } else if (actionType === 'leave') {
        const leaveDate = event.postback.params?.date || postbackData.get('date');
        console.log("leave:", leaveDate);

        // สร้าง Flex Message โดยใช้ฟังก์ชันที่เราเพิ่งเขียน
        flexMessage = generateLeaveFlexMessage(leaveDate);
        isFlexmessage = true;

        // TODO: บันทึกวันลาวอลง Database
        //replyText = `บันทึกการลาวอของวันที่ ${leaveDate} เรียบร้อยแล้ว พักผ่อนนะครับ!`;
        /*
        //Query ชื่อตัวละครจาก LINE ID เพื่อแจ้งลา
        const characterName = `Test ระบบ ลาวอ`;

        //send to Discord
        const payload = {
            embeds: [
                {
                title: "🚨 แจ้งขอลาวอร์ (Leave War)",
                color: 16711680,
                fields: [
                    { name: "👤 ชื่อตัวละคร", value: characterName, inline: true },
                    { name: "📅 วันที่ลา", value: leaveDate, inline: true },
                    { name: "🆔 LINE UID", value: `\`${userId}\``, inline: false }
                ],
                timestamp: new Date().toISOString()
                }
            ]
        };
        await sendToDiscord(payload, config.discordLeaveUrl);*/
        
    } else if (actionType === 'cancelleave') {
        const leaveDate = event.postback.params?.date || postbackData.get('date');
        console.log("cancelleave:", leaveDate);

        flexMessage = generateCancelLeaveFlexMessage(leaveDate);
        isFlexmessage = true;
        // TODO: ลบข้อมูลวันลาออกจาก Database
        //replyText = `ยกเลิกการลาวอวันที่ ${leaveDate} สำเร็จ เตรียมลุยเลย!`;
        /*
        //Query ชื่อตัวละครจาก LINE ID เพื่อแจ้งลา
        const characterName = `Test ระบบ ยกเลิกลาวอ`;

        //send to Discord
        const payload = {
            embeds: [
                {
                title: "🛡️ ยกเลิกการลาวอร์ (Cancel Leave)",
                color: 255, // สีแดง
                fields: [
                    { name: "👤 ชื่อตัวละคร", value: characterName, inline: true },
                    { name: "📅 วันที่ยกเลิก", value: leaveDate, inline: true },
                    { name: "🆔 LINE UID", value: `\`${userId}\``, inline: false }
                ],
                timestamp: new Date().toISOString()
                }
            ]
        };
        await sendToDiscord(payload, config.discordLeaveUrl);*/
    } else if (actionType === 'confirm_leave') {
        const leaveDate = event.postback.params?.date || postbackData.get('date');
        //ส่งไป web app
        flexMessage = generateLeaveSuccessFlexMessage(leaveDate);
        isFlexmessage = true;

        const characterName = `Test ระบบ ลาวอ`;
        /*
        //send to Discord
        const payload = {
            embeds: [
                {
                title: "🚨 แจ้งขอลาวอร์ (Leave War)",
                color: 16711680,
                fields: [
                    { name: "👤 ชื่อตัวละคร", value: characterName, inline: true },
                    { name: "📅 วันที่ลา", value: leaveDate, inline: true },
                    { name: "🆔 LINE UID", value: `\`${userId}\``, inline: false }
                ],
                timestamp: new Date().toISOString()
                }
            ]
        };*/

        const KAFRA_ICON = "https://i.pinimg.com/originals/1e/86/e1/1e86e10260f84cb713217d8efba08213.png"; // ไอคอน Kafra หรือ Poring
        const SHIELD_ICON = "https://cdn-icons-png.flaticon.com/512/1055/1055183.png"; // ไอคอนโล่

        const payload = {
            // สามารถตั้งชื่อบอทให้เข้ากับธีมได้ (ถ้า Webhook อนุญาต)
            username: "Kafra System", 
            avatar_url: KAFRA_ICON,
            embeds: [
                {
                    author: {
                        name: "🛡️ GUILD WAR SYSTEM",
                        icon_url: SHIELD_ICON
                    },
                    title: "📜 แจ้งขอลาวอร์ (Leave Request)",
                    description: "มีสมาชิกส่งคำร้องขอลาพักรบ ระบบได้ทำการบันทึกข้อมูลแล้ว",
                    color: 15844367, // สีเหลืองทองแบบ RO (Hex: #F1C40F)
                    thumbnail: {
                        url: KAFRA_ICON // รูปเล็กๆ มุมขวาบน ทำให้ Embed ดูมีมิติ ไม่แบนจนเกินไป
                    },
                    fields: [
                        { 
                            name: "👤 ชื่อตัวละคร", 
                            value: `> **${characterName}**`, // ใช้ > เพื่อเว้นวรรคให้เป็นกรอบอ้างอิงสวยๆ
                            inline: true 
                        },
                        { 
                            name: "📅 วันที่ลา", 
                            value: `> **${leaveDate}**`, 
                            inline: true 
                        },
                        { 
                            name: "🆔 อ้างอิงระบบ (LINE UID)", 
                            // ใช้ || คลุมเพื่อให้เป็น Spoiler (ต้องกดดู) ช่วยให้แชทดูสะอาด และเซฟ Privacy
                            value: `||${userId}||`, 
                            inline: false 
                        }
                    ],
                    footer: {
                        text: "LOOKPED Headquarters • ROO Classic",
                        icon_url: KAFRA_ICON
                    },
                    timestamp: new Date().toISOString()
                }
            ]
        };
        await sendToDiscord(payload, config.discordLeaveUrl);
    } else if (actionType === 'confirm_cancelleave') {
        const leaveDate = event.postback.params?.date || postbackData.get('date');
        //ส่งไป web app
        flexMessage = generateCancelSuccessFlexMessage(leaveDate);
        isFlexmessage = true;

        const characterName = `Test ระบบ ลาวอ`;

        const KAFRA_ICON = "https://i.pinimg.com/originals/1e/86/e1/1e86e10260f84cb713217d8efba08213.png"; 
        const SWORD_ICON = "https://cdn-icons-png.flaticon.com/512/1055/1055183.png"; // เปลี่ยนไอคอนเล็กๆ ด้านบนให้เหมาะกับบริบท (ถ้ามี)

        const payload = {
            username: "Kafra System", 
            avatar_url: KAFRA_ICON,
            embeds: [
                {
                    author: {
                        name: "⚔️ GUILD WAR SYSTEM",
                        icon_url: KAFRA_ICON
                    },
                    title: "🔄 ยกเลิกการลาวอร์ (Cancel Leave Request)",
                    description: "สมาชิกได้ยกเลิกคำร้องขอลาพักรบ และ **พร้อมกลับเข้าสู่สนามรบแล้ว!**",
                    color: 3066993, // สีเขียวสว่าง (Hex: #2ECC71) สื่อถึงการ Active / กลับมาลงวอร์
                    thumbnail: {
                        url: KAFRA_ICON 
                    },
                    fields: [
                        { 
                            name: "👤 ชื่อตัวละคร", 
                            value: `> **${characterName}**`, 
                            inline: true 
                        },
                        { 
                            name: "📅 วันที่ขอยกเลิก", 
                            value: `> **${leaveDate}**`, 
                            inline: true 
                        },
                        { 
                            name: "🆔 อ้างอิงระบบ (LINE UID)", 
                            value: `||${userId}||`, 
                            inline: false 
                        }
                    ],
                    footer: {
                        text: "LOOKPED Headquarters • ROO Classic",
                        icon_url: KAFRA_ICON
                    },
                    timestamp: new Date().toISOString()
                }
            ]
        };
        await sendToDiscord(payload, config.discordLeaveUrl);
    } else if (actionType === 'cancel_process') {
        return;
    } else {
        replyText = "คำสั่งไม่ถูกต้องครับ";
    }

    //console.log("ข้อความที่จะตอบกลับ:", replyText);

    if(isFlexmessage) {
        isFlexmessage = false;
        return client.replyMessage({
            replyToken: event.replyToken,
            messages: [flexMessage]
        });
    } else {
        return client.replyMessage({
            replyToken: event.replyToken,
            messages: [
            {
                type: 'text',
                text: replyText
            }
            ]
        });
    }
    // ให้ console.log แทน เพื่อดูว่าลอจิกทำงานถูกต้องไหม
    //console.log("ข้อความที่จะตอบกลับ:", replyText);
    //return Promise.resolve(null);
}

// ฟังก์ชันส่งข้อความเข้า Discord
async function sendToDiscord(payload, discordUrl) {
  try {
    await fetch(discordUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log("ส่งข้อความไป Discord สำเร็จ!");
  } catch (error) {
    console.error("ส่งไป Discord ล้มเหลว:", error);
  }
}

functions.http('lookpedWebhook', app);

function generateDiscordPayload(teamName, partyData) {
  // partyData คือ Array ของปาร์ตี้ เช่น [{ name: "Party 1", members: [...] }]
  
  const fields = partyData.map(party => {
    // วนลูปจัดรูปแบบรายชื่อสมาชิกในปาร์ตี้นั้นๆ
    const memberLines = party.members.map((m, index) => {
      const remarkStr = m.remark ? ` \`${m.remark}\`` : '';
      return `${index + 1}. **${m.name}** (${m.job})${remarkStr}`;
    }).join('\n');

    return {
      name: `🔰 ${party.name}`,
      value: memberLines,
      inline: false
    };
  });

  // คืนค่ากลับไปเป็น Embed 1 ทีม (เช่น Team A หรือ Team B)
  return {
    title: `⚔️ สนามหลัก ${teamName}`,
    color: teamName.includes('A') ? 3447003 : 15158332, // Team A สีน้ำเงิน, Team B สีแดง
    fields: fields,
    timestamp: new Date().toISOString()
  };
}

function generateLeaveFlexMessage(leaveDate) {
  // รีเทิร์นออบเจ็กต์สำหรับนำไปใช้เป็นข้อความตอบกลับของ LINE (Message Object)
  return {
    type: "flex",
    altText: `กรุณายืนยันการแจ้งขอลาวอร์วันที่ ${leaveDate}`, // ข้อความแจ้งเตือนที่ขึ้นบน Notifications
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#233554",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "🛡️ GUILD SYSTEM",
                color: "#FCE68E",
                weight: "bold",
                size: "xs",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#5273A5"
          },
          {
            type: "text",
            text: "คำร้องขอลาวอร์",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            backgroundColor: "#152238",
            cornerRadius: "md",
            paddingAll: "12px",
            contents: [
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                contents: [
                  {
                    type: "text",
                    text: "วันที่ลา :",
                    color: "#88A3C9",
                    size: "sm",
                    flex: 2
                  },
                  {
                    type: "text",
                    text: leaveDate, // <-- แทรกตัวแปรวันที่ตรงนี้
                    wrap: true,
                    color: "#FCE68E",
                    size: "md",
                    flex: 4,
                    weight: "bold"
                  }
                ]
              },
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "สถานะ :",
                    color: "#88A3C9",
                    size: "sm",
                    flex: 2
                  },
                  {
                    type: "text",
                    text: "รอการยืนยัน",
                    wrap: true,
                    color: "#4ADE80",
                    size: "sm",
                    flex: 4,
                    weight: "bold"
                  }
                ]
              }
            ]
          },
          {
            type: "text",
            text: "* หากยืนยันแล้ว ระบบจะแจ้งเตือนไปยังหัวหน้ากิลด์",
            color: "#88A3C9",
            size: "xxs",
            align: "center",
            margin: "md"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        backgroundColor: "#233554",
        paddingStart: "20px",
        paddingEnd: "20px",
        paddingBottom: "20px",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#426496",
            action: {
              type: "postback",
              label: "⭕ ยืนยัน",
              data: `action=confirm_leave&date=${leaveDate}`, // <-- แทรกตัวแปรวันที่ลงใน Payload ของ Postback
              displayText: "ยืนยันการลาวอร์"
            }
          },
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#8A3A3A",
            action: {
              type: "postback",
              label: "❌ ยกเลิก",
              data: "action=cancel_process",
              displayText: "ยกเลิกรายการ"
            }
          }
        ]
      }
    }
  };
}

function generateCancelLeaveFlexMessage(cancelDate) {
  return {
    type: "flex",
    altText: `กรุณายืนยันการยกเลิกการลาวอร์วันที่ ${cancelDate}`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#3D2B3D",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "🛡️ GUILD SYSTEM",
                color: "#FCE68E",
                weight: "bold",
                size: "xs",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#805470"
          },
          {
            type: "text",
            text: "ขอยกเลิกการลาวอร์",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            backgroundColor: "#241724",
            cornerRadius: "md",
            paddingAll: "12px",
            contents: [
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                contents: [
                  {
                    type: "text",
                    text: "วันที่ยกเลิก :",
                    color: "#C59CB6",
                    size: "sm",
                    flex: 4 // <-- ปรับเพิ่มพื้นที่ฝั่งซ้ายให้กว้างขึ้น จะได้ไม่โดนตัด
                  },
                  {
                    type: "text",
                    text: cancelDate, 
                    wrap: true,
                    color: "#FCE68E",
                    size: "md",
                    flex: 5, // <-- ปรับสัดส่วนฝั่งขวาให้สมดุลกัน
                    weight: "bold"
                  }
                ]
              },
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "สถานะ :",
                    color: "#C59CB6",
                    size: "sm",
                    flex: 4 // <-- ปรับให้ตรงกับด้านบน
                  },
                  {
                    type: "text",
                    text: "รอการยกเลิก",
                    wrap: true,
                    color: "#FCA5A5",
                    size: "sm",
                    flex: 5, // <-- ปรับให้ตรงกับด้านบน
                    weight: "bold"
                  }
                ]
              }
            ]
          },
          {
            type: "text",
            text: "* หากยืนยันแล้ว รายชื่อคุณจะถูกนำกลับเข้าสู่ปาร์ตี้วอร์",
            color: "#C59CB6",
            size: "xxs",
            align: "center",
            margin: "md",
            wrap: true // <-- เพิ่มคำสั่งนี้ เพื่อให้ข้อความยาวๆ ปัดตกขึ้นบรรทัดใหม่ได้
          }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        backgroundColor: "#3D2B3D",
        paddingStart: "20px",
        paddingEnd: "20px",
        paddingBottom: "20px",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#8A3A3A",
            action: {
              type: "postback",
              label: "⭕ ยืนยัน", // <-- ลดคำว่า "ยกเลิก" ออกเพื่อให้พอดีกับกรอบปุ่ม
              data: `action=confirm_cancelleave&date=${cancelDate}`,
              displayText: "ยืนยันยกเลิกการลาวอร์"
            }
          },
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#5C4A5C",
            action: {
              type: "postback",
              label: "❌ ปิด",
              data: "action=cancel_process",
              displayText: "ยกเลิกรายการ"
            }
          }
        ]
      }
    }
  };
}

function generateLeaveSuccessFlexMessage(leaveDate) {
  return {
    type: "flex",
    altText: `บันทึกการลาวอร์วันที่ ${leaveDate} สำเร็จ`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#233554",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "🛡️ GUILD SYSTEM",
                color: "#FCE68E",
                weight: "bold",
                size: "xs",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#5273A5"
          },
          {
            type: "text",
            text: "✅ บันทึกการลาสำเร็จ",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            backgroundColor: "#152238",
            cornerRadius: "md",
            paddingAll: "12px",
            contents: [
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                contents: [
                  {
                    type: "text",
                    text: "วันที่ลา :",
                    color: "#88A3C9",
                    size: "sm",
                    flex: 4
                  },
                  {
                    type: "text",
                    text: leaveDate, // แทรกตัวแปรวันที่
                    wrap: true,
                    color: "#FCE68E",
                    size: "md",
                    flex: 5,
                    weight: "bold"
                  }
                ]
              },
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "สถานะ :",
                    color: "#88A3C9",
                    size: "sm",
                    flex: 4
                  },
                  {
                    type: "text",
                    text: "บันทึกข้อมูลแล้ว",
                    wrap: true,
                    color: "#4ADE80",
                    size: "sm",
                    flex: 5,
                    weight: "bold"
                  }
                ]
              }
            ]
          },
          {
            type: "text",
            text: "* ระบบได้แจ้งเตือนหัวหน้ากิลด์แล้ว ขอให้พักผ่อนอย่างเต็มที่ เจอกันวอร์หน้านะ!",
            color: "#88A3C9",
            size: "xxs",
            align: "center",
            margin: "md",
            wrap: true
          }
        ]
      }
    }
  };
}

function generateCancelSuccessFlexMessage(cancelDate) {
  return {
    type: "flex",
    altText: `ยกเลิกการลาวอร์วันที่ ${cancelDate} สำเร็จ`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#3D2B3D",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "🛡️ GUILD SYSTEM",
                color: "#FCE68E",
                weight: "bold",
                size: "xs",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#805470"
          },
          {
            type: "text",
            text: "✅ ยกเลิกการลาสำเร็จ",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "lg",
            wrap: true,
            adjustMode: "shrink-to-fit"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            backgroundColor: "#241724",
            cornerRadius: "md",
            paddingAll: "12px",
            contents: [
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                contents: [
                  {
                    type: "text",
                    text: "วันที่ :",
                    color: "#C59CB6",
                    size: "sm",
                    flex: 4
                  },
                  {
                    type: "text",
                    text: cancelDate, // แทรกตัวแปรวันที่
                    wrap: true,
                    color: "#FCE68E",
                    size: "md",
                    flex: 5,
                    weight: "bold"
                  }
                ]
              },
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "สถานะ :",
                    color: "#C59CB6",
                    size: "sm",
                    flex: 4
                  },
                  {
                    type: "text",
                    text: "คืนสิทธิ์ลงวอร์",
                    wrap: true,
                    color: "#4ADE80",
                    size: "sm",
                    flex: 5,
                    weight: "bold"
                  }
                ]
              }
            ]
          },
          {
            type: "text",
            text: "* รายชื่อของคุณถูกนำกลับเข้าปาร์ตี้เรียบร้อยแล้ว เตรียมตัวลุย!",
            color: "#C59CB6",
            size: "xxs",
            align: "center",
            margin: "md",
            wrap: true
          }
        ]
      }
    }
  };
}

function generateGuildAnnouncementFlex(message, announcer, announceDate) {
  return {
    type: "flex",
    altText: `📢 ประกาศ: แจ้งเตือน`, // ยังคงใช้ topic สำหรับแจ้งเตือนบนหน้าจอมือถือ
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#152238",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "👑 GUILD ANNOUNCEMENT",
                color: "#FCE68E",
                weight: "bold",
                size: "sm",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#5273A5"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            backgroundColor: "#1E2E4A",
            cornerRadius: "md",
            paddingAll: "16px",
            contents: [
              {
                type: "text",
                text: message, // แสดงข้อความประกาศตรงนี้เลย
                color: "#FFFFFF",
                size: "sm",
                wrap: true,
                weight: "regular"
              }
            ]
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            spacing: "sm",
            contents: [
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                contents: [
                  {
                    type: "text",
                    text: "ผู้ประกาศ :",
                    color: "#88A3C9",
                    size: "xs",
                    flex: 3
                  },
                  {
                    type: "text",
                    text: announcer,
                    wrap: true,
                    color: "#FCE68E",
                    size: "xs",
                    flex: 7,
                    weight: "bold"
                  }
                ]
              },
              {
                type: "box",
                layout: "baseline",
                spacing: "sm",
                contents: [
                  {
                    type: "text",
                    text: "วันเวลา :",
                    color: "#88A3C9",
                    size: "xs",
                    flex: 3
                  },
                  {
                    type: "text",
                    text: announceDate,
                    wrap: true,
                    color: "#88A3C9",
                    size: "xs",
                    flex: 7
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  };
}

function getThaiFormattedDate() {
  const now = new Date();
  
  // แปลงค่าเวลาให้เป็นโซนไทย (GMT+7) เสมอ ไม่ว่า Server จะอยู่ที่ไหนในโลก
  const thaiTimeStr = now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" });

  const date = new Date(thaiTimeStr);
  
  // จัดการวันที่ (เติม 0 ด้านหน้าถ้าเป็นเลขหลักเดียว)
  const day = String(date.getDate()).padStart(2, '0');
  
  // อาร์เรย์ชื่อเดือนภาษาไทยแบบย่อ
  const thaiMonths = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
  ];
  const month = thaiMonths[date.getMonth()];
  
  // จัดการปี ค.ศ.
  const year = date.getFullYear();
  
  // จัดการเวลา (ชั่วโมงและนาที เติม 0 ด้านหน้าถ้าเป็นเลขหลักเดียว)
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  // นำมารวมกันตามรูปแบบที่ต้องการ
  return `${day} ${month} ${year} ${hours}:${minutes} น.`;
}

function generateAskNameFlexMessage() {
  return {
    type: "flex",
    altText: "โปรดระบุชื่อตัวละครในเกมของคุณ",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#152238",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "📝 REGISTRATION",
                color: "#FCE68E",
                weight: "bold",
                size: "xs",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#5273A5"
          },
          {
            type: "text",
            text: "ระบุชื่อตัวละคร",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            backgroundColor: "#1E2E4A",
            cornerRadius: "md",
            paddingAll: "16px",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: "โปรดกรอกข้อมูลชื่อตัวละคร\nในเกมของคุณ",
                color: "#E2E8F0",
                size: "sm",
                wrap: true,
                align: "center",
                weight: "bold"
              },
              {
                type: "text",
                text: "พิมพ์ตอบกลับมาในแชทนี้\nได้เลยครับ ⌨️",
                color: "#FCE68E",
                size: "sm",
                wrap: true,
                align: "center",
                weight: "bold"
              }
            ]
          }
        ]
      }
    }
  };
}

function generateAskUsernameFlexMessage() {
  return {
    type: "flex",
    altText: "โปรดระบุ Username สำหรับลงทะเบียน",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#152238",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "📝 REGISTRATION",
                color: "#FCE68E",
                weight: "bold",
                size: "xs",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#5273A5"
          },
          {
            type: "text",
            text: "ระบุ Username",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            backgroundColor: "#1E2E4A",
            cornerRadius: "md",
            paddingAll: "16px",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: "โปรดกรอกข้อมูล Username\nสำหรับ Login LOOKPED Portal Hub",
                color: "#E2E8F0",
                size: "sm",
                wrap: true,
                align: "center",
                weight: "bold"
              },
              {
                type: "text",
                text: "พิมพ์ตอบกลับมาในแชทนี้\nได้เลยครับ ⌨️",
                color: "#FCE68E",
                size: "sm",
                wrap: true,
                align: "center",
                weight: "bold"
              }
            ]
          }
        ]
      }
    }
  };
}

function generateRegisterSuccessFlexMessage(charName) {
  return {
    type: "flex",
    altText: `ลงทะเบียนตัวละคร ${charName} สำเร็จ โปรดรอการอนุมัติ`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#152238",
        paddingAll: "lg",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "✅ SUCCESSFUL",
                color: "#4ADE80",
                weight: "bold",
                size: "xs",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#5273A5"
          },
          {
            type: "text",
            text: "ลงทะเบียนสำเร็จ",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            backgroundColor: "#1E2E4A",
            cornerRadius: "md",
            paddingAll: "md",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: "บันทึกตัวละครชื่อ",
                color: "#E2E8F0",
                size: "sm",
                align: "center",
                wrap: true
              },
              {
                type: "text",
                text: `"${charName}"`, // แทรกตัวแปรชื่อที่ผู้ใช้พิมพ์เข้ามา
                color: "#FCE68E",
                size: "md",
                weight: "bold",
                align: "center",
                wrap: true
              },
              {
                type: "text",
                text: "เพื่อขอเข้าร่วมกิลด์เรียบร้อยแล้ว\nโปรดรอการอนุมัติจาก Admin ครับ ⏳",
                color: "#4ADE80",
                size: "sm",
                wrap: true,
                align: "center",
                weight: "bold"
              }
            ]
          }
        ]
      }
    }
  };
}

function generateRegisterErrorFlexMessage() {
  return {
    type: "flex",
    altText: "เกิดข้อผิดพลาดในการลงทะเบียน โปรดติดต่อ Admin",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#152238",
        paddingAll: "lg",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "❌ SYSTEM ERROR",
                color: "#F87171",
                weight: "bold",
                size: "xs",
                align: "center"
              }
            ]
          },
          {
            type: "separator",
            margin: "md",
            color: "#5273A5"
          },
          {
            type: "text",
            text: "เกิดข้อผิดพลาด",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "lg"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            backgroundColor: "#1E2E4A",
            cornerRadius: "md",
            paddingAll: "md",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: "เกิดปัญหาขัดข้องบางประการ\nทำให้สมัครสมาชิกไม่สำเร็จครับ",
                color: "#E2E8F0",
                size: "sm",
                align: "center",
                wrap: true
              },
              {
                type: "text",
                text: "โปรดลองทำรายการใหม่อีกครั้ง\nหรือแคปหน้าจอนี้แจ้ง Admin ครับ 🛠️",
                color: "#FCE68E",
                size: "sm",
                wrap: true,
                align: "center",
                weight: "bold"
              }
            ]
          }
        ]
      }
    }
  };
}