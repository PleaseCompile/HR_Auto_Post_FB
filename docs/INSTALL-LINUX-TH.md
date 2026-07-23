# ติดตั้ง HR Auto บน Linux Desktop

[ศูนย์รวมเอกสาร](README.md) · [ติดตั้ง Windows](INSTALL-WINDOWS-TH.md) · [คู่มือใช้งาน](USER-GUIDE-TH.md) · [แก้ปัญหา](TROUBLESHOOTING-TH.md)

## ขอบเขต

ระบบปัจจุบันเปิด Chromium แบบมีหน้าต่าง (`headless: false`) จึงต้องใช้ Linux Desktop ที่มี graphical session เช่น GNOME, KDE หรือ Xfce ไม่เหมาะกับ Shared Hosting หรือ SSH Server ที่ไม่มี Display

ระบบที่แนะนำ:

- Ubuntu Desktop 22.04/24.04 หรือ Linux Desktop รุ่นที่ Playwright รองรับ
- RAM 8 GB ขึ้นไป; 16–32 GB สำหรับ Hybrid หลายแท็บ
- พื้นที่ว่างอย่างน้อย 2 GB
- Node.js 22 ขึ้นไป
- Git

ตรวจข้อกำหนดระบบล่าสุดที่ [Playwright Browsers](https://playwright.dev/docs/browsers) และติดตั้ง Node.js จาก [Node.js Downloads](https://nodejs.org/en/download)

## Dependencies

```bash
node --version
npm --version
git --version
```

ผลของ Node ต้องเป็น `v22` หรือใหม่กว่า

ติดตั้ง Git บน Ubuntu/Debian เมื่อยังไม่มี:

```bash
sudo apt update
sudo apt install -y git
```

สำหรับ Distribution อื่น ดู [Git for Linux](https://git-scm.com/install/linux)

## Clone และติดตั้ง

```bash
git clone https://github.com/PleaseCompile/HR_Auto_Post_FB.git
cd HR_Auto_Post_FB
npm install
npx playwright install --with-deps chromium
npm run build
npm run check
```

`--with-deps` ติดตั้งทั้ง Chromium และ system packages ที่ Browser ต้องใช้ อาจถามรหัสผ่าน `sudo`

## เปิดระบบ

```bash
chmod +x scripts/start-linux.sh
./scripts/start-linux.sh
```

จากนั้นเปิด <http://127.0.0.1:4173>

เก็บ Terminal ไว้ระหว่างใช้งาน กด `Ctrl+C` เพื่อปิดอย่างปกติ

## Login Facebook ครั้งแรก

1. เปิด HR Auto
2. ไปหน้า `ตั้งค่าและ Session`
3. กดเชื่อมต่อ
4. Login ใน Chromium ที่แอปเปิด
5. ทำ 2FA ด้วยตัวเอง
6. ตรวจสถานะใน HR Auto

Browser Profile อยู่ที่ `data/browser-profile/` ต้องให้สิทธิ์เฉพาะ Linux User ที่รันแอป:

```bash
chmod -R go-rwx data
```

อย่าใช้ `sudo npm start` เพราะจะทำให้ไฟล์ใน `data/` กลายเป็นของ root และ Chromium ไม่ควรรันเป็น root

## ตั้งค่า Environment

```bash
export PORT=4174
export HR_AUTO_DATA_DIR="/srv/hr-auto-data"
export HR_AUTO_TIMEZONE="Asia/Bangkok"
export HR_AUTO_LOCALE="th-TH"
npm start
```

สร้างโฟลเดอร์ข้อมูลและกำหนดเจ้าของก่อน:

```bash
sudo mkdir -p /srv/hr-auto-data
sudo chown -R "$USER":"$USER" /srv/hr-auto-data
chmod 700 /srv/hr-auto-data
```

รายละเอียดเพิ่มเติม: [CONFIGURATION-TH.md](CONFIGURATION-TH.md)

> `.env.example` เป็นตัวอย่างชื่อค่าเท่านั้น แอปปัจจุบันไม่อ่าน `.env` อัตโนมัติ

## กรณี Linux Server ไม่มีหน้าจอ

อย่าเปลี่ยนเป็น Headless แล้วนำไปใช้ทันที เพราะ Workflow ปัจจุบันต้องให้ผู้ใช้ Login ตรวจ Composer และยืนยันโพสต์

ทางเลือก:

- ใช้ Local Linux Desktop เป็น Worker
- ติดตั้ง Desktop + VNC/RDP บน VPS ที่ควบคุมได้
- ใช้แผน Hybrid ที่ [HOSTATOM-HYBRID-PLAN-TH.md](HOSTATOM-HYBRID-PLAN-TH.md)

ห้ามเปิด VNC/RDP หรือ Chrome Debugging Port สู่ Internet โดยไม่มี VPN, Firewall และ Authentication

## อัปเดต

```bash
git status
git pull --ff-only
npm install
npx playwright install --with-deps chromium
npm run build
npm run check
```

สำรองข้อมูลก่อนอัปเดตตาม [BACKUP-RESTORE-TH.md](BACKUP-RESTORE-TH.md)

## ปัญหาติดตั้งแบบเร็ว

### Chromium แจ้ง Missing libraries

```bash
sudo npx playwright install-deps chromium
npx playwright install chromium
```

### `Executable doesn't exist`

```bash
npx playwright install chromium
npx playwright install --list
```

### `No DISPLAY` หรือ Chromium ไม่แสดง

ตรวจ:

```bash
echo "$DISPLAY"
echo "$XDG_SESSION_TYPE"
```

ถ้า `DISPLAY` ว่าง แสดงว่า Terminal ไม่มี graphical session ให้ Login เข้า Desktop แล้วรันจาก Terminal ภายใน Desktop

### Permission denied ใน `data/`

```bash
ls -ld data
sudo chown -R "$USER":"$USER" data
chmod -R go-rwx data
```

ใช้คำสั่ง `chown` เฉพาะโฟลเดอร์ `data` ของโปรเจกต์ที่ตรวจตำแหน่งแล้ว ห้ามรันกับ `/` หรือ Home ทั้งหมด

[ขั้นถัดไป: คู่มือใช้งาน](USER-GUIDE-TH.md)
