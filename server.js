/**
 * AI互動雷雕拍照系統 - 雲端後端伺服器 (修復版：使用官方穩定 AI 模型)
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
            console.log("🚀 偵測到 API Token，開始呼叫 Replicate AI...");

            // 🌟 核心修正：使用官方最新的模型 Endpoint，不綁死版本號，保證穩定不報錯
            const createRes = await axios.post('https://api.replicate.com/v1/models/stability-ai/stable-diffusion-img2img/predictions', {
                input: {
                    image: image,
                    prompt: "masterpiece, pure line art, white background, black lines, clean vector art, strictly black and white, flat, no shadows, no gray",
                    negative_prompt: "shadows, colors, shading, gray, realistic, photorealistic, noise, gradient",
                    prompt_strength: 0.85, // 0.85 讓 AI 有足夠的幅度將照片轉換為純線條
                    num_inference_steps: 30
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
        // 如果 AI 還是有狀況，自動回退給前端處理，確保現場機器不斷線
        return res.status(200).json({ success: true, result: req.body.image });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 雲端後端已啟動於 PORT: ${PORT}`);
});
