# HR Auto

พื้นที่ทำงานบนเครื่องสำหรับเตรียมโพสต์งาน เลือกหลายกลุ่ม เปิด Facebook ด้วย Playwright แบบ Persistent Profile และเก็บหลักฐานแยกตามวัน ช่วงเวลา คิว และกลุ่ม รองรับ Windows และ Linux Desktop

> โครงการนี้ออกแบบเป็น **Assisted/Hybrid workflow** ผู้ใช้ต้องตรวจข้อความ รูป และกลุ่มก่อนโพสต์จริง (ยืนยันทีละกลุ่ม หรือยืนยันครั้งเดียวต่อคิวเมื่อเปิดโหมดโพสต์อัตโนมัติ) ใช้เฉพาะบัญชีและกลุ่มที่ตนเองมีสิทธิ์เข้าถึง หยุดทันทีเมื่อพบ CAPTCHA, Checkpoint หรือข้อจำกัดบัญชี

## เริ่มใช้งานเร็ว

มี 2 วิธี เลือกวิธีเดียว (สองวิธีนี้ **เก็บข้อมูลและล็อกอิน Facebook คนละที่กัน** ดู [คำเตือนด้านล่าง](#คำเตือนก่อนนำไปใช้บนเครื่องอื่น))

### วิธี 1 — ติดตั้งจาก Setup.exe (ไม่ต้องลงอะไรเพิ่ม)

เหมาะกับผู้ใช้ทั่วไป ตัวติดตั้งมี Node.js และ Chromium มาในตัว ไฟล์ Setup.exe ไม่ได้อยู่ใน GitHub ต้องขอจากผู้ดูแล หรือสร้างเองตาม [BUILD-INSTALLER-TH.md](docs/BUILD-INSTALLER-TH.md)

อ่านขั้นตอน: [ติดตั้งจาก Setup.exe](docs/INSTALL-SETUP-EXE-TH.md)

### วิธี 2 — รันจาก Source Code

ต้องมี [Node.js 22 ขึ้นไป](https://nodejs.org/en/download)

#### Windows

```powershell
npm install
npm run install-browser
npm run build
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

อ่านขั้นตอนละเอียด: [ติดตั้งบน Windows](docs/INSTALL-WINDOWS-TH.md)

#### Linux Desktop

```bash
npm install
npx playwright install --with-deps chromium
npm run build
chmod +x scripts/start-linux.sh
./scripts/start-linux.sh
```

อ่านขั้นตอนละเอียด: [ติดตั้งบน Linux](docs/INSTALL-LINUX-TH.md)

เมื่อระบบเริ่มทำงาน ให้เปิด <http://127.0.0.1:4173> แล้วไปหน้า `ตั้งค่าและ Session` → กด `เชื่อมต่อ Facebook` → ล็อกอินและทำ 2FA เองในหน้าต่าง Chromium ที่เปิดขึ้น ครั้งต่อไปโปรแกรมจะจำ Session ไว้ ไม่ต้องล็อกอินซ้ำ ([ทำงานยังไง?](docs/FACEBOOK-SESSION-EXPLAINED-TH.md))

## คำเตือนก่อนนำไปใช้บนเครื่องอื่น

> ⚠️ HR Auto **ไม่ใช่โปรแกรมที่ก๊อปโฟลเดอร์ไปแล้วเปิดใช้ได้ทันที** เพราะมี 3 อย่างที่ผูกกับเครื่องและผู้ใช้ Windows: **Facebook Session**, **Chromium** และ **โมดูลที่คอมไพล์ตามเวอร์ชัน Node.js** ทุกครั้งที่ติดตั้งบนเครื่องใหม่ให้เช็กตามนี้

### ต้องทำทุกครั้งที่ย้ายเครื่อง

| เรื่อง | ต้องทำอะไร | ทำไมต้องทำ |
|---|---|---|
| **ล็อกอิน Facebook ใหม่** | กด `เชื่อมต่อ Facebook` แล้วล็อกอิน + 2FA ใหม่บนเครื่องนั้น **อย่าก๊อปโฟลเดอร์ `browser-profile/` ไป** | คุกกี้ล็อกอินถูกเข้ารหัสด้วย Windows DPAPI ซึ่งผูกกับผู้ใช้ Windows บนเครื่องนั้น ก๊อปไปก็ถอดรหัสไม่ได้ และถ้าไฟล์หลุดไปถึงคนอื่นก็เท่ากับบัญชีหลุด รายละเอียด: [FACEBOOK-SESSION-EXPLAINED-TH.md](docs/FACEBOOK-SESSION-EXPLAINED-TH.md) |
| **ลง Chromium ทุกครั้งหลัง `npm install`** | รัน `npm run install-browser` ต่อท้ายเสมอ | Playwright แต่ละเวอร์ชันใช้ Chromium build เฉพาะตัว ถ้าไม่ลงให้ตรง Browser จะเปิดไม่ขึ้น (อาการ `Invalid file descriptor to ICU data received`) และ Chromium ถูกลงไว้ที่ `%LOCALAPPDATA%\ms-playwright` ของผู้ใช้ Windows แต่ละคน ผู้ใช้ใหม่ต้องลงเอง |
| **ห้ามก๊อป `node_modules/` ข้ามเครื่อง** | ลบทิ้งแล้ว `npm install` ใหม่บนเครื่องปลายทาง | `better-sqlite3` เป็นโมดูลที่คอมไพล์ตามเวอร์ชันและสถาปัตยกรรมของ Node.js ถ้าไม่ตรงจะเปิดโปรแกรมไม่ได้ (อาการ `NODE_MODULE_VERSION` / `was compiled against a different Node.js version`) ถ้าเปลี่ยนเวอร์ชัน Node ภายหลังให้รัน `npm rebuild better-sqlite3` |
| **Node.js 22 ขึ้นไป** (เฉพาะวิธี Source Code) | ติดตั้ง Node.js 22 LTS แล้วเช็กด้วย `node --version` | `package.json` กำหนด `"node": ">=22"` เวอร์ชัน Setup.exe มี Node ในตัวไม่ต้องลง |

### ควรรู้ก่อนเริ่มใช้

| เรื่อง | ต้องทำอะไร | ทำไม |
|---|---|---|
| **Setup.exe กับ Source Code ใช้ข้อมูลคนละที่** | เลือกใช้วิธีเดียวให้เป็นหลัก | Setup.exe เก็บที่ `%LOCALAPPDATA%\HR-Auto\data` (ตัวเปิดโปรแกรมบังคับไว้ เปลี่ยนไม่ได้) ส่วน Source Code เก็บที่ `<โฟลเดอร์โปรเจกต์>\data` Draft, กลุ่ม, คิว และล็อกอิน Facebook จึงไม่เห็นกันข้ามสองวิธี |
| **PowerShell ไม่ยอมรันสคริปต์** | ใช้คำสั่งพร้อม `-ExecutionPolicy Bypass` ตามตัวอย่าง | Windows ตั้งค่าเริ่มต้นไม่ให้รันไฟล์ `.ps1` ที่ไม่ได้เซ็นชื่อ `Bypass` มีผลแค่คำสั่งนั้นครั้งเดียว ไม่ได้เปลี่ยนการตั้งค่าเครื่อง |
| **ไฟล์ `.env` ไม่มีผล** | ตั้งค่าผ่าน `$env:ชื่อตัวแปร="ค่า"` ใน PowerShell ก่อน `npm start` | แอปยังไม่ได้โหลด `.env` อัตโนมัติ `.env.example` เป็นแค่รายการตัวอย่าง ดู [CONFIGURATION-TH.md](docs/CONFIGURATION-TH.md) |
| **Port 4173 ชนกับโปรแกรมอื่น** | ตั้ง `$env:PORT="4174"` แล้วรัน `npm start` ตรง ๆ แล้วเปิด <http://127.0.0.1:4174> | `scripts/start-windows.ps1` ตรวจความพร้อมที่ Port 4173 ตายตัว ถ้าเปลี่ยน Port แล้วใช้สคริปต์นี้ มันจะรอไม่เจอแล้วปิดเซิร์ฟเวอร์เองหลัง 10 วินาที (เวอร์ชัน Setup.exe รองรับ `PORT` ปกติ) |
| **ภาษา Facebook ต้องเป็นไทยหรืออังกฤษ** | ตั้งภาษาบัญชี Facebook เป็นไทยหรือ English | ระบบหาปุ่มจากข้อความบนหน้าจอ เช่น `โพสต์`/`Post`, `ลบ`/`Delete` ภาษาอื่นจะหาปุ่มไม่เจอ |
| **อย่าวางโปรเจกต์ในโฟลเดอร์ที่ Sync ขึ้น Cloud** | วางไว้ที่ไดรฟ์ในเครื่อง เช่น `D:\HR-Auto` | บน Windows 11 โฟลเดอร์ Desktop/Documents มัก Sync กับ OneDrive อัตโนมัติ ทำให้ `data/browser-profile/` (เท่ากับ Session ที่ล็อกอินอยู่) ถูกอัปโหลดขึ้น Cloud และไฟล์ถูกล็อกระหว่าง Sync จน Browser เปิดไม่ขึ้น |
| **Windows SmartScreen / Antivirus เตือน** | SmartScreen: กด `More info` → `Run anyway` / Antivirus: เพิ่มโฟลเดอร์โปรแกรมเป็น Exclusion | Setup.exe ยังไม่ได้เซ็น Code Signing Certificate และโปรแกรมที่ควบคุมเบราว์เซอร์มักถูกเตือนผิดพลาด |
| **เครื่อง RAM น้อย** | เริ่มที่ 4 แท็บ (RAM 8 GB) / 8 แท็บ (16 GB) / 10 แท็บ (32 GB) | แต่ละแท็บ Facebook กิน RAM มาก เปิดเกินกำลังจะทำให้แท็บ Crash ดู [CONFIGURATION-TH.md](docs/CONFIGURATION-TH.md) |
| **เปิดได้ทีละโปรแกรมต่อหนึ่งโฟลเดอร์ข้อมูล** | ปิด HR Auto ตัวเดิมก่อนเปิดใหม่ | มีไฟล์ `browser-session.lock` กันไม่ให้สองโปรแกรมแย่ง Browser Profile เดียวกัน |

## ความสามารถปัจจุบัน

- สร้าง Draft ตามวันที่และรอบเช้า/กลางวัน/เย็น แนบรูปหลายรูปและแก้ไขได้
- เพิ่มกลุ่มเอง นำเข้า CSV และค้นหาหลายคำ
- Automatic Group Scan แบบสั่งทำเมื่อจำเป็น พร้อม JSON snapshot
- Dry run เพื่อตรวจกลุ่มโดยไม่ส่งโพสต์
- **Hybrid แบบเติมต่อเนื่อง** (แนะนำ) ค่าเริ่มต้น 10 แท็บ ปรับเองได้ 1–250 เมื่อจัดการหนึ่งแท็บเสร็จจะเตรียมกลุ่มถัดไปให้ และพักอัตโนมัติเมื่อ RAM เหลือน้อย
- **หลายหน้าต่าง** ภายใต้ Facebook Profile เดียว ค่าเริ่มต้น 30 แท็บต่อหน้าต่าง ปรับได้ถึง 250 และไม่ปิดแท็บเอง
- ค่าเริ่มต้นหยุดรอให้ผู้ใช้ยืนยันก่อนกด Post ทุกกลุ่ม
- **โหมดโพสต์อัตโนมัติ (Auto-confirm)** แบบเลือกเปิด ยืนยันครั้งเดียวต่อคิว แล้วระบบสุ่มหน่วง 8–150 วินาทีก่อนกด Post แต่ละกลุ่ม
- **Safety Net** พักคิวทันทีเมื่อเจอ CAPTCHA, Checkpoint, หน้าล็อกอิน หรือบัญชีถูกจำกัด และในโหมดโพสต์อัตโนมัติจะพักเองเมื่อโพสต์ล้มเหลวติดกัน 2 ครั้ง
- **ล้าง Pending** ไล่ตรวจทุกกลุ่มว่ามีโพสต์ค้างรออนุมัติกี่โพสต์ แล้วเลือกลบ พร้อมถ่ายภาพหลักฐานทุกโพสต์ก่อนลบ
- ระบุว่าโพสต์เองแล้ว หรือข้ามพร้อมเก็บหลักฐาน เลือกหลายกลุ่มแล้วบันทึก `ฉันโพสต์เองแล้ว` พร้อมกันได้ หรือคลิก 3 ครั้งติดกันเพื่อบันทึกทันที
- ลบคิวทีละใบ หรือใช้ `ล้างคิวเดิมทั้งหมดและสร้างใหม่` เพื่อล้างทุก Run ของ Draft เดียวกันแล้วสร้างคิวทดแทน
- อัปโหลด แก้หมายเหตุ เปลี่ยนรูป และลบหลักฐานที่เพิ่มเอง
- คลังหลักฐานพร้อมตัวกรองวันที่ รอบ ช่วงเวลา กลุ่ม สถานะ และที่มา
- ล็อกเจ้าของ Browser Profile ป้องกัน HR Auto หลายโปรเซสเปิด Session ชนกัน
- บันทึก Browser crash, page error และ document network failure ไว้ใน `data/browser-events.jsonl`
- ตัวติดตั้ง **Setup.exe** แบบ per-user ไม่ต้องใช้สิทธิ์ Admin
- SQLite และไฟล์ทั้งหมดเก็บอยู่ในเครื่อง ไม่ส่ง Session ขึ้น Cloud

## คู่มือทั้งหมด

เริ่มที่ [ศูนย์รวมเอกสารภาษาไทย](docs/README.md)

| ต้องการทำอะไร | คู่มือ |
|---|---|
| อัปเดตโปรแกรมเป็นเวอร์ชันใหม่ | [UPDATE-GUIDE-TH.md](docs/UPDATE-GUIDE-TH.md) |
| **เข้าใจว่า Facebook Session ถูกจำไว้ที่ไหน และทำไมไม่ต้องล็อกอินซ้ำ** | [FACEBOOK-SESSION-EXPLAINED-TH.md](docs/FACEBOOK-SESSION-EXPLAINED-TH.md) |
| ติดตั้งจากไฟล์ Setup.exe | [INSTALL-SETUP-EXE-TH.md](docs/INSTALL-SETUP-EXE-TH.md) |
| สร้างไฟล์ Setup.exe เพื่อแจกจ่าย | [BUILD-INSTALLER-TH.md](docs/BUILD-INSTALLER-TH.md) |
| ติดตั้งบน Windows | [INSTALL-WINDOWS-TH.md](docs/INSTALL-WINDOWS-TH.md) |
| ติดตั้งบน Linux | [INSTALL-LINUX-TH.md](docs/INSTALL-LINUX-TH.md) |
| ล้างโพสต์ที่ค้างรออนุมัติ | [PENDING-CLEANUP-TH.md](docs/PENDING-CLEANUP-TH.md) |
| เรียนรู้ขั้นตอนใช้งาน | [USER-GUIDE-TH.md](docs/USER-GUIDE-TH.md) |
| ตั้งค่า Port, Data Directory และภาษา | [CONFIGURATION-TH.md](docs/CONFIGURATION-TH.md) |
| สำรองหรือย้ายเครื่อง | [BACKUP-RESTORE-TH.md](docs/BACKUP-RESTORE-TH.md) |
| แก้ปัญหา | [TROUBLESHOOTING-TH.md](docs/TROUBLESHOOTING-TH.md) |
| ตรวจความปลอดภัย | [SECURITY-TH.md](docs/SECURITY-TH.md) |
| ดูแลระบบประจำวัน | [OPERATIONS-TH.md](docs/OPERATIONS-TH.md) |
| พัฒนาและรันทดสอบ | [DEVELOPMENT-TH.md](docs/DEVELOPMENT-TH.md) |
| เข้าใจสถาปัตยกรรมปัจจุบัน | [ARCHITECTURE-TH.md](docs/ARCHITECTURE-TH.md) |
| วางแผน HostAtom/Server ในอนาคต | [HOSTATOM-HYBRID-PLAN-TH.md](docs/HOSTATOM-HYBRID-PLAN-TH.md) |
| วางแผนหลาย Facebook Profile และการกู้คืน | [FACEBOOK-PROFILE-PLAN-TH.md](docs/FACEBOOK-PROFILE-PLAN-TH.md) |
| ดู Roadmap | [ROADMAP-TH.md](docs/ROADMAP-TH.md) |

## ข้อมูลสำคัญ

ข้อมูลจริงทั้งหมดอยู่ใน Data Directory ซึ่งอยู่คนละที่ตามวิธีติดตั้ง:

- Source Code: `<โฟลเดอร์โปรเจกต์>/data/`
- Setup.exe: `%LOCALAPPDATA%\HR-Auto\data\`

```text
data/
├── hr-auto.sqlite       ฐานข้อมูล
├── uploads/             รูปของ Draft
├── evidence/            หลักฐานจากระบบและที่อัปโหลดเอง
├── group-scans/         JSON จาก Automatic Group Scan
├── pending-cleanup/     ภาพหลักฐานก่อนลบโพสต์ที่ค้างรออนุมัติ
├── browser-profile/     Facebook Browser Session (ลับมาก เท่ากับบัญชีที่ล็อกอินอยู่)
├── browser-session.lock เจ้าของ Profile ขณะ Browser เปิด
└── browser-events.jsonl เหตุการณ์ Browser สำหรับวิเคราะห์ปัญหา
```

ห้ามส่ง `data/browser-profile/`, `.env`, ฐานข้อมูล หรือหลักฐานขึ้น GitHub พื้นที่เหล่านี้ถูกกำหนดไว้ใน `.gitignore` แล้ว แต่ควรตรวจด้วย `git status` ทุกครั้งก่อน commit

## คำสั่งสำคัญ

```bash
npm run dev                  # พัฒนาแบบ watch
npm run build                # สร้างไฟล์ใน dist/
npm start                    # เริ่มระบบที่ build แล้ว
npm run install-browser      # ลง Chromium ให้ตรงกับ Playwright (รันทุกครั้งหลัง npm install)
npm run check                # ตรวจ TypeScript
npm run test:smoke           # ชุดทดสอบ smoke
npm run reset:queue-evidence # ล้างคิวและหลักฐาน ต้องสำรองก่อน
```

## สถานะการ Deploy

เวอร์ชันปัจจุบัน bind เฉพาะ `127.0.0.1` และเป็น Local Application ยังไม่มีระบบ Login ของ HR Auto จึง **ห้ามนำไปเปิด Public Internet โดยตรง** แผนแยก HostAtom Control Plane และ Local Worker อยู่ใน [HOSTATOM-HYBRID-PLAN-TH.md](docs/HOSTATOM-HYBRID-PLAN-TH.md)
