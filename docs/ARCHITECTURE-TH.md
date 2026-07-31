# สถาปัตยกรรม HR Auto ปัจจุบัน

[ศูนย์รวมเอกสาร](README.md) · [พัฒนาและทดสอบ](DEVELOPMENT-TH.md) · [แผน HostAtom](HOSTATOM-HYBRID-PLAN-TH.md)

## ภาพรวม

```text
Browser UI (public/)
        │ HTTP /api/*
        ▼
Express Server (src/server.ts)
   ├── SQLite (data/hr-auto.sqlite)
   ├── Draft media (data/uploads)
   ├── Evidence (data/evidence)
   ├── Group scan snapshot (data/group-scans)
   └── Playwright Persistent Context
           └── data/browser-profile
                    │
                    ▼
                Facebook
```

ระบบเป็น Monolith บนเครื่องเดียว UI, API, Database, File Storage และ Playwright อยู่ใน Node.js Process เดียว

## Component

| ไฟล์ | ความรับผิดชอบ |
|---|---|
| `src/server.ts` | Express routes, validation, upload และ static UI |
| `src/db.ts` | Schema, query, รายงาน และ persistence |
| `src/session.ts` | Persistent Chromium Context, สถานะ Login และการสร้าง Window/Tab ผ่าน CDP |
| `src/facebook.ts` | เปิดกลุ่ม เตรียม Composer ส่งโพสต์และตรวจผล |
| `src/group-scanner.ts` | Automatic Group Scan และ JSON snapshot |
| `src/run-manager.ts` | Queue, หลายหน้าต่าง, Hybrid tabs, confirmation และ lifecycle |
| `src/config.ts` | Directory, Port, Timezone และ Locale |
| `public/app.js` | UI state, API client, event handling และ filters |
| `public/styles.css` | Layout และสีสถานะ |

## ขอบเขตความเชื่อถือ

```text
[ผู้ใช้]
   │ ยืนยัน
   ▼
[HR Auto UI/API] ── อ่าน/เขียน ── [Local Data]
   │
   └── ควบคุม ── [Chromium Profile] ── [Facebook]
```

ข้อมูลที่มีความเสี่ยงสูงสุดคือ `data/browser-profile/` เพราะอาจมี Session ที่ยัง Login อยู่ รองลงมาคือฐานข้อมูล รูป Draft และหลักฐาน

## Run State

Run:

```text
queued → running → awaiting_confirmation → completed
              ├→ paused → running
              ├→ stopped
              ├→ interrupted
              └→ failed
```

Target:

```text
queued → opening → preparing → awaiting_confirmation
                                  ├→ submitting → published
                                  ├→ submitting → pending_review
                                  ├→ mark-posted → published
                                  └→ skipped

ทุกขั้นอาจไป manual_action_required หรือ failed
```

`awaiting_confirmation` ไม่มี timeout โดยเจตนา ผู้ใช้ต้องเป็นผู้ตัดสินใจ

### การจัด Browser ของ `hybrid-windows`

Run หนึ่งใบใช้ Persistent Context เดียว จึงใช้ Cookie และ Facebook Profile เดียวกันทั้งหมด `src/session.ts` สร้าง top-level Chrome Window ใหม่เมื่อเริ่มชุด และสร้าง Target เพิ่มใน Window เดิมจนถึง `tabLimit` ซึ่งถูกจำกัด 1–30 จากนั้นจึงสร้าง Window ชุดถัดไป

```text
80 targets, tabLimit 30
├── Window 1: targets 1–30
├── Window 2: targets 31–60
└── Window 3: targets 61–80
```

Run Manager ยังคงอ้างอิง Page ของแต่ละ Target เพื่อ focus และเก็บหลักฐาน แต่ไม่เรียก `page.close()` สำหรับ Workflow นี้เมื่อยืนยัน ข้าม หรือหยุด ผู้ใช้เป็นเจ้าของการปิดแท็บ ส่วนการปิด Persistent Context ยังคงปิดทุก Window ตาม lifecycle ของ Playwright

## Data ownership

- Draft เป็นข้อมูลกลางของงานหนึ่งรอบ
- Media ผูกกับ Draft
- Run อ้าง Draft และ Workflow
- Run Target ผูก Run กับ Group
- System Evidence อ้างผ่าน `evidencePath` ใน Target
- Manual Evidence เป็นรายการแยกและแก้ไข/ลบได้
- Browser Profile เป็นข้อมูลระดับแอปหนึ่งชุดในเวอร์ชันปัจจุบัน

ข้อจำกัดสำคัญ: ระบบปัจจุบันยังไม่มี `facebook_profile_id` จึงรองรับ Session หลักหนึ่งชุด แผนแก้ไขอยู่ใน [FACEBOOK-PROFILE-PLAN-TH.md](FACEBOOK-PROFILE-PLAN-TH.md)

## Local-only network

Server เรียก:

```ts
app.listen(port, "127.0.0.1")
```

ผลคือเครื่องอื่นใน LAN และอินเทอร์เน็ตเข้าไม่ได้ ซึ่งเหมาะกับสถานะปัจจุบันที่ยังไม่มี:

- Authentication
- Authorization/Roles
- CSRF protection
- TLS termination
- Session management ของ HR Auto
- Worker API authentication

ห้ามเปลี่ยนเป็น `0.0.0.0` แล้ว Port Forward ออกอินเทอร์เน็ตโดยตรง

## ข้อจำกัดปัจจุบัน

- UI/API/Worker ล้มพร้อมกันเมื่อ Process ปิด
- SQLite เหมาะกับเครื่องเดียว ไม่เหมาะกับหลาย Server เขียนพร้อมกัน
- Browser Session มีชุดเดียว
- หน้าต่างของโหมด `hybrid-windows` ไม่ได้แยก Process/Profile และไม่รอดหลังปิด Browser Session หรือ Process
- ไม่มี Queue Lease ระหว่างหลาย Worker
- `.env` ยังไม่ถูกโหลดอัตโนมัติ
- ไม่มีระบบ Login ของ HR Auto
- ไฟล์หลักฐานอยู่ Local Filesystem
- Facebook UI เปลี่ยนแล้ว Locator อาจต้องปรับ

ข้อจำกัดเหล่านี้ไม่ได้ขัดกับการใช้ Local Assisted Workflow แต่ต้องแก้ก่อน Deploy แบบ Server/หลายผู้ใช้

[ถัดไป: พัฒนาและทดสอบ](DEVELOPMENT-TH.md)
