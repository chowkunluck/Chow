"""
Intelligent Analysis System - Complete with Standard JWT Auth
ระบบวิเคราะห์อัจฉริยะแบบรวมทุกฟีเจอร์ พร้อมระบบล็อกอินมาตรฐาน
"""

import os
import io
import cv2
import numpy as np
import json
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from contextlib import contextmanager

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Depends,
    HTTPException,
    Query,
    status,
    Security,
)
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from PIL import Image
from google import genai
from google.genai import types
import psycopg2
from psycopg2 import pool as pg_pool
from psycopg2.extras import RealDictCursor
from jose import JWTError, jwt
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()


def _parse_cors_origins() -> List[str]:
    """Explicit origins when using credentials (browser forbids * + credentials)."""
    defaults = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ]
    extra = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if not extra:
        return defaults
    merged = defaults + [o.strip() for o in extra.split(",") if o.strip()]
    seen: set = set()
    out: List[str] = []
    for o in merged:
        if o not in seen:
            seen.add(o)
            out.append(o)
    return out


# ==================== Configuration ====================
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
_jwt_secret_raw = os.getenv("JWT_SECRET")
JWT_SECRET = (
    _jwt_secret_raw.strip()
    if isinstance(_jwt_secret_raw, str) and _jwt_secret_raw.strip()
    else "my-secret-key-123"
)
if not (isinstance(_jwt_secret_raw, str) and _jwt_secret_raw.strip()):
    print("JWT_SECRET missing or empty in .env; using fallback dev secret (set JWT_SECRET for production).")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash").strip() or "gemini-3-flash"
ANALYSIS_REASON_LANG = (os.getenv("ANALYSIS_REASON_LANG", "th") or "th").strip().lower()


# ==================== Database (Railway PostgreSQL) ====================
DATABASE_URL = os.getenv("DATABASE_URL")
DB_ENABLED = bool(DATABASE_URL)
_db_pool: Optional[pg_pool.ThreadedConnectionPool] = None

if DB_ENABLED:
    try:
        _db_pool = pg_pool.ThreadedConnectionPool(1, 10, DATABASE_URL)
        print("PostgreSQL connection pool created.")
    except Exception as _pool_err:
        print(f"Failed to create DB pool: {_pool_err}")
        DB_ENABLED = False
else:
    print("DATABASE_URL not set; running without database (auth + logging will use dev fallbacks).")


@contextmanager
def get_db():
    """Context manager that checks out a connection from the pool and auto-commits/rolls back."""
    if _db_pool is None:
        raise HTTPException(status_code=503, detail="Database not configured (set DATABASE_URL).")
    conn = _db_pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _db_pool.putconn(conn)


# ==================== Gemini ====================
gemini_client: Optional[genai.Client] = (
    genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
)
if gemini_client is None:
    print("GEMINI_API_KEY is missing; Gemini calls will fail. Set GEMINI_API_KEY in your environment.")


def _is_model_not_found_error(e: Exception) -> bool:
    msg = str(e)
    return (
        "NOT_FOUND" in msg
        and "models/" in msg
        and (
            "not found" in msg.lower()
            or "is not found" in msg.lower()
            or "no longer available" in msg.lower()
            or "no longer available to new users" in msg.lower()
        )
    )


def _generate_content_with_fallback(
    contents: list[Any],
    primary_model: Optional[str] = None,
    config: Optional[Any] = None,
) -> tuple[Any, str]:
    if gemini_client is None:
        raise RuntimeError("GEMINI_API_KEY is missing")

    def _expand(mid: str) -> list[str]:
        mid = (mid or "").strip()
        if not mid:
            return []
        return [mid] if mid.startswith("models/") else [mid, f"models/{mid}"]

    primary = (primary_model or GEMINI_MODEL or "").strip() or GEMINI_MODEL
    raw_fallbacks = [
        "gemini-3-flash",
        "gemini-3-flash-preview",
        "gemini-2.0-flash",
        "gemini-3.1-flash-lite",
    ]
    fallbacks: list[str] = []
    for m in raw_fallbacks:
        if m != primary:
            fallbacks.extend(_expand(m))
    primary_candidates = _expand(primary)

    def _pick_from_list_models() -> list[str]:
        if gemini_client is None:
            return []
        try:
            candidates: list[str] = []
            for m in gemini_client.models.list():
                name = getattr(m, "name", None)
                if not isinstance(name, str) or not name:
                    continue
                low = name.lower()
                supported = getattr(m, "supported_actions", None) or getattr(m, "supportedActions", None)
                supported_str = " ".join(supported) if isinstance(supported, (list, tuple)) else str(supported or "")
                if "generatecontent" not in supported_str.lower():
                    continue
                if "flash" in low and "gemini" in low:
                    candidates.append(name.replace("models/", ""))
            if not candidates:
                for m in gemini_client.models.list():
                    name = getattr(m, "name", None)
                    if not isinstance(name, str) or not name:
                        continue
                    low = name.lower()
                    supported = getattr(m, "supported_actions", None) or getattr(m, "supportedActions", None)
                    supported_str = " ".join(supported) if isinstance(supported, (list, tuple)) else str(supported or "")
                    if "generatecontent" not in supported_str.lower():
                        continue
                    if "gemini" in low:
                        candidates.append(name.replace("models/", ""))
            out: list[str] = []
            for c in candidates:
                out.extend(_expand(c))
            return out[:10]
        except Exception as _:
            return []

    def _gen(model_id: str):
        if config is None:
            return gemini_client.models.generate_content(model=model_id, contents=contents)
        return gemini_client.models.generate_content(model=model_id, contents=contents, config=config)

    try:
        last: Exception | None = None
        for m in primary_candidates:
            try:
                return (_gen(m), m)
            except Exception as e:
                last = e
        if last is not None:
            raise last
        raise RuntimeError("GEMINI_MODEL is empty")
    except Exception as e:
        if not _is_model_not_found_error(e):
            raise
        last = e
        for m in fallbacks:
            try:
                return (_gen(m), m)
            except Exception as e2:
                last = e2
        for m in _pick_from_list_models():
            try:
                return (_gen(m), m)
            except Exception as e3:
                last = e3
        raise last


def _gemini_response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text
    candidates = getattr(response, "candidates", None) or []
    parts: List[str] = []
    for c in candidates:
        content = getattr(c, "content", None)
        if not content:
            continue
        for p in getattr(content, "parts", None) or []:
            t = getattr(p, "text", None)
            if isinstance(t, str):
                parts.append(t)
    return "".join(parts).strip()


def _extract_any_json_object(text: str) -> Optional[Dict[str, Any]]:
    if not isinstance(text, str) or not text:
        return None
    left = text.find("{")
    right = text.rfind("}")
    if left == -1 or right == -1 or right <= left:
        return None
    try:
        return json.loads(text[left : right + 1])
    except Exception:
        return None


def _generate_insights_from_analysis(
    analysis: Dict[str, Any],
    topic: Optional[str],
) -> Dict[str, str]:
    if gemini_client is None:
        return {"careerInsight": "", "prerequisiteCorrelation": ""}
    try:
        prompt = f"""
คุณเป็นนักวิชาการด้านการสอน/ประเมินสมรรถนะผู้เรียน

ข้อมูลผลการสแกนล่าสุด (JSON):
{json.dumps(analysis, ensure_ascii=False)}

หัวข้อ (ถ้ามี): {topic or ""}

งาน:
1) สรุป "Neural Trace Insight" (ภาษาไทย) เป็นข้อความสั้น กระชับ ชี้จุดที่ควรเสริมทักษะ/ความเข้าใจจากหลักฐานในเหตุผลของแต่ละมิติ
2) สรุป "Temporal Trajectory" (ภาษาไทย) เป็นข้อความสั้น กระชับ ให้กำลังใจ เชิงวิชาการ อธิบายแนวโน้ม/แนวทางพัฒนาต่อ

กติกา:
- ห้ามตอบเป็นอังกฤษ
- ห้ามใส่ markdown
- ห้ามให้เฉลยโจทย์โดยตรง (ถ้ามีการกล่าวถึงแนวทาง ให้เป็นคำแนะนำเชิงกระบวนการ)

รูปแบบผลลัพธ์ (STRICT JSON เท่านั้น):
{{
  "prerequisiteCorrelation": "ข้อความภาษาไทย...",
  "careerInsight": "ข้อความภาษาไทย..."
}}
"""
        response, _used_model = _generate_content_with_fallback(
            [prompt],
            primary_model="gemini-3-flash",
        )
        text = _gemini_response_text(response)
        obj = _extract_any_json_object(text) or {}
        prereq = obj.get("prerequisiteCorrelation")
        career = obj.get("careerInsight")
        return {
            "careerInsight": career.strip() if isinstance(career, str) else "",
            "prerequisiteCorrelation": prereq.strip() if isinstance(prereq, str) else "",
        }
    except Exception:
        return {"careerInsight": "", "prerequisiteCorrelation": ""}


# ==================== FastAPI App ====================
app = FastAPI(title="Intelligent Analysis System - Complete", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("App is starting...")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


# ==================== Auth Models ====================
class LoginRequest(BaseModel):
    school_id: str
    student_id: str


# ==================== Image Processing Module ====================
def preprocess_handwritten_work(image_bytes: bytes) -> np.ndarray:
    """Image Pre-processing with OpenCV (Perspective, Denoise, Binarize)"""
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("ไม่สามารถโหลดรูปภาพได้ (ไฟล์อาจเสีย)")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edged = cv2.Canny(gray, 50, 150)
    contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        doc_contour = max(contours, key=cv2.contourArea)
        peri = cv2.arcLength(doc_contour, True)
        approx = cv2.approxPolyDP(doc_contour, 0.02 * peri, True)
        if len(approx) == 4:
            pts = approx.reshape(4, 2)
            rect = np.zeros((4, 2), dtype="float32")
            s = pts.sum(axis=1)
            rect[0] = pts[np.argmin(s)]
            rect[2] = pts[np.argmax(s)]
            diff = np.diff(pts, axis=1)
            rect[1] = pts[np.argmin(diff)]
            rect[3] = pts[np.argmax(diff)]
            tl, tr, br, bl = rect
            width = max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl))
            height = max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl))
            dst = np.array(
                [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
                dtype="float32",
            )
            M = cv2.getPerspectiveTransform(rect, dst)
            img = cv2.warpPerspective(img, M, (int(width), int(height)))

    denoised = cv2.fastNlMeansDenoisingColored(img, None, 10, 10, 7, 21)
    gray_denoised = cv2.cvtColor(denoised, cv2.COLOR_BGR2GRAY)
    thresh = cv2.adaptiveThreshold(
        gray_denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2
    )
    final = cv2.bitwise_not(thresh)
    return final


# ==================== AI Analysis Module ====================
async def analyze_with_ai(image: np.ndarray, prompt: str) -> Dict[str, Any]:
    """Send image to Gemini Pro Vision for 5-Dimension Analysis"""
    try:
        if image.ndim == 2:
            pil_image = Image.fromarray(image, mode="L").convert("RGB")
        else:
            pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

        img_byte_arr = io.BytesIO()
        pil_image.save(img_byte_arr, format="JPEG")
        img_bytes = img_byte_arr.getvalue()

        response, _used_model = _generate_content_with_fallback(
            [
                prompt,
                types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
            ],
            primary_model="gemini-3-flash",
        )
        response_text = _gemini_response_text(response)

        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start != -1 and end != -1:
            json_str = response_text[start:end]
            return json.loads(json_str)
        else:
            return {"error": "unclear_input"}
    except Exception as e:
        print(f"AI Error: {e}")
        return {"error": "unclear_input"}


# ==================== Security & Auth Module ====================
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_school(token: str = Depends(oauth2_scheme)) -> Dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        school_id: Optional[str] = payload.get("school_id")
        student_id: Optional[str] = payload.get("sub")
        if school_id is None or student_id is None:
            raise credentials_exception
        return {"school_id": school_id, "current_student_id": student_id}
    except JWTError:
        raise credentials_exception


# ==================== Socratic Tutor Module ====================
def get_tutor_response(
    competency_data: dict, deviation_point: Optional[str] = None
) -> str:
    if deviation_point:
        return f"ลองสังเกตหน่วยของตัวแปรในบรรทัดที่ {deviation_point} ดูอีกทีครับ มันสอดคล้องกับค่าที่เราหามาไหม?"

    analysis_score = competency_data.get("Analysis", 0)
    if analysis_score >= 80:
        return "ถ้าเราเปลี่ยนพื้นผิวให้มีความเสียดทานมากขึ้น วิธีการคำนวณนี้ยังใช้ได้อยู่ไหม?"
    elif analysis_score >= 60:
        return "ทำไมคุณถึงเลือกใช้สูตรนี้ในการแก้ปัญหาครับ?"
    else:
        return "โชจำได้ไหมว่า กฎข้อที่สองของนิวตันกล่าวไว้ว่าอย่างไร?"


# ==================== Database Operations ====================
async def save_competency_data(
    school_id: str, student_id: str, scores: Dict[str, int], topic: Optional[str] = None
):
    if not DB_ENABLED:
        return None
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO competency_logs
                    (school_id, student_id, logic_score, accuracy_score,
                     analysis_score, application_score, connectivity_score, topic)
                VALUES (%s, %s::uuid, %s, %s, %s, %s, %s, %s)
                """,
                (
                    school_id,
                    student_id,
                    scores.get("Logic", 0),
                    scores.get("Accuracy", 0),
                    scores.get("Analysis", 0),
                    scores.get("Application", 0),
                    scores.get("Connectivity", 0),
                    topic,
                ),
            )


# ==================== Endpoints ====================
ALLOWED_SCHOOL_EMAIL_DOMAIN = "rayongwit.ac.th"


@app.post("/auth/google-check")
async def google_auth_check(email: str = Query(...), name: str = Query(...)):
    """
    ตรวจสอบสิทธิ์ Gmail โรงเรียน และลงทะเบียนนักเรียนอัตโนมัติ
    """
    email_clean = (email or "").strip()
    if "@" not in email_clean:
        raise HTTPException(status_code=400, detail="รูปแบบอีเมลไม่ถูกต้อง")

    domain = email_clean.split("@")[-1].strip().lower()
    print(f"Checking domain: {domain}")

    if domain != ALLOWED_SCHOOL_EMAIL_DOMAIN:
        raise HTTPException(
            status_code=403,
            detail="ระบบนี้เปิดให้ใช้งานฟรีเฉพาะบุคลากร @rayongwit.ac.th เท่านั้น",
        )

    # Dev fallback when DATABASE_URL is not configured
    if not DB_ENABLED:
        print("DB not configured: issuing dev token without DB checks.")
        raw_token = create_access_token(
            data={"school_id": domain, "sub": email_clean.lower(), "email": email_clean},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        return {"access_token": str(raw_token), "token_type": "bearer", "school_name": "DEV (no DB)"}

    try:
        # 1. Find school
        with get_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, name FROM schools WHERE LOWER(domain) = LOWER(%s) AND is_active IS NOT FALSE LIMIT 1",
                    (domain,),
                )
                school = cur.fetchone()

        if not school:
            raise HTTPException(
                status_code=403,
                detail="โรงเรียนของคุณยังไม่ได้เข้าร่วมโครงการ ถูกปิดการใช้งาน หรือไม่ใช่ Gmail ของโรงเรียน",
            )

        school_id_str = str(school["id"])
        school_name = school["name"]

        # 2. Upsert student (idempotent on email)
        display_name = (name or "").strip() or (email_clean.split("@")[0] or "Student")
        with get_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO students (school_id, email, name)
                    VALUES (%s::uuid, %s, %s)
                    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """,
                    (school_id_str, email_clean.lower(), display_name),
                )
                student = cur.fetchone()

        if not student:
            raise HTTPException(status_code=500, detail="Could not create or read student record.")

        student_id_str = str(student["id"])

        # 3. Issue JWT
        raw_token = create_access_token(
            data={"school_id": school_id_str, "sub": student_id_str, "email": email_clean},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        access_token = str(raw_token)
        if not access_token:
            raise HTTPException(status_code=500, detail="Could not generate access_token (empty JWT)")

        return {"access_token": access_token, "token_type": "bearer", "school_name": school_name}

    except HTTPException:
        raise
    except Exception as e:
        print(f"DB error in /auth/google-check: {e}")
        raise HTTPException(status_code=503, detail=f"Database error: {str(e)}")


@app.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"school_id": form_data.username, "sub": form_data.password},
        expires_delta=access_token_expires,
    )
    return {"access_token": access_token, "token_type": "bearer"}


def _normalize_image_bytes(img_bytes: bytes, mime_type: str) -> tuple[bytes, str]:
    mt = (mime_type or "").lower().strip()
    supported = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
    if mt in supported:
        return img_bytes, ("image/jpeg" if mt == "image/jpg" else mt)
    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue(), "image/jpeg"
    except Exception:
        return img_bytes, "application/octet-stream"


async def analyze_with_ai_raw(img_bytes: bytes, mime_type: str, prompt: str):
    try:
        img_bytes2, mt = _normalize_image_bytes(img_bytes, mime_type)
        response, _used_model = _generate_content_with_fallback(
            [
                prompt,
                types.Part.from_bytes(data=img_bytes2, mime_type=mt),
            ],
            primary_model="gemini-3-flash",
        )
        text = _gemini_response_text(response)
        parsed = _extract_scores_json(text)
        if parsed is not None:
            return parsed
        return {"error": "no_json_found", "raw": text[:2000]}
    except Exception as e:
        return {"error": str(e)}


def _extract_scores_json(text: str) -> Optional[Dict[str, Any]]:
    if not isinstance(text, str) or not text:
        return None

    required = {"Logic", "Accuracy", "Analysis", "Application", "Connectivity"}

    def _normalize(obj: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(obj, dict) or not required.issubset(set(obj.keys())):
            return None

        if all(isinstance(obj.get(k), dict) for k in required):
            out: Dict[str, Any] = {}
            for k in required:
                v = obj.get(k) or {}
                score = v.get("score")
                reason = v.get("reason")
                if not isinstance(score, int):
                    if isinstance(score, (int, float)) and float(score).is_integer():
                        score = int(score)
                    else:
                        return None
                if not isinstance(reason, str):
                    reason = "" if reason is None else str(reason)
                out[k] = {"score": int(score), "reason": reason}
            return out

        if all(isinstance(obj.get(k), (int, float)) for k in required):
            out = {}
            for k in required:
                score = obj.get(k)
                if isinstance(score, float) and score.is_integer():
                    score = int(score)
                out[k] = {"score": int(score or 0), "reason": ""}
            return out

        return None

    try:
        import re
        for m in re.finditer(r"```json\s*([\s\S]*?)```", text, flags=re.IGNORECASE):
            candidate = m.group(1).strip()
            try:
                obj = json.loads(candidate)
                norm = _normalize(obj)
                if norm is not None:
                    return norm
            except Exception:
                pass
    except Exception:
        pass

    right = text.rfind("}")
    if right == -1:
        return None
    tries = 0
    i = right
    while tries < 25:
        left = text.rfind("{", 0, i)
        if left == -1:
            break
        candidate = text[left : right + 1]
        try:
            obj = json.loads(candidate)
            norm = _normalize(obj)
            if norm is not None:
                return norm
        except Exception:
            pass
        tries += 1
        i = left - 1

    return None


@app.post("/api/chat")
async def chat_endpoint(request: Dict[str, Any]):
    history = request.get("history", [])
    message = request.get("message", "")
    try:
        sys_ctx: list[str] = []
        contents: list[Any] = []

        if isinstance(history, list):
            for m in history:
                if not isinstance(m, dict):
                    continue
                role = str(m.get("role", "") or "").strip().lower()
                text = m.get("content", "")
                if not isinstance(text, str) or not text.strip():
                    continue

                if role == "system":
                    sys_ctx.append(text.strip())
                    continue
                if role in {"assistant"}:
                    role = "model"
                if role not in {"user", "model"}:
                    role = "user"

                try:
                    contents.append(types.Content(role=role, parts=[types.Part.from_text(text)]))
                except Exception:
                    contents.append(f"{role.upper()}: {text}")

        if isinstance(message, str) and message.strip():
            try:
                contents.append(
                    types.Content(role="user", parts=[types.Part.from_text(message.strip())])
                )
            except Exception:
                contents.append(f"USER: {message.strip()}")

        system_instruction = (
            "You are a 'Socratic Tutor'.\n"
            "Language: Thai only.\n"
            "Style: Concise, sharp, academic, impactful. ZERO filler words. NO conversational fluff (e.g. NEVER 'สวัสดี', 'ยินดี').\n"
            "Goal: Guide students to think for themselves via questions. NEVER give direct answers or solutions.\n\n"
            "CRITICAL RULE: Jump DIRECTLY into the Socratic question. Your entire response should be the question(s).\n\n"
            "3-Level Scaffolding Logic (use latest scan data if available in Context):\n"
            "1. Concept Probe: If student is stuck, ask about fundamental definitions/principles.\n"
            "2. Error Spotting: If student makes a mistake, hint at the area of the error.\n"
            "3. Validation & Generalization: If student is correct, ask a 'What if' question.\n\n"
            "Scan Data Logic:\n"
            "- Target the dimension with the LOWEST score.\n"
            "- Use the 'reason' for that dimension to formulate a highly specific question."
        )
        if sys_ctx:
            system_instruction += "\n\nContext:\n" + "\n".join(sys_ctx)

        cfg = None
        try:
            cfg = types.GenerateContentConfig(system_instruction=system_instruction)
        except Exception:
            cfg = None

        response, used_model = _generate_content_with_fallback(
            contents if contents else [f"USER: {message}"],
            primary_model="gemini-2.0-flash",
            config=cfg,
        )
        return {"response": _gemini_response_text(response), "model": used_model}
    except Exception as e:
        return {"response": f"Chat Error: {str(e)}"}


@app.post("/api/fatigue")
async def fatigue_endpoint(request: Dict[str, Any]):
    context = request.get("context", "")
    return {
        "overloadIndex": 30,
        "status": "STABLE",
        "recommendation": "Neural networks are balanced. Proceed with exploration."
    }


@app.post("/api/analyze")
async def analyze_student_work(
    file: UploadFile = File(...),
    topic: Optional[str] = Query(None),
    school_info: dict = Depends(get_current_school)
):
    try:
        image_bytes = await file.read()
        content_type = getattr(file, "content_type", None) or "application/octet-stream"

        lang_line = "Write each reason in Thai."
        analysis_prompt = f"""
You are Gemini 3 Flash, acting as an AI Academic Analyzer. You will see a student's handwritten work as a raw color photo.

Task:
1) Carefully inspect what the student wrote (steps, formulas, diagrams, units, arithmetic).
2) Score 0-100 for 5 dimensions:
   - Logic (TIMSS): reasoning sequence / coherence
   - Accuracy (Common Core): procedural precision / careless errors
   - Analysis (Bloom): depth of understanding / abstraction
   - Application (PISA): real-world decoding into a model
   - Connectivity: cross-topic integration
3) For EACH dimension, give a specific reason based on what you saw in the image.

Output format (STRICT):
Return a single JSON object with EXACT keys and nested objects:
{{
  "Logic": {{"score": 0-100, "reason": "..." }},
  "Accuracy": {{"score": 0-100, "reason": "..." }},
  "Analysis": {{"score": 0-100, "reason": "..." }},
  "Application": {{"score": 0-100, "reason": "..." }},
  "Connectivity": {{"score": 0-100, "reason": "..." }}
}}

Rules:
- {lang_line}
- Reasons must be concrete and reference visible evidence.
- Output ONLY valid JSON. No markdown. No extra text.
"""

        ai_response = await analyze_with_ai_raw(image_bytes, content_type, analysis_prompt)

        if "error" in ai_response:
            err = str(ai_response.get("error"))
            raw = ai_response.get("raw")
            detail = (
                f"Gemini error: {err}"
                if not raw
                else f"Gemini error: {err}\nRaw: {str(raw)[:500]}"
            )
            return JSONResponse(status_code=500, content={"status": "error", "message": detail})

        try:
            flat_scores = {
                "Logic": int(ai_response.get("Logic", {}).get("score", 0)),
                "Accuracy": int(ai_response.get("Accuracy", {}).get("score", 0)),
                "Analysis": int(ai_response.get("Analysis", {}).get("score", 0)),
                "Application": int(ai_response.get("Application", {}).get("score", 0)),
                "Connectivity": int(ai_response.get("Connectivity", {}).get("score", 0)),
            }
            await save_competency_data(
                school_id=school_info["school_id"],
                student_id=school_info["current_student_id"],
                scores=flat_scores,
                topic=topic,
            )
        except Exception as db_err:
            print(f"DB Error (ignored): {db_err}")

        insights = _generate_insights_from_analysis(ai_response, topic)

        return {
            "status": "success",
            "message": "ประมวลผลสำเร็จ (อาจมีการเดาคะแนนหากภาพไม่ชัด)",
            "analysis": ai_response,
            "careerInsight": insights.get("careerInsight", ""),
            "prerequisiteCorrelation": insights.get("prerequisiteCorrelation", ""),
            "scores": {
                "Logic": int(ai_response.get("Logic", {}).get("score", 0)),
                "Accuracy": int(ai_response.get("Accuracy", {}).get("score", 0)),
                "Analysis": int(ai_response.get("Analysis", {}).get("score", 0)),
                "Application": int(ai_response.get("Application", {}).get("score", 0)),
                "Connectivity": int(ai_response.get("Connectivity", {}).get("score", 0)),
            },
            "json_block": ai_response,
        }

    except Exception as e:
        print(f"Global Error: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": f"เกิดข้อผิดพลาด: {str(e)}",
                "json_block": {
                    "Logic": 0, "Accuracy": 0, "Analysis": 0,
                    "Application": 0, "Connectivity": 0,
                },
            },
        )


@app.get("/api/student/profile")
async def get_student_profile(school_info: dict = Depends(get_current_school)):
    if not DB_ENABLED:
        return {
            "profile": {
                "id": school_info.get("current_student_id"),
                "email": None, "name": None, "grade": None, "room": None,
                "school": {"id": school_info.get("school_id"), "name": None, "domain": None},
            }
        }

    try:
        with get_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT s.id, s.email, s.name, s.grade, s.room, s.school_id,
                           sc.name AS school_name, sc.domain AS school_domain
                    FROM students s
                    LEFT JOIN schools sc ON s.school_id = sc.id
                    WHERE s.id = %s::uuid
                    LIMIT 1
                    """,
                    (school_info["current_student_id"],),
                )
                student = cur.fetchone()

        if not student:
            return {"profile": None}

        return {
            "profile": {
                "id": str(student["id"]),
                "email": student["email"],
                "name": student["name"],
                "grade": student["grade"],
                "room": student["room"],
                "school": {
                    "id": str(student["school_id"]),
                    "name": student["school_name"],
                    "domain": student["school_domain"],
                },
            }
        }
    except Exception as e:
        return {"profile": None, "error": str(e)}


def _readiness_from_log_row(row: Dict[str, Any]) -> float:
    try:
        logic = float(row.get("logic_score") or 0)
        analysis = float(row.get("analysis_score") or 0)
        application = float(row.get("application_score") or 0)
        accuracy = float(row.get("accuracy_score") or 0)
        connectivity = float(row.get("connectivity_score") or 0)
        return (
            logic * 0.40
            + analysis * 0.30
            + application * 0.15
            + accuracy * 0.10
            + connectivity * 0.05
        )
    except Exception:
        return 0.0


def _avg(nums: List[float]) -> Optional[float]:
    vals = [n for n in nums if isinstance(n, (int, float))]
    if not vals:
        return None
    return float(sum(vals) / len(vals))


@app.get("/api/student/data")
async def get_student_data(school_info: dict = Depends(get_current_school)):
    if not DB_ENABLED:
        return {"logs": [], "aggregates": {}}

    logs: List[Dict[str, Any]] = []
    aggregates: Dict[str, Any] = {}

    try:
        with get_db() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:

                # 1. Student competency history
                cur.execute(
                    """
                    SELECT id, school_id, student_id, logic_score, accuracy_score,
                           analysis_score, application_score, connectivity_score,
                           topic, created_at
                    FROM competency_logs
                    WHERE school_id = %s::uuid AND student_id = %s::uuid
                    ORDER BY created_at DESC
                    """,
                    (school_info["school_id"], school_info["current_student_id"]),
                )
                raw_logs = cur.fetchall()

                # Serialize UUIDs and datetimes to JSON-safe strings
                for row in raw_logs:
                    serialized = {}
                    for k, v in row.items():
                        if hasattr(v, "isoformat"):
                            serialized[k] = v.isoformat()
                        elif hasattr(v, "hex"):
                            serialized[k] = str(v)
                        else:
                            serialized[k] = v
                    logs.append(serialized)

                # 2. Personal readiness average
                aggregates["student_readiness_avg"] = _avg(
                    [_readiness_from_log_row(r) for r in logs]
                )

                # 3. Fetch student grade/room for sociometric queries
                cur.execute(
                    "SELECT grade, room FROM students WHERE id = %s::uuid LIMIT 1",
                    (school_info["current_student_id"],),
                )
                srow = cur.fetchone()
                grade = srow["grade"] if srow else None
                room = srow["room"] if srow else None
                aggregates["grade"] = grade
                aggregates["room"] = room

                # 4. Room average (single SQL query with JOIN — no N+1)
                if room:
                    cur.execute(
                        """
                        SELECT AVG(
                            cl.logic_score * 0.40 +
                            cl.analysis_score * 0.30 +
                            cl.application_score * 0.15 +
                            cl.accuracy_score * 0.10 +
                            cl.connectivity_score * 0.05
                        ) AS room_avg
                        FROM competency_logs cl
                        JOIN students st ON cl.student_id = st.id
                        WHERE st.school_id = %s::uuid AND st.room = %s
                        """,
                        (school_info["school_id"], room),
                    )
                    row = cur.fetchone()
                    aggregates["room_readiness_avg"] = (
                        float(row["room_avg"]) if row and row["room_avg"] is not None else None
                    )
                else:
                    aggregates["room_readiness_avg"] = None

                # 5. Grade average (single SQL query with JOIN)
                if grade:
                    cur.execute(
                        """
                        SELECT AVG(
                            cl.logic_score * 0.40 +
                            cl.analysis_score * 0.30 +
                            cl.application_score * 0.15 +
                            cl.accuracy_score * 0.10 +
                            cl.connectivity_score * 0.05
                        ) AS grade_avg
                        FROM competency_logs cl
                        JOIN students st ON cl.student_id = st.id
                        WHERE st.school_id = %s::uuid AND st.grade = %s
                        """,
                        (school_info["school_id"], grade),
                    )
                    row = cur.fetchone()
                    aggregates["grade_readiness_avg"] = (
                        float(row["grade_avg"]) if row and row["grade_avg"] is not None else None
                    )
                else:
                    aggregates["grade_readiness_avg"] = None

    except Exception as e:
        aggregates["error"] = str(e)

    return {"logs": logs, "aggregates": aggregates}


@app.get("/api/tutor")
async def get_tutoring(
    logic: int = Query(..., ge=0, le=100),
    accuracy: int = Query(..., ge=0, le=100),
    analysis: int = Query(..., ge=0, le=100),
    application: int = Query(..., ge=0, le=100),
    connectivity: int = Query(..., ge=0, le=100),
    deviation_point: Optional[str] = Query(None),
):
    competency_data = {
        "Logic": logic, "Accuracy": accuracy, "Analysis": analysis,
        "Application": application, "Connectivity": connectivity,
    }
    response = get_tutor_response(competency_data, deviation_point)
    return {"tutor_response": response, "json_block": competency_data}


# ==================== Run ====================
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
