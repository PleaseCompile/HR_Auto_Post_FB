# แผนหลาย Facebook Profile และการกู้คืน

[ศูนย์รวมเอกสาร](README.md) · [แผน HostAtom](HOSTATOM-HYBRID-PLAN-TH.md) · [ความปลอดภัย](SECURITY-TH.md) · [Roadmap](ROADMAP-TH.md)

> **สถานะ: แผนอนาคต ยังไม่มี Multi-profile ในระบบปัจจุบัน**

## เป้าหมาย

- แยกข้อมูลของแต่ละ Facebook Profile
- รู้ว่าใครโพสต์อะไร ไปกลุ่มใด และหลักฐานใด
- หยุดคิวอย่างปลอดภัยเมื่อ Session มีปัญหา
- เปลี่ยนผู้รับผิดชอบงานในอนาคตโดยไม่แก้ประวัติเดิม
- ไม่ใช้การหมุนบัญชีเพื่อหลบข้อจำกัดของ Meta

## แบ่งข้อมูลสองชั้น

### ข้อมูลกลาง

- Draft และ Draft Version
- รูปต้นฉบับ
- Campaign
- Canonical Group
- Tags/Province
- Work date/slot
- กฎกลุ่มที่ทีมบันทึก

### ข้อมูลตาม Profile

- Browser Profile reference
- Worker assignment
- Membership ของแต่ละกลุ่ม
- `can_post`
- `requires_approval`
- Last verification
- Last posted
- Restriction/checkpoint
- Run/Target/Evidence ผู้ดำเนินการ

หนึ่งกลุ่มอาจโพสต์ได้ใน Profile A แต่ Profile B ไม่ได้เป็นสมาชิก จึงห้ามเก็บ `can_post` ไว้ระดับกลุ่มกลางเพียงค่าเดียว

## Data model

### `facebook_profiles`

```text
id
display_label
facebook_user_id_masked
status
worker_id
browser_profile_ref
last_verified_at
last_health_check_at
created_at
retired_at
```

### `profile_group_memberships`

```text
profile_id
group_id
membership_status
can_post
requires_approval
last_checked_at
last_posted_at
note
```

### `profile_health_events`

```text
id
profile_id
event_type
severity
observed_url
evidence_id
message
created_at
resolved_at
resolved_by
```

### Run และ Evidence

เพิ่ม:

```text
runs.profile_id
runs.profile_snapshot
run_targets.profile_id
evidence.profile_id
evidence.worker_id
```

Run ต้องเก็บ Snapshot ชื่อ/Profile/สิทธิ์ที่ใช้ในเวลานั้น เพื่อให้ประวัติไม่เปลี่ยนเมื่อแก้ Profile ภายหลัง

## สถานะ Profile

```text
active
  ├── reauth_required ──> active
  ├── checkpoint ───────> active / restricted
  ├── temporarily_restricted ──> active / suspended
  ├── suspended ────────> active / disabled
  ├── disabled ─────────> retired
  └── retired
```

| สถานะ | สร้างคิวใหม่ | Resume | ต้องทำอะไร |
|---|---:|---:|---|
| `active` | ได้ | ได้ | Preflight ปกติ |
| `reauth_required` | ไม่ได้ | ไม่ได้ | Login/2FA |
| `checkpoint` | ไม่ได้ | ไม่ได้ | ผู้ใช้แก้ Checkpoint |
| `temporarily_restricted` | ไม่ได้ | ไม่ได้ | รอ/ตรวจ Account Status |
| `suspended` | ไม่ได้ | ไม่ได้ | Recovery/Appeal ทางการ |
| `disabled` | ไม่ได้ | ไม่ได้ | Retire หรือผล Appeal |
| `retired` | ไม่ได้ | ไม่ได้ | เก็บประวัติเท่านั้น |

## Circuit Breaker

เมื่อพบ Login page, CAPTCHA, Checkpoint, Warning หรือ Composer หายหลายกลุ่ม:

1. หยุดเปิดแท็บใหม่
2. Pause ทุก Run ของ Profile
3. ไม่ Retry
4. Screenshot
5. บันทึก URL/เวลา/Error
6. เปลี่ยน Profile status
7. แจ้งผู้ใช้
8. รอ Manual resolution

หลังแก้แล้ว:

1. Health check
2. Dry run หนึ่งกลุ่มที่ได้รับอนุญาต
3. ตรวจ Target ที่ผลไม่แน่นอน
4. Resume เฉพาะ Target ที่ยังไม่ Submit

## เพิ่ม Profile ใหม่

1. Admin สร้าง Profile record
2. กำหนด Worker
3. Worker สร้าง `userDataDir` ใหม่
4. ผู้ใช้ Login เอง
5. ทำ 2FA
6. ตรวจ Account ID แบบ Mask
7. Sync/Import กลุ่มที่บัญชีนั้นมีสิทธิ์
8. ผู้ใช้ตรวจ Membership mapping
9. Dry run
10. เปิดใช้งาน

แต่ละ Profile ต้องใช้ Browser Directory แยก ห้ามแชร์ Directory เดียวกันและห้ามเปิด Directory เดียวกันบนสอง Worker

## UI

### Profile switcher

แสดง:

- Avatar/ชื่อเรียก
- Account ID แบบ Mask
- Worker
- Health status
- Last verified
- จำนวนกลุ่มที่โพสต์ได้

### ทุกหน้าต้องมี Profile context

- Draft: เลือก Profile เมื่อสร้าง Run ไม่ต้องผูกตอนเขียนข้อความ
- Groups: แสดง Membership/Permission ตาม Profile
- Queue: แสดง Profile อย่างชัดเจน
- Evidence: Filter/Profile column
- Reports: Group by Profile

### การเปลี่ยน Default Profile

มีผลเฉพาะ Run ใหม่ ห้ามแก้ Profile ของ:

- Published
- Pending review
- Submitting
- Historical evidence

## ย้ายคิว

| Target status | ย้ายได้หรือไม่ | วิธี |
|---|---:|---|
| queued | ได้ | Clone ไป Run revision ใหม่ |
| opening | มีเงื่อนไข | ปิดแท็บเดิมแล้วตรวจ |
| preparing | มีเงื่อนไข | Cancel attempt และสร้างใหม่ |
| awaiting confirmation | ตรวจด้วยตนเอง | ตรวจว่า User กด Post หรือยัง |
| submitting | ไม่ได้อัตโนมัติ | Reconcile ก่อน |
| pending review | ไม่ได้ | รอตรวจโพสต์เดิม |
| published | ไม่ได้ | เก็บประวัติ |
| manual action required | ตรวจด้วยตนเอง | ตรวจ Facebook |
| failed before submit | ได้ | สร้าง Attempt ใหม่ |
| skipped | ได้ถ้ามีเหตุผล | ให้ผู้ใช้ยืนยัน |

## Idempotency

ระดับ Attempt:

```text
draft_version + group_id + profile_id + work_date + slot
```

ระดับ Business intent:

```text
campaign_id + group_id + work_date + slot
```

ระดับ Business intent ป้องกัน Profile B โพสต์ซ้ำสิ่งที่ Profile A ทำไปแล้ว

## ถ้าบัญชีถูกจำกัดหรือ Disabled

ระบบต้องรักษาประวัติของ Profile เดิม:

- ไม่ Rename ให้เป็น Profile ใหม่
- ไม่ย้าย Evidence ย้อนหลัง
- ไม่คัดลอก Cookie
- ไม่ Resume ด้วยบัญชีใหม่โดยอัตโนมัติ
- Pending/Unknown ต้อง Reconcile

การนำบัญชีใหม่มาใช้ต้องเป็นบัญชีจริงที่ได้รับอนุญาตและมี Membership ของตนเอง ไม่ใช่การหลบข้อจำกัด Meta Terms ห้ามการหลบเลี่ยงการควบคุมและการใช้งานที่ไม่ได้รับอนุญาต ดู [Meta Terms](https://www.facebook.com/terms/)

สำหรับ Suspended Account ให้ใช้ช่องทาง Recovery/Appeal ที่ Facebook แสดงเมื่อ Login ดู [Disabled or suspended account help](https://www.facebook.com/help/103873106370583)

## Profile health check

### เมื่อเปิด Worker

- Browser Profile เปิดได้
- Cookie/session ยังมี
- Facebook Home โหลด
- ไม่มี Checkpoint
- Account ID ตรงกับ Profile assignment

### ก่อนเริ่ม Run

- Profile active
- Worker lock ถูกต้อง
- Membership ของ Target ไม่หมดอายุ
- ไม่มี Unknown target จาก Run เดิม
- ไม่มีคำเตือนบัญชี

### ระหว่าง Run

- ตรวจ URL redirect
- ตรวจ Login dialog
- ตรวจ warning/checkpoint keywords
- ถ้าหลายกลุ่มล้มด้วย pattern เดียว ให้เปิด Circuit Breaker

## Security

- Browser Profile อยู่บน Worker
- Server เก็บเพียง Reference/Health metadata
- Disk encryption
- Separate OS account ถ้าหลายผู้ใช้
- Worker credential ไม่ใช่ Facebook credential
- Recovery Codes เก็บ Offline
- Revoke worker/device ได้
- Audit การ assign/reassign profile

## Migration จากข้อมูลปัจจุบัน

1. Backup
2. สร้าง `facebook_profiles`
3. สร้าง Default Profile ชื่อ “โปรไฟล์ปัจจุบัน”
4. Backfill Run/Target/Evidence เดิม
5. สร้าง `profile_group_memberships`
6. ย้าย `canPost`, `requiresApproval`, `lastPostedAt` ไป overlay
7. คง Canonical Group record
8. เพิ่ม Profile filters
9. ทดสอบประวัติ
10. ทดสอบ Rollback/Restore

ต้องตัดสินใจก่อน Migration ว่าค่าเดิมใน Group เป็นค่าของ Profile ปัจจุบันหรือข้อมูลกลางจากผู้ใช้

## Acceptance criteria

- สอง Profile เห็น Membership ต่างกัน
- Run ระบุ Profile เสมอ
- Evidence ระบุ Profile/Worker
- เปลี่ยน Default ไม่แก้ Historical Run
- Checkpoint หยุดทุก Run ของ Profile
- Profile อื่นไม่ถูกหยุดโดยไม่จำเป็น
- Unknown/Submitting ไม่ถูก Auto retry
- ย้ายคิวแล้วไม่เกิดโพสต์ซ้ำ
- ไม่มี Facebook Credential ใน Server DB

[ถัดไป: Roadmap](ROADMAP-TH.md)

