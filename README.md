# HR Auto

พื้นที่ทำงานบนเครื่องสำหรับเตรียมโพสต์งาน เลือกหลายกลุ่ม เปิด Facebook ด้วย Playwright แบบ Persistent Profile และเก็บหลักฐานแยกตามวัน ช่วงเวลา คิว และกลุ่ม รองรับ Windows และ Linux Desktop

> โครงการนี้ออกแบบเป็น **Assisted/Hybrid workflow** ผู้ใช้ต้องตรวจข้อความ รูป กลุ่ม และยืนยันก่อนโพสต์จริง ใช้เฉพาะบัญชีและกลุ่มที่ตนเองมีสิทธิ์เข้าถึง หยุดทันทีเมื่อพบ CAPTCHA, Checkpoint หรือข้อจำกัดบัญชี

## เริ่มใช้งานเร็ว

ต้องมี [Node.js 22 ขึ้นไป](https://nodejs.org/en/download)

### Windows

```powershell
npm install
npm run install-browser
npm run build
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

อ่านขั้นตอนละเอียด: [ติดตั้งบน Windows](docs/INSTALL-WINDOWS-TH.md)

### Linux Desktop

```bash
npm install
npx playwright install --with-deps chromium
npm run build
chmod +x scripts/start-linux.sh
./scripts/start-linux.sh
```

อ่านขั้นตอนละเอียด: [ติดตั้งบน Linux](docs/INSTALL-LINUX-TH.md)

เมื่อระบบเริ่มทำงาน ให้เปิด <http://127.0.0.1:4173>

## ความสามารถปัจจุบัน

- สร้าง Draft ตามวันที่และรอบเช้า/กลางวัน/เย็น
- แนบรูปหลายรูปและแก้ไข Draft
- เพิ่มกลุ่มเอง นำเข้า CSV และค้นหาหลายคำ
- Automatic Group Scan แบบสั่งทำเมื่อจำเป็น พร้อม JSON snapshot
- Dry run เพื่อตรวจกลุ่มโดยไม่ส่งโพสต์
- Assisted แบบทีละกลุ่ม
- Hybrid หลายแท็บ แบบทั้งหมดหรือกำหนดเพดานเอง
- หยุดรอให้ผู้ใช้ยืนยันก่อนกด Post
- ระบุว่าโพสต์เองแล้ว หรือข้ามพร้อมเก็บหลักฐาน
- ลบคิวทีละใบ หรือใช้ `ล้างคิวเดิมทั้งหมดและสร้างใหม่` เพื่อล้างทุก Run ของ Draft เดียวกันและสร้างคิวทดแทนในครั้งเดียว
- อัปโหลด แก้หมายเหตุ เปลี่ยนรูป และลบหลักฐานที่เพิ่มเอง
- คลังหลักฐานพร้อมตัวกรองวันที่ รอบ ช่วงเวลา กลุ่ม สถานะ และที่มา
- SQLite และไฟล์ทั้งหมดเก็บอยู่ในเครื่อง

## คู่มือทั้งหมด

เริ่มที่ [ศูนย์รวมเอกสารภาษาไทย](docs/README.md)

| ต้องการทำอะไร | คู่มือ |
|---|---|
| ติดตั้งบน Windows | [INSTALL-WINDOWS-TH.md](docs/INSTALL-WINDOWS-TH.md) |
| ติดตั้งบน Linux | [INSTALL-LINUX-TH.md](docs/INSTALL-LINUX-TH.md) |
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

ข้อมูลจริงทั้งหมดอยู่ใต้ `data/`:

```text
data/
├── hr-auto.sqlite       ฐานข้อมูล
├── uploads/             รูปของ Draft
├── evidence/            หลักฐานจากระบบและที่อัปโหลดเอง
├── group-scans/         JSON จาก Automatic Group Scan
└── browser-profile/     Facebook Browser Session
```

ห้ามส่ง `data/browser-profile/`, `.env`, ฐานข้อมูล หรือหลักฐานขึ้น GitHub พื้นที่เหล่านี้ถูกกำหนดไว้ใน `.gitignore` แล้ว แต่ควรตรวจด้วย `git status` ทุกครั้งก่อน commit

## คำสั่งสำคัญ

```bash
npm run dev                  # พัฒนาแบบ watch
npm run build                # สร้างไฟล์ใน dist/
npm start                    # เริ่มระบบที่ build แล้ว
npm run check                # ตรวจ TypeScript
npm run test:smoke           # ชุดทดสอบ smoke
npm run reset:queue-evidence # ล้างคิวและหลักฐาน ต้องสำรองก่อน
```

## สถานะการ Deploy

เวอร์ชันปัจจุบัน bind เฉพาะ `127.0.0.1` และเป็น Local Application ยังไม่มีระบบ Login ของ HR Auto จึง **ห้ามนำไปเปิด Public Internet โดยตรง** แผนแยก HostAtom Control Plane และ Local Worker อยู่ใน [HOSTATOM-HYBRID-PLAN-TH.md](docs/HOSTATOM-HYBRID-PLAN-TH.md)
