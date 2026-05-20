/**
 * AI互動雷雕拍照系統 - SDXL 封神上線版 (解決風格泥濘，精準鎖定眼鏡/特徵)
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
    res.status(200).send("🟢 專屬 SDXL 雷雕系統 (封神上線版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 啟動 SDXL 自動化雷雕 pipeline...");

            // 🌟 步驟 1: 預處理 (鋪上白底，確保乾淨畫布)
            const cameraBuffer = Buffer.from(image.split(",")[1], 'base64');
            const whiteBackgroundBuffer = await sharp(cameraBuffer)
                .flatten({ background: '#FFFFFF' })
                .toBuffer();
            const preProcessedImageBase64 = "data:image/jpeg;base64," + whiteBackgroundBuffer.toString('base64');

            console.log("⏳ 呼叫專屬 SDXL 大腦進行算圖...");
            
            // 🌟 步驟 2: 呼叫您的專屬 SDXL 模型
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                // 👇 您的專屬 SDXL 模型 Version ID
                version: "468313b6a3efd117687f29683d22de9ea741442e67d6443d9fd340db4d612cbe", 
                input: {
                    image: preProcessedImageBase64,
                    
                    // 🟢 正面咒語：明確指示白底黑線與豆豆眼
                    prompt: "TOK_CUTELINE-SDXL, a minimal black and white line art portrait of a person, cute Korean minimal character, bean eyes, simple smile. Pure black vector outline, white fill, plain white background, laser engraving ready.",
                    
                    // 🔴 負面咒語：SDXL 的強大防護罩，絕對禁止陰影和灰階
                    negative_prompt: "colors, shading, gradients, grayscale, solid black fills, realistic, photorealistic, 3d, complex background, noisy lines, artifacts",
                    
                    // 🌟 終極 AB 測試後的「黃金交叉點」參數！
                    // 確保能留下原本的透明眼鏡與馬尾，同時套上可愛塗鴉風格，不產生泥濘感。
                    prompt_strength: 0.68,   // 不高不低，剛好留住眼鏡與五官輪廓
                    guidance_scale: 3.5,     // 調低老闆固執度，讓風格融合得更自然、不生硬
                    lora_scale: 0.8,         // 維持 0.8 確保豆豆眼特徵穩定出現
                    
                    num_inference_steps: 30  // 30步對於機台出圖速度與品質是最佳平衡
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
            
            // 🌟 步驟 3: 終極漂白水 (您認可的 100 分完美去灰階配方)
            const processedBuffer = await sharp(imgResponse.data)
                .flatten({ background: '#FFFFFF' }) 
                .greyscale()                        
                .normalize()
                .threshold(180)   // 完美濾掉雜訊，只留純黑線條
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
