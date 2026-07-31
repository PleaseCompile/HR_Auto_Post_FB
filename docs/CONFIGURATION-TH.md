# การตั้งค่า HR Auto

[ศูนย์รวมเอกสาร](README.md) · [Windows](INSTALL-WINDOWS-TH.md) · [Linux](INSTALL-LINUX-TH.md) · [ความปลอดภัย](SECURITY-TH.md)

## ค่าเริ่มต้น

| ตัวแปร | ค่าเริ่มต้น | หน้าที่ |
|---|---|---|
| `PORT` | `4173` | Port ของหน้าเว็บและ API |
| `HR_AUTO_DATA_DIR` | `./data` | ฐานข้อมูล รูป หลักฐาน Scan และ Browser Profile |
| `HR_AUTO_TIMEZONE` | `Asia/Bangkok` | วันที่และช่วงเวลาของงาน |
| `HR_AUTO_LOCALE` | `th-TH` | Locale ของ Chromium |

เซิร์ฟเวอร์ปัจจุบัน bind ที่ `127.0.0.1` เท่านั้น จึงเข้าถึงได้จากเครื่องเดียวและเปลี่ยนด้วย Environment Variable ไม่ได้

## ข้อควรรู้เกี่ยวกับ `.env`

ไฟล์ `.env.example` มีไว้เป็นตัวอย่าง แต่แอปยังไม่ได้เรียกตัวโหลด `.env` ดังนั้นการคัดลอกเป็น `.env` อย่างเดียวจะยังไม่มีผล

กำหนดค่าใน Shell ก่อนเปิดระบบ

Windows PowerShell:

```powershell
$env:PORT="4174"
$env:HR_AUTO_DATA_DIR="D:\HR-Auto-Data"
$env:HR_AUTO_TIMEZONE="Asia/Bangkok"
$env:HR_AUTO_LOCALE="th-TH"
npm start
```

Linux:

```bash
export PORT=4174
export HR_AUTO_DATA_DIR="/srv/hr-auto-data"
export HR_AUTO_TIMEZONE="Asia/Bangkok"
export HR_AUTO_LOCALE="th-TH"
npm start
```

## เลือก Data Directory

ควรเลือกโฟลเดอร์ที่:

- มีพื้นที่เพียงพอสำหรับรูปและหลักฐาน
- อยู่ในดิสก์ภายใน ไม่ใช่ Network Share ที่หลุดบ่อย
- Linux User หรือ Windows User ปัจจุบันมีสิทธิ์อ่านเขียน
- ไม่ถูก Sync ขึ้น Public Cloud โดยอัตโนมัติ
- สามารถ Backup แบบเข้ารหัสได้

เมื่อเปลี่ยน `HR_AUTO_DATA_DIR` ระบบจะสร้างโครงสร้างต่อไปนี้:

```text
HR_AUTO_DATA_DIR/
├── hr-auto.sqlite
├── uploads/
├── evidence/
│   └── manual/
├── group-scans/
└── browser-profile/
```

## ใช้ Data Directory เดิมหลังย้ายเครื่อง

1. ปิดแอปและ Browser Session
2. คัดลอก Data Directory ทั้งชุดด้วยวิธีที่รักษาสิทธิ์ไฟล์
3. ตั้ง `HR_AUTO_DATA_DIR` ให้ชี้ตำแหน่งใหม่
4. เปิดระบบ
5. ตรวจ Draft, กลุ่ม, คิว และหลักฐาน
6. Login Facebook ใหม่หาก Browser Session ไม่ได้รับการยอมรับ

ไม่ควรคัดลอก Browser Profile ระหว่าง Windows และ Linux เพราะโครงสร้าง Browser และการป้องกันข้อมูลของระบบปฏิบัติการต่างกัน

## Port

ถ้า Port ชน:

Windows:

```powershell
Get-NetTCPConnection -LocalPort 4173 -ErrorAction SilentlyContinue
$env:PORT="4174"
npm start
```

Linux:

```bash
ss -ltnp | grep ':4173'
PORT=4174 npm start
```

เปิดด้วย URL ที่ตรงกับ Port ใหม่ เช่น <http://127.0.0.1:4174>

## Timezone และรอบงาน

ใช้ `Asia/Bangkok` เพื่อให้:

- วันที่งานตรงกับประเทศไทย
- หลักฐานแสดงรอบเช้า/กลางวัน/เย็นถูกต้อง
- การกรองตามวันไม่เลื่อนเมื่อเครื่องใช้ UTC

หลังเปลี่ยน Timezone ให้สร้าง Draft ทดสอบหนึ่งรายการและตรวจวันที่ก่อนใช้งานจริง

## ค่า Workflow และจำนวนแท็บ

### หลายหน้าต่าง (`hybrid-windows`)

- ค่าเริ่มต้น `tabLimit = 30`
- ค่านี้หมายถึงจำนวนแท็บสูงสุด **ต่อหน้าต่าง**
- รับค่า 1–30 เท่านั้น ค่ามากกว่า 30 ถูก API ปฏิเสธ
- จำนวนกลุ่มรวมไม่ถูกตัดทิ้ง แต่แบ่งหน้าต่างเพิ่มให้เอง
- ตัวอย่าง 80 กลุ่มและ `tabLimit = 30` คือ 30 + 30 + 20
- ทุกหน้าต่างใช้ Persistent Browser Profile และ Facebook Session ชุดเดียวกัน
- ยืนยันผล ข้าม พัก และหยุดคิวจะไม่ปิดแท็บ ผู้ใช้ปิดเอง

### Hybrid แบบเดิม (`hybrid-tabs`)

`tabLimit = 0` หมายถึงเปิดตามจำนวนกลุ่มทั้งหมดโดยไม่มีเพดานพร้อมกันจากแอป ส่วนค่าบวกคือเพดานแท็บที่รอยืนยันพร้อมกัน เมื่อบันทึกผลหนึ่งแท็บ ระบบปิดแท็บนั้นแล้วเปิดรายการถัดไป

คำแนะนำสำหรับ Workflow แบบเดิม:

- RAM 8 GB: เริ่ม 2–3 แท็บ
- RAM 16 GB: เริ่ม 5–10 แท็บ
- RAM 32 GB: ใช้ทั้งหมดได้ แต่ควรสังเกต CPU, RAM และความลื่นของ Facebook

สเปกเครื่องไม่ได้เปลี่ยนเพดาน 30 แท็บต่อหน้าต่างของโหมดหลายหน้าต่าง เพราะเพดานนี้มีไว้จัดหน้าต่างให้ตรวจและปิดเองได้ง่าย ไม่ใช่ข้อจำกัด RAM

## ตรวจค่าที่ระบบกำลังใช้

เปิด:

```text
http://127.0.0.1:4173/api/health
```

ตัวอย่าง:

```json
{
  "ok": true,
  "version": "0.1.0",
  "dataDirectory": "D:\\HR-Auto-Data"
}
```

อย่าเผยแพร่ผลนี้สู่สาธารณะ เพราะเปิดเผยตำแหน่งข้อมูลบนเครื่อง

[ถัดไป: สำรองและกู้คืน](BACKUP-RESTORE-TH.md)
