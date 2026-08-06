# ศูนย์รวมเอกสาร HR Auto

[กลับหน้าโครงการ](../README.md)

เอกสารชุดนี้เขียนสำหรับผู้ใช้งาน ผู้ดูแลระบบ และนักพัฒนา โดยแยกสิ่งที่ “ทำได้ในระบบปัจจุบัน” ออกจาก “แผนในอนาคต” อย่างชัดเจน

## ทางลัดตามบทบาท

### ผู้ใช้งานครั้งแรก

1. เลือก [ติดตั้งบน Windows](INSTALL-WINDOWS-TH.md) หรือ [ติดตั้งบน Linux](INSTALL-LINUX-TH.md)
2. อ่าน [คู่มือใช้งาน](USER-GUIDE-TH.md)
3. อ่าน [รายการตรวจประจำวัน](OPERATIONS-TH.md)
4. ถ้าติดขัด เปิด [คู่มือแก้ปัญหา](TROUBLESHOOTING-TH.md)

### ผู้ดูแลเครื่องและข้อมูล

1. [การตั้งค่า](CONFIGURATION-TH.md)
2. [สำรอง กู้คืน และย้ายเครื่อง](BACKUP-RESTORE-TH.md)
3. [ความปลอดภัย](SECURITY-TH.md)
4. [สถาปัตยกรรมปัจจุบัน](ARCHITECTURE-TH.md)

### นักพัฒนา

1. [สถาปัตยกรรมปัจจุบัน](ARCHITECTURE-TH.md)
2. [คู่มือพัฒนาและทดสอบ](DEVELOPMENT-TH.md)
3. [Roadmap](ROADMAP-TH.md)

### ผู้วางแผน Server ในอนาคต

1. [แผน HostAtom และ Hybrid Architecture](HOSTATOM-HYBRID-PLAN-TH.md)
2. [แผนหลาย Facebook Profile และการกู้คืน](FACEBOOK-PROFILE-PLAN-TH.md)
3. [Roadmap](ROADMAP-TH.md)

## แผนที่เอกสาร

| ไฟล์ | เนื้อหา | สถานะ |
|---|---|---|
| [UPDATE-GUIDE-TH.md](UPDATE-GUIDE-TH.md) | ขั้นตอนอัปเดตระบบ เช็กลิสต์ และสิ่งที่เปลี่ยน | ใช้ได้ปัจจุบัน |
| [INSTALL-WINDOWS-TH.md](INSTALL-WINDOWS-TH.md) | ติดตั้ง เปิด อัปเดต และถอนบน Windows | ใช้ได้ปัจจุบัน |
| [INSTALL-LINUX-TH.md](INSTALL-LINUX-TH.md) | ติดตั้ง dependencies และเปิดบน Linux Desktop | ใช้ได้ปัจจุบัน |
| [USER-GUIDE-TH.md](USER-GUIDE-TH.md) | Workflow, สถานะ, หลักฐาน และตัวกรอง | ใช้ได้ปัจจุบัน |
| [CONFIGURATION-TH.md](CONFIGURATION-TH.md) | Environment variables และโครงสร้างข้อมูล | ใช้ได้ปัจจุบัน |
| [BACKUP-RESTORE-TH.md](BACKUP-RESTORE-TH.md) | Backup, Restore, ย้ายเครื่อง และตรวจความสมบูรณ์ | ใช้ได้ปัจจุบัน |
| [TROUBLESHOOTING-TH.md](TROUBLESHOOTING-TH.md) | Decision tree และอาการที่พบบ่อย | ใช้ได้ปัจจุบัน |
| [SECURITY-TH.md](SECURITY-TH.md) | Session, Data, Git และ Network safety | ใช้ได้ปัจจุบัน |
| [OPERATIONS-TH.md](OPERATIONS-TH.md) | Checklist ก่อน ระหว่าง และหลังรันงาน | ใช้ได้ปัจจุบัน |
| [DEVELOPMENT-TH.md](DEVELOPMENT-TH.md) | โครงสร้างโค้ด คำสั่งทดสอบ และ Release checklist | ใช้ได้ปัจจุบัน |
| [ARCHITECTURE-TH.md](ARCHITECTURE-TH.md) | Component, Data flow, State และข้อจำกัด | ใช้ได้ปัจจุบัน |
| [HOSTATOM-HYBRID-PLAN-TH.md](HOSTATOM-HYBRID-PLAN-TH.md) | แผน Control Plane/Worker และคำถาม HostAtom | แผนอนาคต |
| [FACEBOOK-PROFILE-PLAN-TH.md](FACEBOOK-PROFILE-PLAN-TH.md) | Profile isolation, Block handling และ Migration | แผนอนาคต |
| [ROADMAP-TH.md](ROADMAP-TH.md) | ลำดับการพัฒนาและเกณฑ์ผ่านแต่ละระยะ | แผนอนาคต |

## ขอบเขตและหลักการ

- ผู้ใช้เป็นผู้ Login Facebook เอง
- ไม่เก็บ Password หรือ 2FA Secret
- ไม่ใช้การหมุนบัญชี, Proxy หรือ Fingerprint เพื่อหลบข้อจำกัด
- การโพสต์จริงต้องมีการตรวจและยืนยัน
- ประวัติและหลักฐานต้องระบุ Run/กลุ่ม/เวลาที่แน่นอน
- ระบบปัจจุบันเป็น Local Application ไม่ใช่ Public Web Application
- Automatic Group Scan ใช้เฉพาะเมื่อมีสิทธิ์และจำเป็น

## ลำดับอ่านที่แนะนำ

```text
ติดตั้ง → ตั้งค่า → ใช้งาน → Operations → Backup → Troubleshooting
                                              └→ Security

แผน Server → แผน Profile → Roadmap
```

[ขั้นถัดไป: ติดตั้งบน Windows](INSTALL-WINDOWS-TH.md) · [ติดตั้งบน Linux](INSTALL-LINUX-TH.md)

