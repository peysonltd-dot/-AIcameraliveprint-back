/**
 * AI互動雷雕拍照系統 - 0.71 黃金平衡版
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
    res.status(200).send("🟢 專屬 LoRA 雷雕系統 (0.71 黃金平衡版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 啟動自動化雷雕 pipeline...");

            // 🌟 步驟 1: 預處理 (鋪上白底，去雜訊)
            const cameraBuffer = Buffer.from(image.split(",")[1], 'base64');
            const whiteBackgroundBuffer = await sharp(cameraBuffer)
                .flatten({ background: '#FFFFFF' })
                .toBuffer();
            const preProcessedImageBase64 = "data:image/jpeg;base64," + whiteBackgroundBuffer.toString('base64');

            console.log("⏳ 呼叫最新 0.71 參數進行算圖...");
            
            // 🌟 步驟 2: 完全套用您截圖中的最新參數
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "33001ca5babe41c8aab61166a2b3442f575890edbde81a4c60dd2cf38d909c57", 
                input: {
                    image: preProcessedImageBase64,
                    
                    // 🌟 採用我們討論出的「極簡斷捨離」咒語，不讓 AI 分心
                    prompt: "TOK_CUTELINE, extremely simplified Korean cute minimal line character. Pure black vector outline, white fill, NO shading, NO solid black areas, NO grayscale. Plain white background. Laser engraving ready.",
                    
                    model: "dev",
                    go_fast: false,
                    lora_scale: 0.8,
                    megapixels: "1",
                    num_outputs: 1,
                    aspect_ratio: "1:1",
                    output_format: "png",
                    extra_lora_scale: 1.05,
                    num_inference_steps: 28,
                    
                    // 👇 根據您的最新截圖更新！
                    guidance_scale: 3.5,
                    prompt_strength: 0.71,
                    output_quality: 80
                }
            }, {
                headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' }
            });

            const predictionUrl = createRes.data.urls.get;
            let isComplete = false;
            let finalImageUrl = null;

            console.log("⏳ 等待 AI 魔法算圖完成...");
            while (!isComplete) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                const checkRes = await axios.get(predictionUrl, { headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` } });
                const status = checkRes.data.status;
                if (status === 'succeeded') {
                    const output = checkRes.data.output;
                    finalImageUrl = Array.isArray(output) ? output[0] : output;
                    isComplete = true;
                } else if (status === 'failed' || status === 'canceled') {
                    throw new Error('Replicate 遠端處理失敗');
                }
            }

            console.log("🎨 算圖完成，啟動 Sharp 終極過濾漂白水...");
            
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            
            // 🌟 步驟 3: Sharp 過濾 (強制白底，洗掉灰色雜訊)
            const processedBuffer = await sharp(imgResponse.data)
                .flatten({ background: '#FFFFFF' }) 
                .greyscale()                        
                .normalize()
                .threshold(180) // 嚴格洗白，確保雷雕只有純黑線條
                .toBuffer();

            const base64Img = "data:image/png;base64," + processedBuffer.toString('base64');
            
            console.log("✅ 純淨黑白雷雕圖已送出！");
            return res.status(200).json({ success: true, result: base64Img });

        } else {
            return res.status(200).json({ success: true, result: image });
        }

    } catch (error) {
        console.error("❌ 處理失敗:", error.response ? JSON.stringify(error.response.data) : error.message);
        return res.status(500).json({ error: '生成失敗' });
    }
});

app.listen(PORT, () => console.log(`🚀 伺服器啟動於 PORT: ${PORT}`));
