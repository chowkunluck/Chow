-- 1. เพิ่มคอลัมน์เช็คสถานะการจ่ายเงิน (ถ้ายังไม่มี)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. เพิ่มข้อมูลโรงเรียนระยองวิทยาคม (ตัวอย่าง)
-- หมายเหตุ: domain ต้องไม่ใส่ @ นำหน้า
INSERT INTO schools (name, domain, is_active) 
VALUES ('โรงเรียนระยองวิทยาคม', 'rayongwit.ac.th', true)
ON CONFLICT (domain) DO UPDATE SET is_active = EXCLUDED.is_active;