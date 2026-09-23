# Facebook Session ถูกจำไว้ที่ไหน และทำงานยังไง

[ศูนย์รวมเอกสาร](README.md) · [ความปลอดภัย](SECURITY-TH.md) · [สำรอง/ย้ายเครื่อง](BACKUP-RESTORE-TH.md) · [แก้ปัญหา](TROUBLESHOOTING-TH.md)

เอกสารนี้ตอบคำถามว่า **"ทำไมเปิดโปรแกรมครั้งต่อไป แล้วกด `เชื่อมต่อ Facebook` ในหน้า `ตั้งค่าและ Session` มันเข้าบัญชีเดิมให้ทันที ไม่ต้องล็อกอินใหม่"**, ข้อมูลเก็บอยู่ไฟล์ไหน และมันทำงานยังไง

---

## สรุปสั้นก่อน

- HR Auto **ไม่ได้เก็บรหัสผ่าน Facebook** ของคุณเลย สิ่งที่จำไว้คือ **คุกกี้ (Cookie)** ที่ Facebook ให้มาตอนคุณล็อกอินครั้งแรก
- คุกกี้อยู่ในโฟลเดอร์ **`browser-profile/`** ซึ่งเป็น "โปรไฟล์ Chromium" เฉพาะของ HR Auto (แยกจาก Google Chrome ที่คุณใช้ปกติ)
- ทุกครั้งที่กด `เชื่อมต่อ Facebook` โปรแกรมจะเปิด Chromium **โดยใช้โฟลเดอร์เดิมนี้ซ้ำ** Chromium เลยส่งคุกกี้เดิมไปให้ Facebook และ Facebook ก็จำได้ว่าเป็นคุณ
- หลักการเดียวกับ Chrome ที่คุณใช้ทุกวัน ปิดแล้วเปิดใหม่ก็ยังล็อกอินอยู่ ต่างกันแค่ HR Auto ใช้โฟลเดอร์โปรไฟล์ของตัวเอง
- คุกกี้ถูก **เข้ารหัสด้วย Windows (DPAPI)** ผูกกับ "ผู้ใช้ Windows บนเครื่องนี้" ก๊อปโฟลเดอร์ไปเครื่องอื่นจึงใช้ไม่ได้ ต้องล็อกอินใหม่

> ⚠️ **โฟลเดอร์ `browser-profile/` มีค่าเท่ากับบัญชี Facebook ที่ล็อกอินค้างไว้** ห้ามส่งให้ใคร ห้ามขึ้น Git, Google Drive หรือ OneDrive

---

## 1. เกิดอะไรขึ้นเมื่อกด "เชื่อมต่อ Facebook"

```text
[หน้าเว็บ HR Auto]  กดปุ่ม "เชื่อมต่อ Facebook"
        │
        │  POST /api/session/connect
        ▼
[เซิร์ฟเวอร์ HR Auto (Node.js)]
   1) จองโปรไฟล์ → สร้างไฟล์ browser-session.lock (ใส่ PID ของโปรแกรม)
      ถ้ามี HR Auto อีกตัวจองอยู่ → ปฏิเสธ ไม่เปิดซ้อน
   2) เรียก launchPersistentContext("<data>/browser-profile")
      = เปิด Chromium โดยใช้โฟลเดอร์โปรไฟล์เดิมทุกครั้ง
        │
        ▼
[Chromium]
   3) อ่านไฟล์ "Local State" → ขอให้ Windows (DPAPI) ปลดล็อกกุญแจถอดรหัส
   4) ใช้กุญแจนั้นถอดรหัสคุกกี้ในไฟล์ Default/Network/Cookies
   5) เปิด https://www.facebook.com/ พร้อมแนบคุกกี้ c_user, xs, datr, ...
        │
        ▼
[Facebook]
   เห็นคุกกี้ที่ยังไม่หมดอายุ → จำได้ว่าเป็นบัญชีนี้ → แสดงหน้า Feed เลย ไม่ถามรหัส
        │
        ▼
[หน้า ตั้งค่าและ Session]
   6) ถามเซิร์ฟเวอร์ว่า "มีคุกกี้ชื่อ c_user ไหม?"
      มี  → Authentication: พร้อมใช้งาน + โชว์เลขบัญชี 4 ตัวท้าย
      ไม่มี → ยังไม่พร้อม (ต้องล็อกอินในหน้าต่าง Chromium)
```

ขั้นตอนตามโค้ดจริง:

| ขั้น | เกิดอะไรขึ้น | โค้ด |
|---|---|---|
| ปุ่ม | ปุ่มเปลี่ยนข้อความตามสถานะ: ถ้า Browser ปิดอยู่เขียนว่า `เชื่อมต่อ Facebook` ถ้าเปิดอยู่แล้วเขียนว่า `เปิดหน้าต่าง Facebook` | [public/app.js](../public/app.js) (`renderSettings`, action `connect-session`) |
| API | หน้าเว็บยิง `POST /api/session/connect` | [src/server.ts](../src/server.ts) (`/api/session/connect`) |
| จองโปรไฟล์ | เขียนไฟล์ `browser-session.lock` เก็บ PID ของโปรแกรม ถ้าไฟล์มีอยู่แล้วและ PID นั้นยังทำงาน จะปฏิเสธ เพื่อไม่ให้ HR Auto สองตัวแย่งโปรไฟล์เดียวกัน | [src/session.ts](../src/session.ts) (`acquireProfileLock`) |
| เปิด Chromium | เรียก `chromium.launchPersistentContext(browserProfileDirectory, ...)` คำว่า **Persistent** แปลว่า "ใช้โฟลเดอร์โปรไฟล์ถาวร" ทุกอย่างที่ Chromium จำ (คุกกี้, Local Storage, ประวัติ) ถูกเขียนลงโฟลเดอร์นี้และอ่านกลับมาใช้ครั้งหน้า | [src/session.ts](../src/session.ts) (`launchInternal`) |
| เปิดหน้าแรก | ถ้าแท็บแรกยังว่าง จะเปิด `https://www.facebook.com/` (เปลี่ยนได้ด้วย `HR_AUTO_SESSION_HOME_URL`) | [src/session.ts](../src/session.ts) (`launchInternal`) |
| ตรวจสถานะ | อ่านคุกกี้ของ `facebook.com` หาคุกกี้ชื่อ `c_user` ถ้ามีถือว่าล็อกอินแล้ว | [src/session.ts](../src/session.ts) (`status`) |

ตำแหน่งโฟลเดอร์ทั้งหมดถูกกำหนดที่เดียวใน [src/config.ts](../src/config.ts):

```ts
export const browserProfileDirectory = path.join(dataDirectory, "browser-profile");
export const browserSessionLockPath  = path.join(dataDirectory, "browser-session.lock");
export const browserEventLogPath     = path.join(dataDirectory, "browser-events.jsonl");
```

---

## 2. เก็บไว้ที่ไหนในเครื่อง

ขึ้นกับว่าคุณเปิดโปรแกรมด้วยวิธีไหน **สองวิธีนี้ใช้โฟลเดอร์คนละที่ ล็อกอินไม่ได้ใช้ร่วมกัน**

| วิธีเปิดโปรแกรม | โฟลเดอร์ข้อมูล (`<data>`) | ตัวที่กำหนด |
|---|---|---|
| ติดตั้งจาก **Setup.exe** แล้วกดไอคอน HR Auto | `C:\Users\<ชื่อผู้ใช้>\AppData\Local\HR-Auto\data\` | [installer/launcher.ps1](../installer/launcher.ps1) บังคับค่านี้ทุกครั้ง |
| รันจาก **Source Code** (`start-windows.ps1` หรือ `npm start`) | `<โฟลเดอร์โปรเจกต์>\data\` เช่น `D:\HR-Auto\data\` | ค่าเริ่มต้นใน [src/config.ts](../src/config.ts) |
| รันจาก Source Code และตั้ง `HR_AUTO_DATA_DIR` เอง | โฟลเดอร์ที่คุณตั้ง | Environment Variable |

ดูว่าโปรแกรมที่เปิดอยู่ใช้โฟลเดอร์ไหน: เปิด <http://127.0.0.1:4173/api/health> แล้วดูค่า `dataDirectory`

เปิดโฟลเดอร์ของเวอร์ชัน Setup.exe เร็ว ๆ: กด `Win + R` แล้ววาง

```text
%LOCALAPPDATA%\HR-Auto\data\browser-profile
```

> 💡 ถ้าเคยล็อกอินในเวอร์ชัน Source Code แล้วไปเปิดเวอร์ชัน Setup.exe (หรือกลับกัน) จะเจอว่า "ยังไม่ได้ล็อกอิน" เพราะมันไปอ่านคนละโฟลเดอร์ ไม่ได้แปลว่า Session หาย

---

## 3. ไฟล์ไหนคือ "ตัวล็อกอิน"

`browser-profile/` คือโฟลเดอร์โปรไฟล์ของ Chromium มาตรฐาน ข้างในมีไฟล์หลายร้อยไฟล์ แต่ที่เกี่ยวกับการล็อกอินมีไม่กี่ตัว:

```text
<data>/
├── browser-profile/                    ← โปรไฟล์ Chromium ของ HR Auto
│   ├── Local State                     ← ★ มีกุญแจถอดรหัสคุกกี้ (os_crypt.encrypted_key)
│   │                                     ถูกล็อกด้วย Windows DPAPI
│   ├── lockfile                        ← Chromium สร้างเองตอนเปิด กันเปิดโปรไฟล์ซ้อน
│   └── Default/
│       ├── Network/
│       │   └── Cookies                 ← ★★ ตัวจริง: ฐานข้อมูล SQLite เก็บคุกกี้ทุกเว็บ
│       │                                 รวมคุกกี้ Facebook (c_user, xs, datr, ...)
│       ├── Local Storage/              ← ข้อมูลที่หน้าเว็บ Facebook เก็บไว้ในเครื่อง
│       ├── IndexedDB/                  ← ข้อมูลที่หน้าเว็บ Facebook เก็บไว้ในเครื่อง
│       ├── Session Storage/, Sessions/ ← แท็บ/หน้าต่างล่าสุด
│       ├── Login Data                  ← รหัสผ่านที่ "Chromium" บันทึก (ปกติว่าง ดูหมายเหตุ)
│       ├── Preferences                 ← การตั้งค่าของ Chromium
│       └── Cache/, Code Cache/, GPUCache/  ← แคช (ลบได้ตอนปิด Browser ไม่กระทบการล็อกอิน)
├── browser-session.lock                ← HR Auto สร้าง: บอกว่าโปรแกรม PID ไหนกำลังใช้โปรไฟล์
└── browser-events.jsonl                ← HR Auto สร้าง: บันทึกเหตุการณ์ Browser ไว้วิเคราะห์ปัญหา
```

### คุกกี้ Facebook ที่สำคัญ

| คุกกี้ | ความหมายโดยประมาณ |
|---|---|
| `c_user` | เลข ID บัญชี Facebook ที่ล็อกอินอยู่ HR Auto ใช้ตัวนี้ตัดสินว่า "ล็อกอินแล้วหรือยัง" |
| `xs` | รหัสลับของ Session นี้ **คู่กับ `c_user` คือสิ่งที่ทำให้เข้าบัญชีได้โดยไม่ต้องใส่รหัสผ่าน** |
| `datr` | ตัวระบุเบราว์เซอร์/อุปกรณ์ Facebook ใช้จำว่า "เคยเห็นเครื่องนี้แล้ว" ช่วยให้โดนถามยืนยันตัวตนน้อยลง |

คุกกี้เหล่านี้มี **วันหมดอายุ** ที่ Facebook กำหนด (ปกติยาวหลายเดือน) และ Facebook จะต่ออายุให้เองเมื่อมีการใช้งาน จึงยังล็อกอินอยู่ได้นานถ้าเปิดใช้เป็นประจำ

### หมายเหตุเรื่อง `Login Data` (รหัสผ่าน)

HR Auto ไม่เคยพิมพ์หรือบันทึกรหัสผ่านเอง แต่ถ้าตอนล็อกอิน Chromium เด้งถามว่า **"บันทึกรหัสผ่านไหม"** แล้วคุณกด "บันทึก" รหัสจะไปอยู่ใน `Login Data` ของโปรไฟล์นี้ **แนะนำให้กด "ไม่ต้อง/Never"** เพราะ Session จากคุกกี้ก็พอแล้ว

### ห้ามเปิดไฟล์ `Cookies` ขณะ Browser เปิดอยู่

Chromium ล็อกไฟล์ `Cookies` ไว้ตลอดเวลาที่เปิดอยู่ โปรแกรมอื่นอ่านไม่ได้ และห้ามแก้หรือลบเด็ดขาด ถ้าไฟล์เสีย Session จะหายและต้องล็อกอินใหม่

---

## 4. ทำไมก๊อปไปเครื่องอื่นแล้วใช้ไม่ได้ (Windows DPAPI)

ค่าในไฟล์ `Cookies` **ไม่ได้เก็บเป็นตัวอักษรธรรมดา** แต่ถูกเข้ารหัสสองชั้น:

```text
ค่า cookie (เช่น xs=...)
   │  เข้ารหัสด้วย AES-256-GCM
   ▼
เก็บใน Default/Network/Cookies  ←─ ต้องใช้ "กุญแจ AES" ถึงจะอ่านได้
                                        │
                     กุญแจ AES เก็บใน "Local State" (os_crypt.encrypted_key)
                                        │  แต่กุญแจเองก็ถูกล็อกด้วย
                                        ▼
                     Windows DPAPI  ── ผูกกับ "บัญชีผู้ใช้ Windows บนเครื่องนี้"
```

(ถ้าเอาค่า `os_crypt.encrypted_key` ในไฟล์ `Local State` มาถอด Base64 จะเห็นว่าขึ้นต้นด้วยคำว่า `DPAPI` ซึ่งเป็นป้ายบอกว่ากุญแจนี้ถูกล็อกด้วย Windows)

**DPAPI** คือระบบของ Windows ที่ให้โปรแกรมเข้ารหัสข้อมูลด้วยกุญแจที่มาจากบัญชีผู้ใช้ Windows ผลคือ:

| สถานการณ์ | ถอดรหัสคุกกี้ได้ไหม | ผล |
|---|---|---|
| เครื่องเดิม ผู้ใช้ Windows เดิม | ✅ ได้ | ล็อกอินค้างตามปกติ |
| เครื่องเดิม แต่ **ผู้ใช้ Windows คนอื่น** | ❌ ไม่ได้ | เหมือนยังไม่เคยล็อกอิน |
| ก๊อป `browser-profile` ไป **เครื่องอื่น** | ❌ ไม่ได้ | เหมือนยังไม่เคยล็อกอิน |
| ก๊อปข้าม Windows ↔ Linux | ❌ ไม่ได้ | ระบบเข้ารหัสต่างกันคนละแบบ |
| เปลี่ยนรหัสผ่าน Windows ด้วยตัวเองตามปกติ | ✅ ได้ | Windows ย้ายกุญแจให้เอง |
| แอดมิน **รีเซ็ต** รหัส Windows ให้ (ไม่ได้เปลี่ยนเอง) | ⚠️ อาจไม่ได้ | อาจต้องล็อกอิน Facebook ใหม่ |

นี่คือเหตุผลที่คู่มือทุกฉบับบอกว่า **ไปเครื่องใหม่ให้ล็อกอินใหม่ อย่าก๊อปโปรไฟล์** มันไม่ใช่แค่เรื่องความปลอดภัย แต่ก๊อปไปแล้ว **ใช้ไม่ได้จริง** และถ้าบังเอิญถอดรหัสได้ Facebook ก็อาจเห็นว่าคุกกี้เดิมถูกใช้จากอีกเครื่องแล้วขอยืนยันตัวตน (Checkpoint)

> DPAPI กันได้แค่การ "ขโมยไฟล์ไปเปิดที่เครื่องอื่น" **กันไม่ได้** ถ้ามีคนหรือมัลแวร์เข้ามาใช้ Windows ในชื่อคุณบนเครื่องนี้ จึงยังต้องตั้งรหัส Windows และเปิด BitLocker ตาม [SECURITY-TH.md](SECURITY-TH.md)

---

## 5. HR Auto รู้ได้ยังไงว่า "ล็อกอินแล้ว"

หน้า `ตั้งค่าและ Session` แสดงข้อมูลจาก `GET /api/session` ซึ่งทำแบบนี้ ([src/session.ts](../src/session.ts) ฟังก์ชัน `status`):

```ts
const cookies = await this.context.cookies("https://www.facebook.com/");
const accountCookie = cookies.find((cookie) => cookie.name === "c_user");
// มี c_user → authenticated = true
// โชว์เลขบัญชีแบบปิดบัง เหลือ 4 ตัวท้าย เช่น ***********1234
```

| ช่องบนหน้าจอ | มาจาก |
|---|---|
| Browser: เปิดอยู่/ปิดอยู่ | HR Auto กำลังถือ Chromium อยู่หรือไม่ |
| Authentication: พร้อมใช้งาน/ยังไม่พร้อม | มีคุกกี้ `c_user` หรือไม่ |
| Account cookie | ค่า `c_user` แบบปิดบังเหลือ 4 ตัวท้าย |
| Profile owner | PID ใน `browser-session.lock` |
| Renderer crash / Page error | นับจากเหตุการณ์ Chromium ตั้งแต่เปิดโปรแกรม |

**ข้อจำกัด:** เช็กแค่ว่า "มีคุกกี้ไหม" ไม่ได้ถาม Facebook ว่ายังใช้ได้จริงไหม ถ้าหน้าจอบอก "พร้อมใช้งาน" แต่หน้าต่าง Chromium ขึ้นหน้าล็อกอินหรือ Checkpoint **ให้เชื่อหน้าต่าง Chromium** แล้วล็อกอินใหม่ในหน้าต่างนั้น

ก่อนกดเชื่อมต่อ (Browser ปิดอยู่) หน้าจอจะขึ้น "ยังไม่พร้อม" เสมอ เพราะยังไม่ได้เปิดโปรไฟล์ขึ้นมาอ่านคุกกี้ **ไม่ได้แปลว่า Session หาย**

---

## 6. ไฟล์ประกอบที่ HR Auto สร้างเอง

### `browser-session.lock`

ตัวอย่างเนื้อหา:

```json
{
  "pid": 12345,
  "startedAt": "2026-09-23T02:45:04.997Z",
  "profile": "D:\\HR-Auto\\data\\browser-profile"
}
```

- `pid` คือหมายเลข Process ของ **โปรแกรม HR Auto (node.exe)** ไม่ใช่ของ Chromium
- สร้างตอนกดเชื่อมต่อ ลบเองตอนกด `ปิด Browser` หรือปิดโปรแกรม
- ถ้าโปรแกรมปิดผิดปกติจนไฟล์ค้าง ครั้งหน้าระบบจะเช็กว่า PID นั้นยังทำงานไหม ถ้าไม่แล้วจะลบให้เองอัตโนมัติ
- **ไม่เกี่ยวกับการจำล็อกอิน** ลบแล้วไม่ทำให้ Session หาย (แต่อย่าลบขณะ Browser เปิดอยู่)

### `browser-events.jsonl`

บันทึกเหตุการณ์ทีละบรรทัด เช่น `session_launching`, `session_launched`, `page_crashed`, `context_closed_unexpectedly` ใช้ดูย้อนหลังตอน Browser มีปัญหา เกิน 5 MB จะย้ายไปเป็น `browser-events.jsonl.previous` แล้วเริ่มไฟล์ใหม่ **ไม่มีคุกกี้หรือรหัสผ่านอยู่ในไฟล์นี้**

---

## 7. ทำสิ่งนี้แล้ว Session ยังอยู่ไหม

| เหตุการณ์ | ยังล็อกอินอยู่ไหม | เหตุผล |
|---|---|---|
| กด `ปิด Browser` แล้วกด `เชื่อมต่อ Facebook` ใหม่ | ✅ อยู่ | ปิดแค่ Chromium โฟลเดอร์ยังอยู่ |
| ปิดหน้าต่างดำ / กด `Ctrl + C` แล้วเปิดโปรแกรมใหม่ | ✅ อยู่ | ปกติ Chromium จะปิดตามไปด้วย แต่คุกกี้ถูกเขียนลงดิสก์ไว้แล้ว |
| รีสตาร์ทเครื่อง / ไฟดับ | ✅ ปกติอยู่ | Chromium เขียนคุกกี้ลงดิสก์เป็นระยะ คุกกี้ล็อกอินถูกเขียนไว้ตั้งแต่ตอนล็อกอิน |
| อัปเดตด้วย `git pull` + `npm install` + `npm run install-browser` | ✅ อยู่ | `data/` อยู่ใน `.gitignore` ไม่มีคำสั่งไหนแตะ |
| ถอนการติดตั้ง Setup.exe | ✅ อยู่ | ตัวถอนไม่ลบ `%LOCALAPPDATA%\HR-Auto` (ตั้งใจไว้) ติดตั้งใหม่ก็ใช้ต่อได้ |
| ลบเฉพาะ `Cache`, `Code Cache`, `GPUCache` ตอน Browser ปิด | ✅ อยู่ | แคชไม่เกี่ยวกับการล็อกอิน |
| กด **ออกจากระบบ (Log out)** ใน Facebook ในหน้าต่าง Chromium ของ HR Auto | ❌ หลุด | Facebook ลบคุกกี้ `c_user`/`xs` |
| เปลี่ยนรหัส Facebook หรือกด "ออกจากระบบทุกอุปกรณ์" | ❌ มักหลุด | Facebook ยกเลิก Session ฝั่งเซิร์ฟเวอร์ |
| ไม่ได้เปิดใช้นานหลายเดือน | ⚠️ อาจหลุด | คุกกี้หมดอายุ |
| Facebook ขอยืนยันตัวตน (Checkpoint) | ⚠️ ต้องยืนยันก่อน | ทำในหน้าต่าง Chromium ด้วยตัวเอง |
| สลับระหว่างเวอร์ชัน Source Code กับ Setup.exe | ❌ ดูเหมือนหลุด | คนละโฟลเดอร์ (ดูข้อ 2) |
| เปลี่ยน `HR_AUTO_DATA_DIR` ไปโฟลเดอร์ใหม่ | ❌ ดูเหมือนหลุด | โฟลเดอร์ใหม่ยังไม่มีโปรไฟล์ |
| ย้ายเครื่อง / เปลี่ยนผู้ใช้ Windows | ❌ หลุด | DPAPI (ดูข้อ 4) |
| ลบ `browser-profile/` ทั้งโฟลเดอร์ | ❌ หลุด | ลบคุกกี้ทิ้งทั้งหมด |
| ล็อกเอาต์ใน **Google Chrome ปกติ** ของคุณ | ✅ ไม่กระทบ | Chrome ปกติกับ Chromium ของ HR Auto คนละโปรไฟล์ คนละโปรแกรม |

---

## 8. วิธีออกจากระบบ / เปลี่ยนบัญชี / เริ่มใหม่

### ออกจากระบบ หรือเปลี่ยนไปใช้บัญชีอื่น (วิธีแนะนำ)

1. หยุดคิวที่กำลังทำงานให้หมด
2. หน้า `ตั้งค่าและ Session` → กด `เชื่อมต่อ Facebook` (หรือ `เปิดหน้าต่าง Facebook`)
3. ในหน้าต่าง Chromium ที่เปิดขึ้น กดรูปโปรไฟล์มุมขวาบน → **ออกจากระบบ**
4. ล็อกอินบัญชีที่ต้องการ แล้วทำ 2FA เอง
5. กลับมาหน้า HR Auto กด `ตรวจ Session` เลข 4 ตัวท้ายใน `Account cookie` ต้องเปลี่ยนตามบัญชีใหม่

### ล้างโปรไฟล์แล้วเริ่มใหม่ทั้งหมด (ใช้เมื่อโปรไฟล์เสียหรือ Browser เปิดไม่ขึ้นเรื้อรัง)

1. หยุดคิว → กด `ปิด Browser` → ปิดหน้าต่างดำของ HR Auto
2. **เปลี่ยนชื่อ** (อย่าเพิ่งลบ) โฟลเดอร์ `browser-profile` เป็น เช่น `browser-profile-old-20260923`
3. เปิด HR Auto ใหม่ ระบบจะสร้าง `browser-profile` ว่างให้เอง
4. กด `เชื่อมต่อ Facebook` แล้วล็อกอินใหม่
5. ใช้งานได้ปกติแล้วค่อยลบโฟลเดอร์เก่าทิ้ง

### เครื่องหาย หรือสงสัยว่าโปรไฟล์หลุดไปถึงคนอื่น

ทำจากอุปกรณ์อื่นที่เชื่อถือได้: Facebook → การตั้งค่า → **ศูนย์บัญชี** → รหัสผ่านและความปลอดภัย → **ตำแหน่งที่คุณเข้าสู่ระบบ** → ออกจากระบบอุปกรณ์นั้น แล้วเปลี่ยนรหัสผ่าน รายละเอียดเพิ่มเติมอยู่ที่ [SECURITY-TH.md](SECURITY-TH.md) หัวข้อ Incident response

---

## 9. คำถามที่พบบ่อย

**Q: HR Auto เก็บรหัสผ่าน Facebook ของฉันไว้ไหม?**
ไม่เก็บ ไม่มีช่องให้กรอกรหัสในโปรแกรมเลย คุณพิมพ์รหัสในหน้าต่าง Chromium ส่งตรงไป Facebook ส่วนที่เก็บไว้คือคุกกี้ที่ Facebook ตอบกลับมา

**Q: แล้วทำไมไม่ต้องกรอกรหัสอีก?**
เพราะเว็บส่วนใหญ่รวมถึง Facebook ไม่ได้ถามรหัสทุกครั้ง มันดูคุกกี้ ถ้าคุกกี้ยังใช้ได้ก็ให้เข้าเลย เหมือน Chrome ที่คุณปิดแล้วเปิดใหม่ก็ยังล็อกอินอยู่

**Q: Chromium ที่เปิดขึ้นมาคือ Google Chrome ในเครื่องฉันหรือเปล่า?**
ไม่ใช่ เป็น Chromium ที่มากับ Playwright (ตัวควบคุมเบราว์เซอร์) แยกกันคนละโปรแกรม คนละโปรไฟล์ บุ๊กมาร์ก, ส่วนขยาย และบัญชีใน Chrome ปกติของคุณไม่ถูกแตะเลย
- เวอร์ชัน Setup.exe: Chromium อยู่ใน `%LOCALAPPDATA%\Programs\HR Auto\browsers\`
- เวอร์ชัน Source Code: Chromium อยู่ใน `%LOCALAPPDATA%\ms-playwright\` (ลงด้วย `npm run install-browser`)

**Q: ทำไมโฟลเดอร์ `browser-profile` ใหญ่หลายร้อย MB?**
เกือบทั้งหมดเป็นแคช (รูป วิดีโอ สคริปต์ของ Facebook) ตัวคุกกี้จริงมีขนาดแค่หลักสิบ KB ถ้าอยากลดขนาด ให้ปิด Browser ก่อนแล้วลบเฉพาะ `Default\Cache`, `Default\Code Cache`, `Default\GPUCache` ห้ามลบ `Cookies`, `Local Storage` หรือทั้งโฟลเดอร์

**Q: เปิด HR Auto สองหน้าต่างพร้อมกันได้ไหม?**
ไม่ได้ถ้าใช้โฟลเดอร์ข้อมูลเดียวกัน ไฟล์ `browser-session.lock` จะกันไว้ และ Chromium เองก็ไม่ยอมให้สองโปรแกรมเปิดโปรไฟล์เดียวกัน (ขึ้นว่า Profile ถูกใช้งาน) ดูวิธีแก้ใน [TROUBLESHOOTING-TH.md](TROUBLESHOOTING-TH.md) หัวข้อ Browser Profile ถูกล็อก

**Q: หน้า Settings บอก "ยังไม่พร้อม" ทั้งที่เมื่อวานยังใช้ได้**
เช็กตามลำดับ:
1. กด `เชื่อมต่อ Facebook` แล้วหรือยัง (ก่อนเปิด Browser จะขึ้น "ยังไม่พร้อม" เสมอ)
2. เปิดโปรแกรมถูกตัวไหม ดู `dataDirectory` ใน <http://127.0.0.1:4173/api/health>
3. ดูหน้าต่าง Chromium ว่า Facebook ขึ้นหน้าล็อกอินหรือ Checkpoint หรือไม่ ถ้าใช่ให้ล็อกอินใหม่ในหน้าต่างนั้น

**Q: ส่งโปรแกรมให้เพื่อนใช้ ต้องส่ง `browser-profile` ไปด้วยไหม?**
ห้ามส่ง นอกจากจะใช้ไม่ได้ (ข้อ 4) ยังเท่ากับยกบัญชี Facebook ของคุณให้คนอื่น ให้เพื่อนติดตั้งแล้วล็อกอินบัญชีของเขาเอง ไฟล์ Setup.exe ไม่มี Session ของใครติดไปอยู่แล้ว

---

## 10. อ้างอิงโค้ด

| ไฟล์ | สิ่งที่ดู |
|---|---|
| [src/config.ts](../src/config.ts) | กำหนดตำแหน่ง `browser-profile`, `browser-session.lock`, `browser-events.jsonl` |
| [src/session.ts](../src/session.ts) | `BrowserSessionManager`: จองโปรไฟล์, `launchPersistentContext`, ตรวจคุกกี้ `c_user`, ปิด Browser |
| [src/server.ts](../src/server.ts) | `GET /api/session`, `POST /api/session/connect`, `POST /api/session/close` |
| [public/app.js](../public/app.js) | `renderSettings()` หน้า `ตั้งค่าและ Session` และ action `connect-session` / `close-session` |
| [installer/launcher.ps1](../installer/launcher.ps1) | บังคับโฟลเดอร์ข้อมูลของเวอร์ชัน Setup.exe เป็น `%LOCALAPPDATA%\HR-Auto\data` |

[ถัดไป: ความปลอดภัย](SECURITY-TH.md) · [สำรองและย้ายเครื่อง](BACKUP-RESTORE-TH.md)
