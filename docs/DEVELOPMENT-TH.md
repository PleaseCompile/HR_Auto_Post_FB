# คู่มือพัฒนาและทดสอบ

[ศูนย์รวมเอกสาร](README.md) · [สถาปัตยกรรม](ARCHITECTURE-TH.md) · [Roadmap](ROADMAP-TH.md)

## Toolchain

- Node.js `>=22`
- TypeScript
- Express 5
- Playwright
- better-sqlite3
- Vanilla HTML/CSS/JavaScript

## ติดตั้ง

```bash
npm install
npm run install-browser
```

Linux:

```bash
npx playwright install --with-deps chromium
```

## คำสั่ง

| คำสั่ง | หน้าที่ |
|---|---|
| `npm run dev` | รัน `tsx watch src/server.ts` |
| `npm run check` | TypeScript noEmit |
| `npm run build` | Compile ไป `dist/` |
| `npm start` | รัน `dist/server.js` |
| `npm run test:smoke` | รันทดสอบ composer, hybrid, scan, API, UI และปุ่ม |
| `npm run reset:queue-evidence` | ล้างข้อมูลคิว/หลักฐานจริง |

## โครงสร้าง

```text
src/       Backend, DB, Playwright และ Run manager
public/    Frontend
scripts/   Start/maintenance scripts
tests/     Smoke tests
examples/  ตัวอย่าง CSV
docs/      คู่มือภาษาไทย
data/      ข้อมูล Local ที่ไม่ขึ้น Git
dist/      Build output ที่ไม่ขึ้น Git
```

## Development loop

Terminal 1:

```bash
npm run dev
```

ก่อน commit:

```bash
npm run check
npm run build
npm run test:smoke
git status --short
```

Smoke tests บางส่วนอาจเปิด Server หรือ Browser ตาม Test implementation ต้องปิดคิวจริงและใช้ข้อมูลทดสอบ

## การทดสอบตามความเสี่ยง

### เปลี่ยน UI

- `npm run check`
- `tests/ui-smoke.mjs`
- `tests/button-audit.mjs`
- ตรวจด้วย Browser ที่ 1280×720 และจอใหญ่

### เปลี่ยน API/Database

- `tests/api-smoke.mjs`
- Backup/Restore จากฐานข้อมูลทดสอบ
- ตรวจ invalid input และ path traversal

### เปลี่ยน Facebook/Playwright

- `tests/facebook-composer.mjs`
- Dry run บัญชีทดสอบที่ได้รับอนุญาต
- ทดสอบ UI ภาษาไทยและอังกฤษ
- ทดสอบ group with approval
- ทดสอบ timeout และ tab closed

### เปลี่ยน Hybrid

- `tests/hybrid-run.mjs`
- `tests/windowed-run.mjs`
- `npm run test:window-session` สำหรับตรวจ Window ID จริง (เปิด Chromium ชั่วคราว)
- 1, 3 และหลายกลุ่ม
- Hybrid แบบเดิม: tabLimit 0 และค่าจำกัด
- หลายหน้าต่าง: 30 + 30 + ส่วนที่เหลือ, ปฏิเสธค่ามากกว่า 30
- pause/resume/stop
- ปิดแท็บระหว่าง awaiting confirmation
- ยืนยันว่า mark-posted, skip และ stop ไม่ปิดแท็บในโหมดหลายหน้าต่าง

### เปลี่ยน Group Scan

- `tests/group-scan-extraction.mjs`
- ทดสอบหยุด scan
- ทดสอบ duplicate external ID/URL
- ตรวจ JSON snapshot

## Database migration

ก่อนแก้ Schema:

1. Backup fixture
2. ออกแบบ migration ที่รันซ้ำได้
3. ห้ามแก้ประวัติ Run โดยไม่จำเป็น
4. เพิ่ม index สำหรับ filter ที่ใช้บ่อย
5. ทดสอบฐานข้อมูลว่าง
6. ทดสอบฐานข้อมูลจากเวอร์ชันก่อน
7. ทดสอบ rollback/restore

สำหรับแผนหลาย Profile ต้อง Backfill ข้อมูลเดิมเป็น Default Profile และย้าย membership fields อย่างระมัดระวัง ดู [FACEBOOK-PROFILE-PLAN-TH.md](FACEBOOK-PROFILE-PLAN-TH.md)

## Error handling

- Validation error ต้องตอบข้อความที่ผู้ใช้เข้าใจ
- Error ภายในไม่ควรเปิด path/secret ใน UI สาธารณะ
- Facebook timeout ต้องไม่ Retry หลัง Submit โดยไม่ตรวจผล
- File write ต้องจำกัดอยู่ใน Data Directory
- Delete ต้องตรวจ resolved path ก่อนลบ

## Git workflow

```bash
git status --short --branch
git switch -c agent/short-description
git add <เฉพาะไฟล์ที่เกี่ยวข้อง>
git diff --cached
git commit -m "short description"
git push -u origin HEAD
```

ตรวจว่า `data/`, `.env`, `dist/`, `node_modules/` และ `test-results/` ไม่ถูก stage

## Release checklist

- [ ] Version/README สอดคล้อง
- [ ] `npm install` จาก clean checkout ผ่าน
- [ ] ติดตั้ง Chromium ผ่าน
- [ ] `npm run check`
- [ ] `npm run build`
- [ ] `npm run test:smoke`
- [ ] ทดสอบ Windows start script
- [ ] ทดสอบ Linux start script
- [ ] ลิงก์เอกสารไม่เสีย
- [ ] ไม่มีข้อมูลจริงหรือ Session ใน Git
- [ ] ระบุ migration/backup instruction
- [ ] ทดสอบ Dry run ก่อน Assisted
