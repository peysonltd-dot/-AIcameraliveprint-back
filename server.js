/**
 * AI互動雷雕拍照系統 - SDXL 終極完全體 (專屬大腦 + 完美洗白)
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
    res.status(200).send("🟢 專屬 SDXL 雷雕系統 (完全體) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 啟動 SDXL 自動化雷雕 pipeline...");

            // 🌟 步驟 1: 預處理 (鋪上白底，去雜訊)
            const cameraBuffer = Buffer.from(image.split(",")[1], 'base64');
            const whiteBackgroundBuffer = await sharp(cameraBuffer)
                .flatten({ background: '#FFFFFF' })
                .toBuffer();
            const preProcessedImageBase64 = "data:image/jpeg;base64," + whiteBackgroundBuffer.toString('base64');

            console.log("⏳ 呼叫專屬 SDXL 大腦進行算圖...");
            
            // 🌟 步驟 2: 呼叫您專屬的 SDXL 模型
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                // 👇 您的專屬 Version ID 已精準載入！
                version: "468313b6a3efd117687f29683d22de9ea741442e67d6443d9fd340db4d612cbe", 
                input: {
                    image: preProcessedImageBase64,
                    
                    // 🟢 正面咒語：喚醒您的 SDXL 豆豆眼
                    prompt: "TOK_CUTELINE-SDXL, a minimal black and white line art portrait of a person, cute Korean minimal character, bean eyes, simple smile. Pure black vector outline, white fill, plain white background, laser engraving ready.",
                    
                    // 🔴 負面咒語：SDXL 專屬防護罩，防止變黑炭或太寫實
                    negative_prompt: "colors, shading, gradients, grayscale, solid black fills, realistic, photorealistic, 3d, complex background, noisy lines, artifacts",
                    
                    // 🌟 參數設定 (SDXL 適用)
                    prompt_strength: 0.65, // 黃金特徵鎖定點
                    guidance_scale: 7.5,   // SDXL 的標準 guidance
                    num_inference_steps: 30,
                    lora_scale: 0.8
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
                    // SDXL 產出的圖可能是陣列
                    finalImageUrl = Array.isArray(output) ? output[0] : output;
                    isComplete = true;
                } else if (status === 'failed' || status === 'canceled') {
                    throw new Error('Replicate 遠端處理失敗');
                }
            }

            console.log("🎨 算圖完成，啟動 Sharp 終極洗白...");
            
            const imgResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
            
            // 🌟 步驟 3: 終極漂白水 (您認證過不用再改的完美配方)
            const processedBuffer = await sharp(imgResponse.data)
                .flatten({ background: '#FFFFFF' }) 
                .greyscale()                        
                .normalize()
                .threshold(180) 
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
