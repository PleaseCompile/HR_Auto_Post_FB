# สร้างไฟล์ Setup.exe สำหรับแจกจ่าย

[ศูนย์รวมเอกสาร](README.md) · [ติดตั้งจาก Setup.exe](INSTALL-SETUP-EXE-TH.md) · [พัฒนา](DEVELOPMENT-TH.md)

เอกสารนี้สำหรับคนที่ต้องการ **สร้าง** ไฟล์ติดตั้งเพื่อส่งให้คนอื่น ถ้าคุณเป็นคนรับไฟล์มาติดตั้ง ให้ดู [INSTALL-SETUP-EXE-TH.md](INSTALL-SETUP-EXE-TH.md) แทน

## ผลลัพธ์ที่ได้

ไฟล์เดียวคือ `installer/output/HR-Auto-Setup-<version>.exe` ที่ผู้รับดับเบิลคลิกติดตั้งได้เลย ภายในมีครบทั้ง Node.js runtime, dependency ทั้งหมด และ Chromium ของ Playwright ผู้รับ**ไม่ต้อง**ติดตั้งอะไรก่อน และ**ไม่ต้อง**ใช้สิทธิ์ Administrator

## เตรียมเครื่องที่ใช้ Build (ทำครั้งเดียว)

```powershell
winget install JRSoftware.InnoSetup
```

จากนั้นต้องมีครบตามนี้ในโปรเจกต์:

```powershell
npm install
npm run install-browser
```

## สั่ง Build

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\build-installer.ps1
```

ใช้เวลาประมาณ 5-15 นาที ส่วนใหญ่หมดไปกับการบีบอัด Chromium

สคริปต์จะทำให้อัตโนมัติทั้งหมด:

1. คอมไพล์ TypeScript (`npm run build`)
2. เตรียมโฟลเดอร์ `installer/staging/` แล้วคัดลอก `dist/`, `public/`, `launcher.ps1` และ `node.exe`
3. ติดตั้ง dependency เฉพาะฝั่ง production (`npm ci --omit=dev`)
4. คัดลอก Chromium จาก Playwright cache ในเครื่อง
5. เรียก Inno Setup บีบอัดเป็น `Setup.exe`

## โครงสร้างไฟล์ที่เกี่ยวข้อง

```text
installer/
├── build-installer.ps1   สคริปต์หลักที่สั่ง Build
├── HR-Auto.iss           สคริปต์ Inno Setup (ตั้งค่าตัวติดตั้ง)
├── launcher.ps1          ตัวเปิดโปรแกรมที่ถูกติดตั้งไปด้วย
├── HR Auto.cmd           ไฟล์ให้ดับเบิลคลิกเปิดจากในโฟลเดอร์ที่ติดตั้ง
├── staging/              โฟลเดอร์ชั่วคราว (ไม่ขึ้น Git)
└── output/               ไฟล์ Setup.exe ที่ได้ (ไม่ขึ้น Git)
```

## ข้อควรระวังตอนแก้ `launcher.ps1`

**ต้องบันทึกเป็น UTF-8 with BOM เท่านั้น** เพราะ Windows PowerShell 5.1 อ่านไฟล์ `.ps1` ที่ไม่มี BOM เป็น ANSI ทำให้ข้อความภาษาไทยเพี้ยนจนสคริปต์ทำงานไม่ได้เลย

Editor บางตัวบันทึกเป็น UTF-8 ไม่มี BOM เป็นค่าเริ่มต้น ให้ตรวจทุกครั้งหลังแก้ไข สคริปต์ Build มีด่านตรวจให้แล้ว ถ้าลืมจะขึ้น Error และหยุดก่อนสร้างไฟล์ให้ทันที

## สิ่งที่ตัวติดตั้งทำกับเครื่องผู้รับ

| หัวข้อ | ค่าที่ใช้ |
|---|---|
| ตำแหน่งติดตั้ง | `%LOCALAPPDATA%\Programs\HR Auto` |
| สิทธิ์ที่ต้องใช้ | ไม่ต้องใช้ Administrator (ไม่มี UAC เด้ง) |
| ข้อมูลผู้ใช้ | `%LOCALAPPDATA%\HR-Auto\data` |
| ทางลัด | Start Menu (และ Desktop ถ้าติ๊กเลือก) |
| ภาษาตัวติดตั้ง | ไทย (ค่าเริ่มต้น) และอังกฤษ |
| ตอนถอนการติดตั้ง | ลบเฉพาะตัวโปรแกรม **ไม่ลบข้อมูลผู้ใช้** |

ตัวโปรแกรมถูกเปิดผ่าน `launcher.ps1` ซึ่งตั้ง `HR_AUTO_DATA_DIR` ไปที่ `%LOCALAPPDATA%` (เพราะเขียนลงโฟลเดอร์ติดตั้งไม่ได้) และตั้ง `PLAYWRIGHT_BROWSERS_PATH` ให้ชี้ Chromium ที่แพ็กมา

## ขนาดไฟล์และสิ่งที่ตัดออก

Staging รวมประมาณ 535 MB บีบอัดแล้วเหลือประมาณ 200 MB

สิ่งที่**ไม่ได้**แพ็กไปเพื่อลดขนาด:

- `chromium_headless_shell` (~270 MB) — ชุดที่แพ็กรันแบบเห็นหน้าต่างเสมอ ดังนั้นตั้ง `HR_AUTO_HEADLESS=true` กับชุดติดตั้งนี้**ไม่ได้**
- `ffmpeg` (~3 MB) — ใช้อัดวิดีโอเท่านั้น ระบบไม่ได้ใช้

ถ้าต้องการรองรับโหมด headless ให้แก้ตัวกรองในส่วน `$BrowserFolders` ของ `build-installer.ps1` ให้รวม `chromium_headless_shell-*` ด้วย

## ก่อนส่งไฟล์ให้คนอื่น ตรวจ 3 ข้อนี้ทุกครั้ง

1. **ห้ามมีข้อมูลส่วนตัวติดไปด้วย** — สคริปต์คัดลอกเฉพาะ `dist/`, `public/`, `node_modules` และ Chromium เท่านั้น ไม่แตะโฟลเดอร์ `data/` แต่ควรเปิด `installer/staging/` ตรวจด้วยตาก่อนทุกครั้ง โดยเฉพาะว่าต้องไม่มี `browser-profile` หรือ `hr-auto.sqlite`
2. **แจ้งผู้รับเรื่องหน้าจอเตือนของ Windows** — ไฟล์ยังไม่ได้เซ็น Certificate ผู้รับจะเจอ SmartScreen เตือน ถ้าจะแจกวงกว้างควรซื้อ Code Signing Certificate (ประมาณ 7,000-17,000 บาทต่อปี)
3. **ส่งคู่มือไปด้วย** — แนบลิงก์ [INSTALL-SETUP-EXE-TH.md](INSTALL-SETUP-EXE-TH.md) ให้ผู้รับอ่าน

## การอัปเดตเวอร์ชันใหม่

แก้ `version` ใน `package.json` แล้ว Build ใหม่ ตัวติดตั้งใช้ `AppId` เดิม ผู้รับจึงติดตั้งทับได้เลยโดยไม่ต้องถอนของเก่าออกก่อน และข้อมูลใน `%LOCALAPPDATA%\HR-Auto` ยังอยู่ครบ

ให้ผู้รับปิด HR Auto ก่อนติดตั้งทับทุกครั้ง

## เรื่องลิขสิทธิ์ Inno Setup

ไฟล์ `license.txt` ของ Inno Setup ระบุว่าอนุญาตให้ใช้ได้ทุกวัตถุประสงค์รวมถึงเชิงพาณิชย์ แต่ตัวคอมไพเลอร์เวอร์ชัน 6.7.3 แสดงข้อความ `Non-commercial use only` ระหว่างทำงาน ถ้าจะใช้ในบริษัทควรตรวจเงื่อนไขล่าสุดที่ <https://jrsoftware.org> ก่อน
