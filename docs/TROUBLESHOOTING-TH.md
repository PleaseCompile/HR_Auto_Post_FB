# วิเคราะห์และแก้ปัญหา HR Auto

[ศูนย์รวมเอกสาร](README.md) · [คู่มือใช้งาน](USER-GUIDE-TH.md) · [สำรอง/กู้คืน](BACKUP-RESTORE-TH.md)

## หลักการวิเคราะห์ปัญหา

อย่าเริ่มด้วยการกดซ้ำ ให้แยกปัญหาเป็นชั้น:

```text
เปิดหน้าไม่ได้
  ├─ Process ไม่ทำงาน
  ├─ Port ผิด/ชน
  └─ Build หรือ dependency ผิด

หน้า HR Auto เปิดได้ แต่ Facebook ไม่เปิด
  ├─ Chromium ไม่ได้ติดตั้ง
  ├─ Browser Profile ถูกล็อก
  └─ Linux ไม่มี Display

Facebook เปิด แต่เตรียมโพสต์ไม่ได้
  ├─ Session หมดอายุ
  ├─ UI/ภาษา Facebook เปลี่ยน
  ├─ กลุ่มไม่มี Composer/ไม่มีสิทธิ์
  └─ Checkpoint/CAPTCHA

เตรียมได้ แต่ผลโพสต์ไม่ชัดเจน
  ├─ ปิดแท็บระหว่าง submit
  ├─ Facebook โหลดช้า
  ├─ กลุ่มรออนุมัติ
  └─ Permalink ตรวจไม่ได้
```

## ขั้นตอนเก็บข้อมูลก่อนแก้

1. จดเวลาที่เกิดปัญหา
2. จด Run ID, ชื่อกลุ่ม และสถานะ
3. แคปหน้าจอ HR Auto และ Facebook
4. คัดลอกข้อความผิดพลาด
5. ตรวจว่าเป็นกลุ่มเดียวหรือทุกกลุ่ม
6. ตรวจ `/api/health`
7. อย่าลบ `data/` หรือ Browser Profile
8. ถ้าผลโพสต์ไม่แน่นอน ให้หยุดและตรวจ Facebook ก่อน

## Health checks

```text
http://127.0.0.1:4173/api/health
http://127.0.0.1:4173/api/session
```

ถ้า `/api/health` ไม่ตอบ ปัญหาอยู่ที่ Process/Port/Build ไม่ใช่ Facebook

## ตารางอาการ

| อาการ | สาเหตุที่เป็นไปได้ | ตรวจอย่างไร | วิธีแก้ |
|---|---|---|---|
| หน้าเว็บเปิดไม่ได้ | Server ไม่ทำงาน | ดู Terminal, `/api/health` | รัน start script และตรวจ Port |
| `EADDRINUSE` | Port ถูกใช้ | ตรวจ Port | ปิด Process เดิมหรือเปลี่ยน `PORT` |
| `Cannot find module` | ติดตั้งไม่ครบ | ตรวจ `node_modules` | `npm install` |
| `Executable doesn't exist` | ไม่มี Chromium | `npx playwright install --list` | `npm run install-browser` |
| Chromium เปิดแล้วปิด | Profile ถูกล็อก/Process ค้าง | Task Manager หรือ `ps` | ปิด Chromium ที่เป็นของ HR Auto แล้วเปิดใหม่ |
| Facebook ให้ Login ใหม่ | Session หมดอายุ | เปิด Session | Login/2FA ด้วยตัวเอง |
| หา Composer ไม่พบ | UI เปลี่ยน/ไม่มีสิทธิ์/โหลดไม่ครบ | เปิดกลุ่มด้วยตนเอง | ตรวจสิทธิ์และใช้ Dry run |
| ข้อความไม่ถูกกรอก | Locator หรือ Editor เปลี่ยน | ตรวจ Dialog | หยุดคิว เก็บ Screenshot และรายงาน |
| รูปไม่ขึ้น | ไฟล์เสีย/ชนิดไม่รองรับ/อัปโหลดช้า | เปิดรูปต้นฉบับ | ใช้ JPG/PNG/WebP/GIF ที่เปิดได้ |
| ปุ่ม Post เทา | ข้อความ/รูปยังไม่พร้อม | ตรวจ Dialog | รอ upload หรือตรวจ validation ของ Facebook |
| `Target page... closed` | ผู้ใช้/ระบบปิดแท็บหรือ Browser | ดูแท็บและ Run | ตรวจว่าถูกโพสต์หรือยัง แล้ว reconcile |
| `Timeout 15000ms` | Facebook ช้า/UI เปลี่ยน | เปิดกลุ่มด้วยตนเอง | หยุด Retry, ตรวจ Session และ Screenshot |
| หลักฐานไม่เปิด | ไฟล์หาย/Path เปลี่ยน | ดู `data/evidence` | Restore จาก Backup หรืออัปโหลดเอง |
| วันที่/รอบผิด | Timezone ผิด | ดู Environment | ตั้ง `Asia/Bangkok` แล้ว Restart |
| ค้นหากลุ่มไม่เจอ | Query ตัดคำ/เงื่อนไขไม่ตรง | ลองคำเดียว | ใช้ AND, `|`, `"วลี"`, `-คำ` |

## หน้าเว็บเปิดไม่ได้

### Windows

```powershell
node --version
npm --version
Test-Path .\dist\server.js
Get-NetTCPConnection -LocalPort 4173 -ErrorAction SilentlyContinue
npm run build
npm start
```

### Linux

```bash
node --version
npm --version
test -f dist/server.js && echo "build exists"
ss -ltnp | grep ':4173' || true
npm run build
npm start
```

ถ้า Build ไม่ผ่าน รัน `npm run check` และอ่าน Error แรกก่อน ไม่ควรแก้จาก Error ท้ายสุด

## Chromium/Playwright

### ติดตั้ง Browser ใหม่

Windows:

```powershell
npm run install-browser
npx playwright install --list
```

Linux:

```bash
npx playwright install --with-deps chromium
npx playwright install --list
```

Playwright แต่ละเวอร์ชันต้องใช้ Browser Binary ที่ตรงกัน จึงต้องติดตั้งใหม่หลังอัปเดต package บางครั้ง ดู [Playwright Browsers](https://playwright.dev/docs/browsers)

### Network/Proxy ตอนติดตั้ง

Windows:

```powershell
$env:HTTPS_PROXY="http://proxy.example:8080"
$env:PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT="120000"
npm run install-browser
```

Linux:

```bash
export HTTPS_PROXY="http://proxy.example:8080"
export PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000
npx playwright install chromium
sudo HTTPS_PROXY="$HTTPS_PROXY" npx playwright install-deps chromium
```

อย่าใส่ Username/Password ของ Proxy ลงใน Git หรือ Screenshot

## Browser Profile ถูกล็อก

อาการ:

- Chromium ไม่เปิด
- แจ้งว่า Profile ถูกใช้งาน
- มี Process ค้างหลังแอปปิดผิดปกติ

วิธีแก้:

1. ปิด HR Auto
2. ปิด Chromium ที่ HR Auto เปิด
3. ตรวจ Task Manager หรือ `ps`
4. เปิดระบบใหม่

อย่าลบไฟล์ lock แบบสุ่มขณะที่ Chromium ยังทำงาน และอย่าลบทั้ง `browser-profile` ก่อน Backup

## Facebook Session และข้อจำกัด

### Session หมดอายุ

- พักคิว
- Login ใหม่ใน Browser เดิม
- ทำ 2FA
- ตรวจหนึ่งกลุ่มด้วย Dry run
- Resume เฉพาะรายการที่ยังไม่ submit

### CAPTCHA/Checkpoint/Restriction

- หยุดคิว
- ไม่ Retry
- เก็บ Screenshot และ URL
- แก้ผ่าน Facebook ด้วยตัวเอง
- ไม่สลับบัญชีเพื่อหลบข้อจำกัด

### ไม่พบ Composer

ตรวจตามลำดับ:

1. เป็นสมาชิกกลุ่มหรือไม่
2. กลุ่มอนุญาตโพสต์หรือไม่
3. มีประกาศ/คำถามก่อนโพสต์หรือไม่
4. Facebook โหลดครบหรือไม่
5. ภาษา UI เปลี่ยนหรือไม่
6. Locator ในโค้ดอาจล้าสมัยหรือไม่

ถ้าเกิดทุกกลุ่มพร้อมกัน ให้สงสัย Session/UI change ก่อนข้อมูลกลุ่ม

## ผลการโพสต์ไม่แน่นอน

สถานะ `submitting`, `manual_action_required`, แท็บถูกปิด หรือ Timeout หลังคลิก Post ต้องถือว่า “อาจโพสต์แล้ว”

1. ห้ามสร้างคิวเดิมซ้ำ
2. เปิดกลุ่มและดูโพสต์ล่าสุด
3. ตรวจ Profile, เวลา, ข้อความ และรูป
4. ถ้าพบโพสต์ ให้ใช้การยืนยันว่าโพสต์เองแล้ว/ทำ Reconcile
5. ถ้าไม่พบและแน่ใจว่าไม่ถูกส่ง จึงสร้าง Attempt ใหม่
6. บันทึกหมายเหตุและหลักฐาน

## รูปและหลักฐาน

รองรับ JPG, PNG, WebP และ GIF:

- รูป Draft สูงสุด 10 ไฟล์ต่อการอัปโหลด
- หลักฐานที่เพิ่มเองสูงสุด 5 ไฟล์ต่อครั้ง
- ไฟล์ละไม่เกิน 20 MB

ถ้าไฟล์นามสกุลถูกแต่เนื้อหาไม่ตรง ระบบจะปฏิเสธ ให้เปิดรูปในโปรแกรมดูภาพแล้ว Export ใหม่

## ฐานข้อมูล

อาการฐานข้อมูลเสียหรือถูกล็อก:

- `database is locked`
- เปิด Dashboard แล้ว API ผิดพลาด
- Process ถูกปิดระหว่างเขียน

วิธีดำเนินการ:

1. ปิดทุก HR Auto Process
2. Backup `data/` ทั้งชุด
3. ตรวจว่ามี Process อื่นใช้ SQLite หรือไม่
4. รัน Integrity Check
5. Restore จาก Backup ถ้าจำเป็น

```bash
sqlite3 data/hr-auto.sqlite "PRAGMA integrity_check;"
```

อย่าแก้ฐานข้อมูลจริงด้วย SQL โดยไม่มี Backup

## เมื่อควรรายงานเป็น Bug

รายงานเมื่อ:

- เกิดซ้ำได้
- ไม่ใช่ Session หมดอายุหรือไม่มีสิทธิ์กลุ่ม
- ทำตาม Troubleshooting แล้ว
- มี Screenshot และ Error

ข้อมูลรายงาน:

```text
OS:
Node version:
HR Auto commit/version:
เวลา:
หน้าที่เกิด:
Run ID:
Group (ปกปิดข้อมูลลับได้):
ขั้นตอนทำซ้ำ:
ผลที่คาด:
ผลจริง:
Error:
เกิดทุกกลุ่มหรือกลุ่มเดียว:
```

ห้ามแนบ Cookie, Browser Profile, Password หรือฐานข้อมูลจริงใน Issue สาธารณะ

[ถัดไป: Operations checklist](OPERATIONS-TH.md)

