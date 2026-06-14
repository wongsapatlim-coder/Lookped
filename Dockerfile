# 1. ใช้ Node.js เวอร์ชัน 20 แบบขนาดเล็กเป็นฐาน
FROM node:20-slim

# 2. ตั้งค่าโฟลเดอร์สำหรับทำงานข้างใน Container
WORKDIR /usr/src/app

# 3. นำเข้าไฟล์ package.json มาก่อน
COPY package*.json ./

# 4. ติดตั้ง Libraries ต่างๆ ตามที่ระบุไว้
RUN npm install

# 5. คัดลอกไฟล์โค้ดทั้งหมดของเราเข้าไป
COPY . .

# 6. เปิด Port 8080 (ค่าเริ่มต้นที่ Cloud Run บังคับใช้)
EXPOSE 8080

# 7. คำสั่งในการรันแอปพลิเคชัน
CMD [ "npm", "start" ]