-- Run this once on your Railway PostgreSQL database to create all tables.

CREATE TABLE IF NOT EXISTS schools (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id UUID REFERENCES schools(id) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    grade VARCHAR(50),
    room VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_school_grade ON students (school_id, grade);
CREATE INDEX IF NOT EXISTS idx_students_school_room ON students (school_id, room);

CREATE TABLE IF NOT EXISTS competency_logs (
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

CREATE TABLE IF NOT EXISTS mental_health_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id UUID REFERENCES schools(id) NOT NULL,
    student_id UUID REFERENCES students(id) NOT NULL,
    stress_level INT CHECK (stress_level BETWEEN 0 AND 100),
    fatigue_score INT CHECK (fatigue_score BETWEEN 0 AND 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Seed: insert your school record here (change name/domain as needed)
INSERT INTO schools (name, domain, is_active)
VALUES ('โรงเรียนระยองวิทยาคม', 'rayongwit.ac.th', true)
ON CONFLICT (domain) DO NOTHING;
