# Roadmap HR Auto

[ศูนย์รวมเอกสาร](README.md) · [แผน HostAtom](HOSTATOM-HYBRID-PLAN-TH.md) · [แผน Profile](FACEBOOK-PROFILE-PLAN-TH.md)

> ระยะเวลาเป็นประมาณการสำหรับวางแผน ไม่ใช่กำหนดส่งที่รับประกัน ต้องปรับหลังสำรวจ HostAtom และข้อมูลจริง

## หลักการจัดลำดับ

1. ป้องกันข้อมูลและโพสต์ซ้ำก่อนเพิ่มความเร็ว
2. แยก Profile ก่อนย้าย Server
3. แยก Control Plane/Worker ก่อนรองรับหลายเครื่อง
4. ทำ Authentication ก่อนเปิด Network
5. Pilot ขนาดเล็กก่อน 24/7

## Phase 0 — Discovery

ประมาณ 1–2 วัน

- ส่งคำถาม HostAtom
- ตรวจ Node/Database/Backup/Upload
- วัดจำนวนกลุ่ม รูป และหลักฐาน
- กำหนด Retention
- กำหนดผู้ใช้และ Roles
- เลือก Subdomain

ผลส่งมอบ:

- Hosting capability matrix
- Capacity estimate
- Deployment decision
- Risk register

เกณฑ์ผ่าน:

- รู้ว่า Shared Host เป็น Control Plane ได้หรือไม่
- รู้ว่าต้องซื้อ VPS หรือไม่
- Restore วิธีหนึ่งผ่าน

## Phase 1 — Profile isolation

ประมาณ 3–5 วัน

- Database schema
- Default Profile backfill
- Membership overlay
- Run/Evidence profile snapshot
- Profile switcher/filter
- Migration tests

เกณฑ์ผ่าน:

- ประวัติเดิมไม่หาย
- กลุ่มเดียวมีสิทธิ์ต่างกันตาม Profile
- ทุก Run/Evidence ระบุ Profile

## Phase 2 — Worker boundary

ประมาณ 4–7 วัน

- Worker registration
- API authentication
- Heartbeat
- Queue lease
- Offline outbox
- Evidence hash/upload
- Worker version

เกณฑ์ผ่าน:

- ปิด Server แล้วไม่สูญข้อมูล
- เปิด Worker ซ้ำไม่ทำ Target เดียวกัน
- Upload ซ้ำไม่สร้าง Evidence ซ้ำ

## Phase 3 — Control Plane security

ประมาณ 3–5 วัน

- HR Auto Login
- Admin/Operator/Auditor
- TLS
- CSRF/rate limit
- Audit log
- Secret rotation
- Backup/Restore

เกณฑ์ผ่าน:

- ผู้ไม่มีสิทธิ์เข้าคิวหรือหลักฐานไม่ได้
- Worker key หนึ่งเครื่องถูก revoke ได้
- Restore ทดสอบผ่าน

## Phase 4 — Profile health/block handling

ประมาณ 4–7 วัน

- Profile state machine
- Circuit breaker
- Checkpoint evidence
- Notification
- Re-auth workflow
- Migration wizard
- Unknown reconciliation

เกณฑ์ผ่าน:

- Checkpoint หยุดคิวทันที
- ไม่มี retry หลังผลไม่แน่นอน
- Resume เฉพาะ Target ที่ยังไม่ submit

## Phase 5 — HostAtom deployment

ประมาณ 3–7 วัน ขึ้นกับบริการ

- DNS/Subdomain
- Deploy Control Plane
- Database
- HTTPS
- Worker connection
- Monitoring
- Backup

เกณฑ์ผ่าน:

- Server restart แล้วคิวไม่ซ้ำ
- Worker reconnect ได้
- Evidence upload/retry ได้
- ไม่ส่ง Browser Session ไป Server

## Phase 6 — Pilot

ประมาณ 1–2 สัปดาห์

- หนึ่ง Profile
- กลุ่มจำนวนน้อย
- Assisted/Hybrid
- ตรวจหลักฐานทุก Target
- จำลอง Server down
- จำลอง Worker down ก่อน/หลัง submit
- จำลอง Session expired

เกณฑ์ผ่าน:

- ไม่มีโพสต์ซ้ำ
- ทุก Attempt ตรวจย้อนกลับได้
- Operator เข้าใจสถานะทั้งหมด
- Incident procedure ใช้งานได้

## Phase 7 — VPS/24×7

ทำเมื่อ Pilot ผ่าน

- เลือก Windows/Linux VPS
- Harden OS
- VPN/RDP/VNC
- Snapshot/Backup
- Worker monitoring
- Manual login/2FA
- Small rollout

เกณฑ์ผ่าน:

- Stable device/session
- Resource usage อยู่ในขอบเขต
- Recovery drill ผ่าน
- มี Local Worker fallback

## สิ่งที่ยังไม่ควรทำ

- Deploy โค้ดปัจจุบันสู่ Public Internet
- ย้าย `browser-profile` ไป Shared Hosting
- เปิดทุก Profile พร้อมกัน
- Auto-switch บัญชีเมื่อถูกจำกัด
- Retry `submitting/unknown`
- เปลี่ยน SQLite เป็นฐานกลางหลาย Worker โดยไม่มี migration
- เปิด RDP/VNC/CDP สาธารณะ

## ข้อมูลที่ต้องตัดสินใจก่อนเริ่ม

| หัวข้อ | คำถาม |
|---|---|
| Availability | ต้องทำงานเมื่อคอมปิดหรือไม่ |
| Profiles | มีกี่บัญชี และใครเป็นเจ้าของ |
| Operators | ใครสร้างคิว ยืนยันโพสต์ ลบหลักฐาน |
| Volume | กลุ่ม/วัน, Draft/วัน, รูป/โพสต์ |
| Retention | เก็บหลักฐานกี่วัน/เดือน |
| Hosting | HostAtom ตอบข้อจำกัดอย่างไร |
| Domain | ใช้ Subdomain ใด |
| Alert | แจ้งเตือนช่องทางใด |
| Recovery | ใครมีสิทธิ์ Resume/Reassign |
| Compliance | มีนโยบายองค์กรหรือข้อตกลงกลุ่มอะไร |

## Definition of done

ระบบ Server ถือว่าใช้งานจริงได้เมื่อ:

- เอกสารติดตั้งและ Rollback ผ่านการทดสอบโดยคนที่ไม่ได้เขียนระบบ
- มี Backup และ Restore log
- มี Authentication/Roles
- มี Worker lease/idempotency
- มี Profile isolation
- มี Circuit breaker
- มี Monitoring/Alert
- ไม่มี Secret ใน Git/Server log
- Pilot ผ่านโดยไม่มีโพสต์ซ้ำ

