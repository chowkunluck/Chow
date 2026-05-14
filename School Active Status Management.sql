-- 1. เพิ่มคอลัมน์เช็คสถานะโรงเรียน
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. เพิ่มข้อมูลโรงเรียนตัวอย่าง (เปลี่ยนชื่อและ domain ตามจริง)
INSERT INTO schools (name, domain, is_active) 
VALUES ('โรงเรียนระยองวิทยาคม', 'rayongwit.ac.th', true)
ON CONFLICT (domain) DO NOTHING;