/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (SDXL 極簡穩定版)
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
    res.status(200).send("🟢 AI 雷雕系統 (SDXL 穩定版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        console.log("📥 [請求到達] 收到新的影像處理請求");

        // 🔐 使用環境變數讀取金鑰
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

        if (REPLICATE_API_TOKEN) {
            console.log("🚀 呼叫 SDXL 進行黑白線稿轉換...");

            // 🌟 回歸最穩定的 SDXL，使用超強「著色本」咒語
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b", 
                input: {
                    image: image,
                    prompt: "pure black and white line art portrait of THIS EXACT person, coloring book style, black ink outline on white paper, monochrome, high contrast, clean minimalist vector lines, simple facial contour, pure white background",
                    negative_prompt: "color, shading, gradients, realistic, 3d, skin tone, painting, shadows, gray, texture, photorealistic",
                    prompt_strength: 0.85, // 85% 變成線稿，15% 保留您的五官
                    num_inference_steps: 30,
                    disable_safety_checker: true // 關閉安全審查，防止變黑圖
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

            console.log("⏳ SDXL 算圖中 (預計 10~15 秒)...");
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
            console.log("⚠️ 尚未設定環境變數 REPLICATE_API_TOKEN，退回原圖");
            return res.status(200).json({ success: true, result: image });
        }

    } catch (error) {
        // 🚨 強化除錯機制：把真正的錯誤印出來！
        console.error("❌ 伺服器錯誤詳細資訊:");
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
        return res.status(200).json({ success: true, result: req.body.image });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 後端啟動於 PORT: ${PORT}`);
});
