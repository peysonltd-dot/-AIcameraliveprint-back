/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (ControlNet 極致穩定展場版)
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
    res.status(200).send("🟢 AI 雷雕系統 (ControlNet 穩定版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;

        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        console.log("📥 [請求到達] 收到新的影像處理請求");

        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

        if (REPLICATE_API_TOKEN) {
            console.log("🚀 呼叫 ControlNet 進行強制線稿描邊...");

            // 🌟 核心變更：使用專攻線稿、保證不塞車的 ControlNet 模型
            const createRes = await axios.post('https://api.replicate.com/v1/models/rossjillian/controlnet/predictions', {
                input: {
                    // 1. 照片輸入：鎖死五官輪廓
                    image: image,
                    
                    // 2. 終極咒語：把美女線稿的靈魂用文字描述出來
                    prompt: "A minimalist continuous line art drawing of this person, elegant single stroke style, pure white background, solid black clean vector ink lines, high contrast, elegant facial contour, no shading, simple and clean",
                    negative_prompt: "color, shading, gradients, realistic, 3d, skin tone, painting, shadows, gray, texture, photorealistic, messy lines, multiple strokes",
                    
                    // 3. 關鍵設定：指定 ControlNet 類型為 "lineart"
                    structure: "lineart",
                    
                    // 確保線條純淨的控制參數
                    steps: 20,
                    scale: 9
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

            console.log("⏳ ControlNet 描圖中 (預計 5~15 秒)...");
            while (!isComplete) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                const checkRes = await axios.get(predictionUrl, {
                    headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
                });
                
                const status = checkRes.data.status;
                if (status === 'succeeded') {
                    // ControlNet 輸出通常第一張是原圖偵測結果，第二張是生成的圖
                    finalImageUrl = checkRes.data.output[1] || checkRes.data.output[0];
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
