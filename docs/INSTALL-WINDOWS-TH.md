# ติดตั้ง HR Auto บน Windows

[ศูนย์รวมเอกสาร](README.md) · [ติดตั้ง Linux](INSTALL-LINUX-TH.md) · [คู่มือใช้งาน](USER-GUIDE-TH.md) · [แก้ปัญหา](TROUBLESHOOTING-TH.md)

## เครื่องที่รองรับ

- Windows 10 หรือ Windows 11 แบบ Desktop
- RAM 8 GB ขึ้นไป; ถ้าใช้ Hybrid หลายแท็บแนะนำ 16–32 GB
- พื้นที่ว่างอย่างน้อย 2 GB สำหรับ Node modules, Chromium และข้อมูลเริ่มต้น
- อินเทอร์เน็ตที่เปิด Facebook และดาวน์โหลด Chromium ได้
- บัญชี Windows ส่วนตัวที่ตั้งรหัสผ่านและไม่ใช้ร่วมกับบุคคลอื่น

## Dependencies

| รายการ | จำเป็น | ตรวจสอบ |
|---|---|---|
| Node.js 22 ขึ้นไป | จำเป็น | `node --version` |
| npm | ติดมากับ Node.js | `npm --version` |
| Git for Windows | จำเป็นเมื่อ Clone/Update ด้วย Git | `git --version` |
| Chromium ของ Playwright | จำเป็น | `npx playwright install --list` |
| PowerShell | มีใน Windows | `$PSVersionTable.PSVersion` |

ดาวน์โหลดจากแหล่งทางการ:

- [Node.js](https://nodejs.org/en/download)
- [Git for Windows](https://git-scm.com/install/windows)
- [Playwright browser installation](https://playwright.dev/docs/browsers)

## วิธี A — Clone ด้วย Git

เปิด PowerShell ในโฟลเดอร์ที่ต้องการเก็บโปรเจกต์:

```powershell
git clone https://github.com/PleaseCompile/HR_Auto_Post_FB.git
Set-Location .\HR_Auto_Post_FB
```

## วิธี B — ดาวน์โหลด ZIP

1. เปิดหน้า GitHub ของโครงการ
2. กด `Code` → `Download ZIP`
3. แตกไฟล์ไปยังโฟลเดอร์ที่ชื่อสั้นและไม่มีสิทธิ์พิเศษ เช่น `D:\Apps\HR-Auto`
4. เปิด PowerShell ในโฟลเดอร์นั้น

วิธี ZIP ใช้งานได้ แต่การอัปเดตครั้งต่อไปต้องดาวน์โหลดใหม่ด้วยตนเอง

## ติดตั้งครั้งแรก

```powershell
npm install
npm run install-browser
npm run build
```

ตรวจว่า TypeScript ผ่าน:

```powershell
npm run check
```

## เปิดระบบ

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

สคริปต์จะ:

1. เปลี่ยนตำแหน่งไปยังโฟลเดอร์โครงการ
2. ตรวจ Node.js
3. ตรวจว่ามี HR Auto ที่ตอบสนองปกติอยู่แล้วหรือไม่ เพื่อป้องกันการรัน Node ซ้อน
4. ติดตั้ง dependencies เมื่อยังไม่มี `node_modules`
5. Build โค้ดล่าสุด
6. เริ่มเซิร์ฟเวอร์ รอ `/api/health` และเปิด <http://127.0.0.1:4173> เมื่อพร้อมจริง

เก็บหน้าต่าง PowerShell ไว้ตลอดเวลาที่ใช้งาน กด `Ctrl+C` เพื่อปิดอย่างปกติ

## Login Facebook ครั้งแรก

1. เปิด HR Auto
2. ไปหน้า `ตั้งค่าและ Session`
3. กดเชื่อมต่อ Facebook
4. ระบบเปิด Chromium โปรไฟล์เฉพาะของแอป
5. Login และกรอก 2FA ด้วยตัวเอง
6. ตรวจชื่อบัญชีและหน้า Facebook
7. กลับ HR Auto และตรวจว่าสถานะพร้อมใช้งาน

ห้ามส่งโฟลเดอร์ `data/browser-profile/` ให้ผู้อื่น เพราะทำหน้าที่เสมือน Session ที่ Login แล้ว

## ตั้งค่า Port หรือที่เก็บข้อมูลชั่วคราว

PowerShell:

```powershell
$env:PORT="4174"
$env:HR_AUTO_DATA_DIR="D:\HR-Auto-Data"
$env:HR_AUTO_TIMEZONE="Asia/Bangkok"
$env:HR_AUTO_LOCALE="th-TH"
npm start
```

ค่าดังกล่าวมีผลเฉพาะหน้าต่าง PowerShell ปัจจุบัน รายละเอียดอยู่ที่ [CONFIGURATION-TH.md](CONFIGURATION-TH.md)

> `.env.example` เป็นรายการตัวอย่างเท่านั้น แอปปัจจุบันยังไม่โหลด `.env` อัตโนมัติ ต้องกำหนด Environment Variable ใน Shell ก่อน `npm start`

## อัปเดตเมื่อใช้ Git

ก่อนอัปเดต:

1. ปิดคิว
2. ปิด Browser Session จาก HR Auto
3. กด `Ctrl+C`
4. สำรอง `data/` ตาม [BACKUP-RESTORE-TH.md](BACKUP-RESTORE-TH.md)

จากนั้น:

```powershell
git status
git pull --ff-only
npm install
npm run install-browser
npm run build
npm run check
```

Playwright แต่ละเวอร์ชันใช้ Browser Binary ที่ตรงกัน จึงควรรัน `npm run install-browser` หลังอัปเดต dependencies

## ถอนการติดตั้ง

1. ปิดระบบและ Browser Session
2. สำรอง `data/` หากต้องการเก็บงาน
3. ลบโฟลเดอร์โปรเจกต์
4. ถ้าต้องการลบ Browser Binary ของ Playwright ทั้งเครื่อง:

```powershell
npx playwright uninstall --all
```

อย่าลบ `data/` ก่อนตรวจ Backup เพราะมีฐานข้อมูล รูป Draft หลักฐาน และ Facebook Session

## ปัญหาติดตั้งแบบเร็ว

### `node` หรือ `npm` ไม่พบ

ติดตั้ง Node.js แล้วปิด/เปิด PowerShell ใหม่ จากนั้นตรวจ:

```powershell
node --version
npm --version
```

### PowerShell ไม่อนุญาตให้รันสคริปต์

ใช้แบบครั้งเดียวโดยไม่เปลี่ยนนโยบายทั้งเครื่อง:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

### Chromium เปิดไม่ได้

```powershell
npm run install-browser
npx playwright install --list
```

ถ้าอยู่หลัง Proxy ดูหัวข้อ Network/Proxy ใน [TROUBLESHOOTING-TH.md](TROUBLESHOOTING-TH.md)

### Port 4173 ถูกใช้งาน

```powershell
Get-NetTCPConnection -LocalPort 4173 -ErrorAction SilentlyContinue
$env:PORT="4174"
npm start
```

[ขั้นถัดไป: คู่มือใช้งาน](USER-GUIDE-TH.md)
