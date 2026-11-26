# PRESENCE — Digital Smart Attendance

PRESENCE is a QR-based student attendance system that runs entirely in the browser. An admin (professor) registers students, each student gets a personal QR code, and attendance is recorded by scanning that code with the device camera. Records can be reviewed by day, course, year level and section, and exported as CSV.

**Live site:** https://presence-oc.netlify.app/

---

## Features

### Scan QR for Attendance
- Starts the camera (prefers the back camera on phones) and scans continuously.
- Reads the QR with the browser's built-in `BarcodeDetector` when available, otherwise with **jsQR** running in a Web Worker so the page stays smooth.
- On a successful scan the student's photo, name, course, year level, student ID, sex, section, class attendance (e.g. `12 / 30 · 40%`), date and time are shown in the side panel.
- Feedback for every scan: reticle flash, short vibration, and a beep.
- One record per student per day. A second scan shows **"Already recorded today"**.
- A valid ID that is not registered shows **"Not Registered"** (attendance not recorded). A QR that is not a PRESENCE code shows a notification.
- **Stop Camera** turns the camera off; the sidebar shows `Camera off` or `Scanning…`.

### Register Student
- Fields: first name, last name, sex (Male / Female), course, year level (1st–4th Year), section, and a **student photo**.
- Course is free text with suggestions: BS Information Technology, BS Business Administration, BS Accountancy, BS Education, BS Nursing, BS Engineering.
- Photo cropper: drag to move, zoom with slider / mouse wheel / pinch, rotate 90°, and **Use Photo**. The photo is saved as a 320 px square JPEG.
- Validation: all fields and the photo are required, and the same name cannot be registered twice in the same course.
- A confirmation dialog appears before saving.
- A unique Student ID is generated (format `PRS-2026-0001`), and the **Registration Successful** dialog shows the QR code with **Download QR** and **Done**.

### Registered Students
- List of all students with photo, name, course, year level, section, ID and sex.
- Search by name, course, ID, sex, year level or section.
- Click a student to open their details: full information, registration date, days present, last attendance, their QR code (downloadable as PNG), and their attendance dates.
- **Remove Student** (with confirmation) deletes the student and disables their QR code. Past attendance records are kept.

### Attendance Record (today)
- Today's scans grouped by **course → year level → section**.
- Each section shows how many students are present out of those registered, with a percentage and progress bar.
- Click a student to open their details.
- **Export CSV** exports what the list currently shows.
- **Clear** resets today's list and percentages to zero. It does **not** delete saved records, and Attendance History is unchanged.

### Attendance History
- Calendar with month and year selectors, **Today** button, and the number of students present on each day.
- Click a date to see the courses that had attendees. Open a course to see its year levels and sections, then open one to see the students who attended and their times.
- **Export CSV** exports all attendance records.
- **Clear History** permanently deletes all attendance records (with confirmation). Registered students are kept.

### Interface
- Responsive layout: sidebar and panels adapt at 980 px and 720 px.
- Animated transitions, glass-style cards, toast notifications and confirmation dialogs.
- Work Sans font, navy and gold color scheme.

---

## Tech Stack

| Part | Technology |
|---|---|
| Structure / styling / logic | HTML, CSS, vanilla JavaScript (no framework, no build step) |
| QR reading | `BarcodeDetector` API, with [jsQR](https://github.com/cozmo/jsQR) 1.4.0 as fallback (backup CDNs: jsDelivr, unpkg) |
| QR generation | [qrcodejs](https://github.com/davidshimjs/qrcodejs) 1.0.0 |
| Font | Work Sans (Google Fonts) |
| Storage | Browser `localStorage` (JSON) |

---

## Project Structure

```
index.html   Page markup: sidebar, scanner, calendar, record, register form, dialogs
style.css    Styles, animations and responsive rules
app.js       All application logic
icon.png     App icon
```

---

## Running It

PRESENCE is a static site, so there is nothing to install.

**Online:** open https://presence-oc.netlify.app/

**Locally:**

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000
```

The camera only works on **HTTPS or `localhost`**, and the browser must be allowed to use the camera. The QR libraries load from a CDN, so an internet connection is needed the first time.

---

## How to Use

1. Click **Register Student**, fill in the form, add and crop a photo, then register. Download the student's QR code.
2. Click **Scan QR** and hold a student's QR code in front of the camera.
3. Open **Attendance Record** to see today's attendance, or **Attendance History** to browse past days.
4. Use **Export CSV** to save the records.

---

## Data

Everything is stored in the browser of the device being used. There is no server or database.

| localStorage key | Contents |
|---|---|
| `presence.students.v1` | Registered students |
| `presence.attendance.v1` | Attendance records |
| `presence.recordclear.v1` | Time of the last "Clear" on the Attendance Record |

**Student:** `id`, `firstName`, `lastName`, `sex`, `course`, `yearLevel`, `section`, `photo` (JPEG data URL), `registeredAt`

**Attendance record:** `studentId`, `name`, `course`, `yearLevel`, `section`, `date` (YYYY-MM-DD), `time`, `ts`

**CSV columns:** Date, Time, Student ID, Name, Course, Year Level, Section

The QR code contains only the Student ID (for example `PRS-2026-0001`).

---

## Limitations

- Data lives in one browser on one device. It is not shared between devices, and clearing the browser's site data deletes it. Export CSV regularly.
- Storage is limited by the browser. A "Storage is full" message appears if it runs out; removing students frees space.
- There is no login; anyone who opens the page on that device can use it.
- A student can only be recorded once per day.
- The camera is chosen automatically (back camera preferred). There is no manual camera picker.

---

## Author

Mark S. Velasco
Khrisson Jules O. Sumagaysay
Kent Lester R. Tigbayan
Ian Nadela
