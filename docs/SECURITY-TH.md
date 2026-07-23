# ความปลอดภัยและข้อกำหนดการใช้งาน

[ศูนย์รวมเอกสาร](README.md) · [สำรอง/กู้คืน](BACKUP-RESTORE-TH.md) · [แผน Profile](FACEBOOK-PROFILE-PLAN-TH.md)

## หลักการ

- ใช้บัญชีจริงที่ผู้ใช้มีสิทธิ์
- ผู้ใช้ Login และทำ 2FA เอง
- ไม่เก็บ Password หรือ 2FA Secret ในแอป
- ไม่สลับบัญชีหรือ Proxy เพื่อหลบข้อจำกัด
- หยุดเมื่อพบ CAPTCHA, Checkpoint, Suspicious Login หรือคำเตือน
- ตรวจข้อความ รูป กลุ่ม และสถานะก่อนยืนยันโพสต์
- ใช้ Automatic Group Scan เฉพาะเมื่อได้รับอนุญาตอย่างเหมาะสม

อ้างอิงข้อกำหนดปัจจุบันได้ที่ [Meta Terms](https://www.facebook.com/terms/) และ [Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms)

## การจัดระดับข้อมูล

| ระดับ | ตัวอย่าง | วิธีดูแล |
|---|---|---|
| ลับมาก | `data/browser-profile/`, Recovery Code | เข้ารหัสดิสก์ จำกัดสิทธิ์ ห้ามส่ง Git/Cloud |
| ลับ | SQLite, รูป Draft, หลักฐาน | Backup เข้ารหัส จำกัดผู้เข้าถึง |
| ภายใน | Group Library, Notes, Run logs | แชร์เฉพาะทีมที่เกี่ยวข้อง |
| สาธารณะ | Source Code และคู่มือที่ไม่มีข้อมูลจริง | ตรวจ `git status` ก่อนเผยแพร่ |

## Browser Profile

`data/browser-profile/` อาจใช้เข้าถึงบัญชีที่ Login อยู่:

- แยก Windows/Linux User สำหรับเครื่อง Worker
- เปิด BitLocker, LUKS หรือ Full Disk Encryption
- ไม่ใช้โฟลเดอร์ที่ OneDrive/Google Drive sync อัตโนมัติ
- ไม่ Zip แล้วส่งให้ผู้อื่น
- ปิด Session จาก Facebook ถ้าเครื่องสูญหาย
- Login ใหม่เมื่อสงสัยว่า Profile ถูกคัดลอก

## Git safety

ก่อน commit ทุกครั้ง:

```bash
git status --short
git diff --cached --name-only
git check-ignore -v data/hr-auto.sqlite
git check-ignore -v data/browser-profile
```

ห้าม commit:

- `data/`
- `.env`
- Token หรือ Cookie
- รูปหลักฐานจริง
- Screenshot ที่มีข้อมูลส่วนบุคคล
- Export ฐานข้อมูล

ถ้าข้อมูลลับเคยถูก push แล้ว การลบไฟล์ใน commit ใหม่ไม่เพียงพอ ต้อง Rotate Session/Token และล้าง Git history ตามขั้นตอน Incident Response

## Network

ระบบปัจจุบันปลอดภัยกว่าด้วยการ bind `127.0.0.1`

ห้าม:

- เปลี่ยนเป็น `0.0.0.0` แล้วเปิด Port Router
- เปิด Chrome CDP Port สู่ Internet
- เปิด VNC/RDP โดยไม่มี VPN/MFA/Firewall
- วางระบบปัจจุบันไว้หลัง Public Domain โดยไม่มี Authentication

ก่อน Deploy Server ต้องมี:

- HTTPS
- Authentication
- Role-based authorization
- CSRF protection
- Rate limiting
- Audit log
- Worker credentials แยกเครื่อง
- Backup/Restore

## 2FA และ Recovery

- เปิด 2FA ใน Facebook
- เก็บ Recovery Codes แบบ Offline
- เปิด Login Alerts
- ตรวจ Active Sessions เป็นระยะ
- ใช้ Trusted Device เฉพาะเครื่องส่วนตัว

อ้างอิง: [Facebook two-factor authentication](https://www.facebook.com/help/148233965247823) และ [Login alerts](https://www.facebook.com/help/261055370579217)

## Incident response

### พบ Session ผิดปกติ

1. หยุด HR Auto
2. Disconnect Browser Session
3. เปลี่ยนรหัสผ่านจากอุปกรณ์ที่เชื่อถือได้
4. Log out sessions ที่ไม่รู้จัก
5. Rotate Worker/API keys หากมี
6. สแกน Malware
7. เก็บ Log และเวลาเหตุการณ์
8. Login ใหม่หลังเครื่องปลอดภัย

### พบข้อมูลลับใน Git

1. ทำ Repository เป็น Private ชั่วคราวถ้าเป็นไปได้
2. ยกเลิก Session/Token ที่รั่วทันที
3. อย่าเพียงลบไฟล์ใน commit ล่าสุด
4. ล้าง History ด้วยเครื่องมือที่เหมาะสม
5. Force push หลังประสานผู้ร่วมงาน
6. ตรวจ Fork, Actions artifacts และ Releases
7. บันทึกเหตุการณ์และปรับ `.gitignore`

### Facebook จำกัดบัญชี

1. หยุดคิวทั้งหมดของ Session
2. ไม่ Retry ซ้ำ
3. เก็บ Screenshot/URL/เวลา
4. ดำเนินการ Recovery/Appeal ผ่าน Facebook
5. ไม่สร้าง Workflow เพื่อหลบการบังคับใช้

รายละเอียดอยู่ใน [FACEBOOK-PROFILE-PLAN-TH.md](FACEBOOK-PROFILE-PLAN-TH.md)

