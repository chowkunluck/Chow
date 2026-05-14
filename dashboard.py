import streamlit as st
import requests
import plotly.graph_objects as go
from PIL import Image
import io

# --- การตั้งค่าหน้าจอ ---
st.set_page_config(page_title="Synthesis AI - Neural HUD", layout="wide")

st.title("🌌 Synthesis AI: Neural Learning HUD")
st.markdown("---")

# --- ส่วนของการอัปโหลด ---
with st.sidebar:
    st.header("🎛️ Control Panel")
    uploaded_file = st.file_uploader("Scan Worksheet (อัปโหลดใบงาน)", type=['jpg', 'png', 'jpeg'])
    st.info("ระบบจะวิเคราะห์สมรรถนะ 5 มิติ ผ่าน Gemini 1.5 Pro")

# --- ฟังก์ชันวาดกราฟใยแมงมุม (Radar Chart) ---
def create_radar_chart(scores):
    categories = ['Logic', 'Accuracy', 'Analysis', 'Application', 'Connectivity']
    values = [scores.get(c, 0) for c in categories]
    
    fig = go.Figure()
    fig.add_trace(go.Scatterpolar(
        r=values + [values[0]],
        theta=categories + [categories[0]],
        fill='toself',
        fillcolor='rgba(0, 255, 255, 0.3)',
        line=dict(color='cyan')
    ))
    
    fig.update_layout(
        polar=dict(radialaxis=dict(visible=True, range=[0, 100])),
        showlegend=False,
        paper_bgcolor='rgba(0,0,0,0)',
        font=dict(color="white", size=15)
    )
    return fig

# --- ส่วนแสดงผลหลัก ---
if uploaded_file:
    col1, col2 = st.columns([1, 1])
    
    with col1:
        st.subheader("📸 Scanned Image")
        image = Image.open(uploaded_file)
        st.image(image, use_container_width=True)

    with col2:
        st.subheader("📊 Competency Analysis")
        
        if st.button("🚀 Start Neural Analysis"):
            with st.spinner("AI กำลังประมวลผลผ่าน Deep Learning..."):
                # ส่งรูปไปยัง Backend (main.py) ที่โชรันไว้
                files = {"file": uploaded_file.getvalue()}
                response = requests.post("http://localhost:8000/analyze", files=files)
                
                if response.status_code == 200:
                    data = response.json()
                    # สมมติว่า backend ส่ง json_block มาให้
                    scores = data.get("json_block", {})
                    
                    # แสดงกราฟ
                    st.plotly_chart(create_radar_chart(scores), use_container_width=True)
                    
                    # แสดง Insight
                    st.success(f"📌 หัวข้อ: {data.get('topic', 'ไม่ระบุ')}")
                    st.write(f"💡 **Career Insight:** {data.get('careerInsight', 'N/A')}")
                    
                    # Socratic Tutor
                    st.info(f"🧠 **Socratic Question:** {data.get('socraticGuidance', 'N/A')}")
                else:
                    st.error("เกิดข้อผิดพลาดในการเชื่อมต่อกับ Backend")
else:
    st.warning("กรุณาอัปโหลดรูปใบงานเพื่อเริ่มการวิเคราะห์")