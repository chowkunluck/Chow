# ใช้ Python เวอร์ชันที่เป็น Linux
FROM python:3.11-slim

# ลง Library ระบบ (Linux) ที่จำเป็นต่อ OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libxcb1 \
    libx11-6 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# กำหนด Folder ทำงาน
WORKDIR /app

# คัดลอกทุกอย่างในโฟลเดอร์นี้ไปที่ /app
COPY . .

# ติดตั้ง Python Requirements
RUN pip install --no-cache-dir -r requirements.txt

# สั่งให้แอปทำงาน (เว้นวรรคหลัง CMD ถูกต้องแล้วครับ)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]