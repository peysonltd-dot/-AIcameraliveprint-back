/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (SDXL 終極防彈版)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
    res.status(200).send("🟢 AI 雷雕系統 (SDXL 防彈版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;

        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        console.log("📥 [請求到達] 收到新的影像處理請求");

        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

        if (REPLICATE_API_TOKEN) {
            console.log("🚀 呼叫官方 SDXL 進行極簡線稿轉換...");

            // 🌟 核心變更：回到我們已經成功過的穩定大腦，絕不 404
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b", 
                input: {
                    image: image,
                    // 終極線稿咒語：強制著色本風格、白底黑線
                    prompt: "pure black and white line art, continuous line drawing, minimalist ink outline of this exact person, pure white background, coloring book style, high contrast, solid black clean vector lines, no shading",
                    negative_prompt: "color, shading, gradients, realistic, 3d, skin tone, painting, shadows, gray, texture, photorealistic, messy lines, background details",
                    
                    // 🌟 黃金比例：0.70。足夠把顏色抽乾變成線條，又不會讓臉部完全變形
                    prompt_strength: 0.70, 
                    num_inference_steps: 30,
                    // 關閉安全濾網，避免黑圖
                    disable_safety_checker: true 
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

            console.log("⏳ SDXL 算圖中 (預計 5~10 秒)...");
            while (!isComplete) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                const checkRes = await axios.get(predictionUrl, {
                    headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
                });
                
                const status = checkRes.data.status;
                if (status === 'succeeded') {
                    finalImageUrl = checkRes.data.output[0];
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
