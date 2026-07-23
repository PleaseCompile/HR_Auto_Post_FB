# สำรอง กู้คืน และย้ายเครื่อง

[ศูนย์รวมเอกสาร](README.md) · [การตั้งค่า](CONFIGURATION-TH.md) · [ความปลอดภัย](SECURITY-TH.md)

## สิ่งที่ต้องสำรอง

| ข้อมูล | ตำแหน่ง | ความสำคัญ |
|---|---|---|
| ฐานข้อมูล | `data/hr-auto.sqlite` | สูง |
| รูป Draft | `data/uploads/` | สูง |
| หลักฐาน | `data/evidence/` | สูง |
| Group scan snapshot | `data/group-scans/` | ปานกลาง |
| Browser Profile | `data/browser-profile/` | ลับมากและมีความเสี่ยง |

## หลักสำคัญก่อน Backup

1. กดพักหรือหยุดคิว
2. ปิด Browser Session จากหน้า Settings
3. กด `Ctrl+C` ที่ Terminal
4. ตรวจว่าไม่มี `node` ของ HR Auto ใช้งานฐานข้อมูล
5. Backup Data Directory ทั้งชุด

การคัดลอก SQLite ขณะที่ระบบเขียนข้อมูลอาจได้ไฟล์ไม่สอดคล้องกัน จึงควรปิดแอปก่อน

## Backup บน Windows

ตัวอย่างสำรองไปยังโฟลเดอร์ที่มีวันที่:

```powershell
$source = (Resolve-Path .\data).Path
$destination = "D:\HR-Auto-Backups\data-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $destination | Out-Null
Copy-Item -LiteralPath "$source\*" -Destination $destination -Recurse
Get-ChildItem -LiteralPath $destination
```

ถ้า Backup มี `browser-profile/` ให้เก็บในดิสก์เข้ารหัสและจำกัดสิทธิ์ ห้ามส่งทางแชตหรืออีเมล

## Backup บน Linux

```bash
backup_dir="/var/backups/hr-auto/data-$(date +%Y%m%d-%H%M%S)"
sudo mkdir -p "$backup_dir"
sudo cp -a ./data/. "$backup_dir/"
sudo chmod -R go-rwx "$backup_dir"
sudo find "$backup_dir" -maxdepth 2 -type f | head
```

ตรวจค่า `backup_dir` ก่อนรันทุกครั้ง

## Backup แบบไม่รวม Facebook Session

เหมาะสำหรับส่งให้ผู้ดูแลข้อมูล:

Windows:

```powershell
$destination = "D:\HR-Auto-Backups\business-data-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $destination | Out-Null
Copy-Item .\data\hr-auto.sqlite $destination
Copy-Item .\data\uploads $destination -Recurse
Copy-Item .\data\evidence $destination -Recurse
Copy-Item .\data\group-scans $destination -Recurse
```

Linux:

```bash
backup_dir="/var/backups/hr-auto/business-data-$(date +%Y%m%d-%H%M%S)"
sudo mkdir -p "$backup_dir"
sudo cp -a data/hr-auto.sqlite data/uploads data/evidence data/group-scans "$backup_dir/"
```

## ตรวจความสมบูรณ์ของ SQLite

ถ้ามี `sqlite3`:

```bash
sqlite3 data/hr-auto.sqlite "PRAGMA integrity_check;"
```

ผลที่ต้องการคือ:

```text
ok
```

ถ้าไม่มี CLI ให้เปิดแอปบนสำเนา Backup โดยชี้ `HR_AUTO_DATA_DIR` ไปยังโฟลเดอร์ทดสอบ แล้วตรวจ Dashboard, Draft, Groups และ Evidence

## Restore

1. ปิดแอปและ Browser Session
2. เปลี่ยนชื่อ Data Directory ปัจจุบันเป็น `data-before-restore-*` เพื่อให้ย้อนกลับได้
3. คัดลอก Backup มาเป็น Data Directory ใหม่
4. ตรวจสิทธิ์ไฟล์
5. เปิดแอป
6. ตรวจ `/api/health`
7. ตรวจจำนวน Draft, Groups, Runs และ Evidence
8. ยังไม่เริ่มคิวทันที ให้ตรวจสถานะ Run ที่ค้างก่อน

หาก Run เดิมอยู่ที่ `submitting`, `manual_action_required` หรือผลไม่แน่นอน ต้องตรวจ Facebook ก่อน Resume เพื่อป้องกันโพสต์ซ้ำ

## ย้าย Windows → Windows

- ใช้ Source Code ใหม่จาก GitHub
- รัน `npm install` และติดตั้ง Chromium ใหม่
- ย้ายข้อมูลธุรกิจ
- Browser Profile ย้ายได้ในเชิงไฟล์แต่ Facebook อาจขอยืนยันอุปกรณ์ใหม่
- แนวทางปลอดภัยกว่าคือ Login ใหม่บนเครื่องปลายทาง

## ย้าย Linux → Linux

- รักษาเจ้าของและ Permission ของ Data Directory
- ติดตั้ง System Dependencies ใหม่ด้วย Playwright
- ไม่คัดลอก Chromium Cache จากเครื่องเดิม
- Login ใหม่หาก Session ถูกปฏิเสธ

## ย้ายข้าม Windows ↔ Linux

ย้ายเฉพาะ:

- SQLite
- uploads
- evidence
- group-scans

ไม่แนะนำให้ย้าย `browser-profile` ข้ามระบบปฏิบัติการ ให้สร้าง Browser Profile ใหม่และ Login เอง

## Retention ที่แนะนำ

- Backup รายวัน 7 ชุด
- Backup รายสัปดาห์ 4 ชุด
- Backup รายเดือนตามข้อกำหนดองค์กร
- ทดสอบ Restore อย่างน้อยเดือนละครั้ง
- แยก Backup ที่มี Session ออกจาก Backup ธุรกิจ

Retention ต้องปรับตามนโยบายข้อมูลส่วนบุคคลและอายุที่จำเป็นต้องเก็บหลักฐาน

## ล้างเฉพาะคิวและหลักฐาน

คำสั่งนี้เป็นการลบข้อมูลจริง:

```bash
npm run reset:queue-evidence
```

คำสั่งจะลบ Run, Run Target, Manual Evidence และไฟล์ใต้ `data/evidence/` แต่เก็บ Draft, รูปต้นฉบับ, กลุ่ม, Scan และ Browser Profile

ก่อนรันต้อง:

- ปิดแอป
- ตรวจ `HR_AUTO_DATA_DIR`
- Backup
- ตรวจว่ากำลังทำงานในโฟลเดอร์โปรเจกต์ที่ถูกต้อง

[ถัดไป: Troubleshooting](TROUBLESHOOTING-TH.md)

