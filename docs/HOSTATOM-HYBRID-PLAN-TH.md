# แผน HostAtom และ Hybrid Architecture

[ศูนย์รวมเอกสาร](README.md) · [สถาปัตยกรรมปัจจุบัน](ARCHITECTURE-TH.md) · [แผน Facebook Profile](FACEBOOK-PROFILE-PLAN-TH.md) · [Roadmap](ROADMAP-TH.md)

> **สถานะ: แผนอนาคต ยังไม่ได้ติดตั้งหรือย้ายระบบ**

## ข้อสรุปที่แนะนำ

ใช้ HostAtom เป็น **Control Plane** และเก็บ Playwright/Facebook Session ไว้บน **Windows Worker** ที่ผู้ใช้ควบคุม

```text
ผู้ใช้
  │
  ▼
HostAtom Control Plane
  ├── Web UI / API
  ├── Database
  ├── Queue metadata
  └── Evidence archive
          ▲
          │ Outbound HTTPS
          ▼
Local Windows Worker
  ├── Playwright
  ├── Persistent browser profile
  ├── Manual login / 2FA
  └── Screenshot uploader
          │
          ▼
       Facebook
```

Worker เป็นฝ่ายเชื่อมออกไปหา Server ไม่ต้องเปิด Port เข้ามายังเครื่องผู้ใช้ และ HostAtom ไม่ต้องเก็บ Facebook Cookie

## ประเมินบริการปัจจุบัน

จากข้อมูลที่ผู้ใช้ให้ บริการปัจจุบันเป็น Web Hosting บน Plesk มีพื้นที่ 50 GB ซึ่งเพียงพอสำหรับ UI, Database และหลักฐานในระยะแรก แต่พื้นที่ไม่ใช่ปัจจัยตัดสินว่า Playwright รันได้

ต้องตรวจ:

- Node.js Toolkit
- Node.js 22+
- Persistent/background process
- SSH/Shell access
- Chromium system dependencies
- RAM/CPU/process limits
- WebSocket/long polling
- Upload limits
- Backup และ Restore

Plesk จะใช้ Node.js ได้เมื่อผู้ให้บริการติดตั้ง/เปิด Node.js Toolkit และให้สิทธิ์ที่เหมาะสม ดู [Plesk Node.js Support](https://docs.plesk.com/en-US/obsidian/administrator-guide/website-management/nodejs-support.76652/) ส่วน Playwright ต้องใช้ Browser Binary ที่ตรงเวอร์ชันและ Linux dependencies ดู [Playwright Browsers](https://playwright.dev/docs/browsers)

## เปรียบเทียบทางเลือก

| ทางเลือก | ค่าใช้จ่าย | ความพร้อม 24/7 | ความเสี่ยง Session | งานดูแล | คำแนะนำ |
|---|---:|---:|---:|---:|---|
| Shared Hosting ทั้งระบบ | ต่ำ | ไม่แน่นอน | สูง | กลาง | ไม่แนะนำจนกว่าจะยืนยัน Chromium/background |
| Shared Hosting + Local Worker | ต่ำ–กลาง | Worker ต้องเปิด | ต่ำกว่า | กลาง | แนะนำระยะแรก |
| VPS Control Plane + Local Worker | กลาง | Control Plane 24/7 | ต่ำกว่า | กลาง–สูง | แนะนำเมื่อผู้ใช้หลายคน |
| Windows VPS ทั้งระบบ | กลาง–สูง | สูง | IP/Device ใหม่ | สูง | Pilot ก่อน |
| Linux VPS + Desktop/VNC | กลาง–สูง | สูง | IP/Device ใหม่ | สูงมาก | ใช้เมื่อมีผู้ดูแล Linux |

HostAtom มี Cloud VPS ทั้ง Windows และ Linux พร้อมสิทธิ์ควบคุมมากกว่า Shared Hosting ดู [HostAtom Cloud VPS](https://en.hostatom.com/cloud-vps/)

## ขนาด VPS โดยประมาณ

สำหรับ Browser แบบมีหน้าต่าง:

- 2 GB RAM: ไม่แนะนำ
- 4 GB RAM: ทดสอบหนึ่ง Browser ได้ แต่พื้นที่เผื่อน้อย
- 8 GB RAM / 4 vCPU: จุดเริ่มต้นสำหรับหนึ่ง Worker
- 16 GB RAM / 8 vCPU: เหมาะกับหลายแท็บและงานต่อเนื่องกว่า

ตัวเลขเป็น Capacity Planning เบื้องต้น ต้องวัดจากจำนวนแท็บ ขนาดรูป และ Page behavior จริง

## Control Plane

### หน้าที่

- Authentication และ Roles
- Draft/Media metadata
- Group Library
- Run/Target queue
- Profile assignment
- Worker registration
- Queue lease
- Heartbeat
- Evidence upload
- Audit log
- Report/filter

### สิ่งที่ห้ามเก็บ

- Facebook Password
- 2FA Secret/Recovery Code
- Cookie แบบ plaintext
- Browser Profile ทั้งโฟลเดอร์
- Chrome debugging endpoint

### Database

ระยะแรกเลือกได้:

- MySQL/MariaDB ถ้า Plesk รองรับและต้องการใช้โฮสต์เดิม
- PostgreSQL ถ้า VPS รองรับและต้องการ query/report ที่ซับซ้อน

SQLite ไม่ควรเป็นฐานข้อมูลกลางเมื่อมีหลาย Worker หรือหลาย Server เขียนพร้อมกัน

### Evidence storage

แนวทาง:

```text
evidence/
└── YYYY/
    └── MM/
        └── DD/
            └── slot/
                └── run-id/
                    └── target-id/
```

Metadata อยู่ Database ส่วนไฟล์อยู่ Object Storage หรือ Filesystem ที่ Backup ได้ ทุกไฟล์มี SHA-256

## Worker

### Registration

Worker แต่ละเครื่องมี:

- `worker_id`
- ชื่อเครื่อง
- OS
- Version
- API credential เฉพาะเครื่อง
- Last heartbeat
- Capabilities เช่น Browser/Display
- Assigned Facebook Profile

### Queue lease

1. Worker ขอ Target
2. Server ออก Lease พร้อมเวลาหมดอายุ
3. Workerส่ง Heartbeat
4. Server ไม่แจก Target เดิมให้ Worker อื่น
5. ถ้า Worker หาย Target ไป `interrupted/needs_review`
6. ไม่ Retry Target ที่อาจ Submit แล้วโดยอัตโนมัติ

### Offline outbox

Worker เก็บเหตุการณ์ใน SQLite:

- started
- prepared
- awaiting confirmation
- submitted
- screenshot captured
- evidence uploaded
- completed/failed

ส่งใหม่เมื่อ Network กลับมา โดยใช้ Event ID และ Idempotency Key ป้องกันซ้ำ

## Security สำหรับการเชื่อมต่อ

- HTTPS เท่านั้น
- Worker API Key แยกเครื่อง
- Key rotation และ revoke
- Outbound connection จาก Worker
- ไม่เปิด inbound port ที่ Worker
- Rate limit API
- จำกัด Upload type/size
- Audit ทุกการเปลี่ยน Run
- Admin/Operator/Auditor
- Backup encryption

ถ้าต้องเข้าถึง Worker ระยะไกล ใช้ VPN/Zero Trust และ MFA แทนการเปิด RDP/VNC ต่อ Internet

## HostAtom Shared Hosting Deployment

ใช้ได้เมื่อ HostAtom ยืนยันอย่างน้อย:

- Node.js 22 หรือ runtime ที่รองรับ
- Background/API process ที่เสถียร
- Database และ Backup
- HTTPS
- Upload limit เพียงพอ
- Outbound HTTPS/WebSocket
- Scheduled task

ถ้า Node runtime มีข้อจำกัด สามารถ:

- วาง Static Frontend บน Plesk
- วาง API บน VPS แยก
- หรือย้าย Control Plane ทั้งชุดไป VPS

## คำถามส่ง HostAtom

```text
หัวข้อ: สอบถามความสามารถของ Web Hosting Boost PL สำหรับ Node.js Application

1. แผนนี้เปิด Node.js Toolkit หรือไม่ และรองรับ Node.js 22 ขึ้นไปหรือไม่
2. รองรับ Node.js background process/long-running API หรือเป็น request-based เท่านั้น
3. Process มี idle timeout, restart policy, RAM, CPU หรือจำนวน process จำกัดเท่าใด
4. มี SSH/Shell access และ npm install หรือไม่
5. อนุญาตให้ติดตั้ง Playwright Chromium และ system dependencies หรือไม่
6. รองรับ WebSocket หรือ long polling หรือไม่
7. Cron/Scheduled Task ทำงานได้ถี่ที่สุดเท่าใด
8. Maximum upload/file/request body เท่าใด
9. Database ที่รองรับและขนาดจำกัดเท่าใด
10. Backup ทำบ่อยเพียงใด เก็บกี่วัน และผู้ใช้ Restore เองได้หรือไม่
11. รองรับ Docker Extension หรือไม่
12. ถ้าต้องใช้ Windows VPS มี RDP, Snapshot และ Remote Backup หรือไม่
13. Server region และ Dedicated IP เป็นอย่างไร
```

## Domain

แนะนำ Subdomain เช่น:

```text
hr.lomnuer.com
```

ก่อนเปิดใช้งาน:

- DNS
- TLS certificate
- Authentication
- Admin account
- ไม่ใช้ Default password
- ปิด Directory listing
- Backup
- Health check ที่ไม่เปิดข้อมูลภายใน

## Deployment pipeline ในอนาคต

```text
GitHub main
   │ tag/release
   ▼
Build/Test
   │
   ├── Deploy Control Plane
   └── Publish Worker package
          │
          ▼
      Manual rollout
```

Worker ไม่ควร auto-update ระหว่างมีคิว ควร:

1. Pause queue
2. ปิด Browser Session
3. Backup outbox/config
4. Update
5. Health check
6. Dry run
7. Resume

## Monitoring

ควรติดตาม:

- API availability
- DB connections
- Disk usage
- Evidence upload failure
- Worker heartbeat
- Queue lease expiry
- Target ที่ค้าง `submitting`
- Profile checkpoint/restriction
- Backup age
- Restore test result

## Disaster scenarios

| เหตุการณ์ | พฤติกรรมที่ต้องการ |
|---|---|
| HostAtom ล่ม | Workerหยุดรับงาน เก็บ Outbox ไม่โพสต์ต่อแบบมองไม่เห็น |
| Worker ล่มก่อน Submit | Lease หมดและให้ตรวจ/Retry ได้ |
| Worker ล่มหลัง Submit | Target เป็น unknown/manual review ห้าม Retry |
| Evidence upload ล้ม | เก็บไฟล์ Local และส่งใหม่ด้วย Hash |
| Database Restore | Idempotency ป้องกันโพสต์ซ้ำ |
| Credential รั่ว | Revoke Worker Key โดยไม่กระทบเครื่องอื่น |

## เกณฑ์ผ่านก่อน Production

- Restore ผ่าน
- Worker offline/online ผ่าน
- Lease ป้องกัน Duplicate ผ่าน
- Target หลัง Submit ไม่ Retry ผ่าน
- Authentication/Roles ผ่าน
- TLS ผ่าน
- Evidence Hash ผ่าน
- Session ไม่ถูกส่งเข้า Server ผ่าน
- Run หนึ่งรอบ Pilot ครบพร้อมหลักฐาน

[ถัดไป: แผนหลาย Facebook Profile](FACEBOOK-PROFILE-PLAN-TH.md)

