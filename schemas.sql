-- เปิดใช้งาน RLS (Row Level Security) สำหรับ Multi-Tenancy
-- Enable RLS for multi-tenancy

CREATE TABLE schools (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL, -- เช่น @rayongwit.ac.th
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE students (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id UUID REFERENCES schools(id) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    -- Optional student metadata used by Settings + Sociometric Balance (room vs grade)
    grade VARCHAR(50),
    room VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Helpful indexes for cohort queries (room / grade)
CREATE INDEX IF NOT EXISTS idx_students_school_grade ON students (school_id, grade);
CREATE INDEX IF NOT EXISTS idx_students_school_room ON students (school_id, room);

CREATE TABLE competency_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id UUID REFERENCES schools(id) NOT NULL,
    student_id UUID REFERENCES students(id) NOT NULL,
    logic_score INT NOT NULL CHECK (logic_score BETWEEN 0 AND 100),
    accuracy_score INT NOT NULL CHECK (accuracy_score BETWEEN 0 AND 100),
    analysis_score INT NOT NULL CHECK (analysis_score BETWEEN 0 AND 100),
    application_score INT NOT NULL CHECK (application_score BETWEEN 0 AND 100),
    connectivity_score INT NOT NULL CHECK (connectivity_score BETWEEN 0 AND 100),
    topic VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS Policy: แต่ละโรงเรียนเห็นเฉพาะข้อมูลของตัวเอง
-- RLS Policy: Each school sees only their own data
ALTER TABLE competency_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY school_isolation ON competency_logs
    USING (school_id = current_setting('app.current_school_id')::UUID);

-- ตารางสำหรับ Mental Health Monitoring (ตัวอย่างเพิ่มเติม)
-- Table for mental health monitoring (additional example)
CREATE TABLE mental_health_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id UUID REFERENCES schools(id) NOT NULL,
    student_id UUID REFERENCES students(id) NOT NULL,
    stress_level INT CHECK (stress_level BETWEEN 0 AND 100),
    fatigue_score INT CHECK (fatigue_score BETWEEN 0 AND 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
