/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (Google Nano Banana 2 + 風格參考版)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🌟 設定您的風格參考圖網址 (GitHub Raw 直連網址)
const STYLE_REF_URL = "https://raw.githubusercontent.com/peysonltd-dot/Alcameraliveprint/main/style.jpg.jpg";

app.get('/', (req, res) => {
    res.status(200).send("🟢 AI 雷雕系統 (Nano Banana 2) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body; // 這是在手機拍下的 Base64 原始照片

        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        console.log("📥 [請求到達] 收到新的影像處理請求");

        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

        if (REPLICATE_API_TOKEN) {
            console.log("🚀 呼叫 Google Nano Banana 2 進行雙圖融合...");

            // 🌟 核心變更：改用 Nano Banana 2 的 API 路徑
            const createRes = await axios.post('https://api.replicate.com/v1/models/google/nano-banana-2/predictions', {
                input: {
                    // 咒語：明確指示 AI 學習參考圖的風格
                    prompt: "Redraw the person in the first image using the EXACT same minimalist black and white line art style, stroke thickness, and artistic vibe as the second reference image. Pure white background, solid black clean vector lines, no shading, no gray, simple elegant facial contour.",
                    
                    // 參考圖陣列：[遊客照片, 您上傳的風格圖]
                    image_input: [image, STYLE_REF_URL],
                    
                    aspect_ratio: "match_input_image",
                    output_format: "jpg"
                }
            }, {
                headers: { 
                    'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            const predictionUrl = createRes.data.urls.get;
            let isComplete = false;
            let finalImageUrl = null;

            console.log("⏳ Google 大腦計算中 (預計 5~10 秒)...");
            while (!isComplete) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const checkRes = await axios.get(predictionUrl, {
                    headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
                });
                
                const status = checkRes.data.status;
                if (status === 'succeeded') {
                    // ⚠️ 注意：Nano Banana 2 的輸出是字串，不是陣列
                    finalImageUrl = checkRes.data.output;
                    isComplete = true;
                } else if (status === 'failed' || status === 'canceled') {
                    throw new Error('AI 處理失敗: ' + checkRes.data.error);
                }
            }

            console.log("✅ 算圖成功！正在處理回傳...");
            
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            const base64Img = "data:image/png;base64," + Buffer.from(imgResponse.data, 'binary').toString('base64');

            return res.status(200).json({ success: true, result: base64Img });

        } else {
            console.log("⚠️ 未偵測到 API Token，退回原圖");
            return res.status(200).json({ success: true, result: image });
        }

    } catch (error) {
        console.error("❌ 伺服器錯誤:", error.response ? error.response.data : error.message);
        return res.status(200).json({ success: true, result: req.body.image });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 後端啟動於 PORT: ${PORT}`);
});
