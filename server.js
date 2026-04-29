/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (SDXL 完美調教版)
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
    res.status(200).send("🟢 AI 雷雕拍照系統 API 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;

        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        console.log("📥 [請求到達] 收到新的影像處理請求");

        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

        if (REPLICATE_API_TOKEN) {
            console.log("🚀 偵測到 API Token，開始呼叫 Replicate SDXL 完美調教版...");

            // 🌟 核心修正：使用官方 SDXL 1.0，並調教為「精準線稿模式」
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b", 
                input: {
                    image: image,
                    // 咒語更新：明確告訴 AI 這是「這個人的肖像 (portrait of this person)」
                    prompt: "A minimalist black and white line art portrait of this exact person, pure white background, solid black clean vector lines, no shading, simple elegant outline",
                    negative_prompt: "colors, painting, realistic, photorealistic, 3d, shadows, gray, background details, deformed, messy lines",
                    // 關鍵修正 1：降低創意指數，強制保留原本五官輪廓 (0.50 最穩定)
                    prompt_strength: 0.50, 
                    num_inference_steps: 30,
                    // 關鍵修正 2：強制關閉安全濾網，解決「全黑圖片」的問題
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

            console.log("⏳ 等待 AI 算圖中...");
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
                    throw new Error('Replicate 遠端處理失敗: ' + checkRes.data.error);
                }
            }

            console.log("✅ AI 算圖完成！正在轉換格式回傳...");
            
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            const base64Img = "data:image/png;base64," + Buffer.from(imgResponse.data, 'binary').toString('base64');

            return res.status(200).json({ success: true, result: base64Img });

        } else {
            console.log("⚠️ 未設定 REPLICATE_API_TOKEN，原圖退回由前端演算法處理");
            await new Promise(resolve => setTimeout(resolve, 800)); 
            return res.status(200).json({ success: true, result: image });
        }

    } catch (error) {
        console.error("❌ 伺服器處理錯誤:", error.response ? error.response.data : error.message);
        return res.status(200).json({ success: true, result: req.body.image });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 雲端後端已啟動於 PORT: ${PORT}`);
});
