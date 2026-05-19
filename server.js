/**
 * AI互動雷雕拍照系統 - 黃金參數同步版
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
    res.status(200).send("🟢 專屬 LoRA 雷雕系統 (黃金參數版) 正常運行中");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });
        
        const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
        
        if (REPLICATE_API_TOKEN) {
            console.log("🚀 啟動自動化雷雕 pipeline...");

            // 🌟 步驟 1: 預處理 (強制鋪上白底，消除透明背景與雜訊干擾)
            const cameraBuffer = Buffer.from(image.split(",")[1], 'base64');
            const whiteBackgroundBuffer = await sharp(cameraBuffer)
                .flatten({ background: '#FFFFFF' })
                .toBuffer();
            const preProcessedImageBase64 = "data:image/jpeg;base64," + whiteBackgroundBuffer.toString('base64');

            console.log("⏳ 呼叫黃金參數進行算圖...");
            
            // 🌟 步驟 2: 完全套用您的 JSON 黃金參數
            const createRes = await axios.post('https://api.replicate.com/v1/predictions', {
                version: "33001ca5babe41c8aab61166a2b3442f575890edbde81a4c60dd2cf38d909c57", 
                input: {
                    image: preProcessedImageBase64,
                    
                    // 完全同步您的條列式咒語 (使用 \n 換行符號)
                    prompt: "TOK_CUTELINE, redraw the person as a cute Korean minimal line character.\n\nUpper body portrait only.\nCentered composition.\nRemove all background and objects completely.\nTransparent white background.\n\nBean eyes, tiny nose, simple smile, Korean kawaii style.\n\nPure black monochrome outline.\nClean uniform vector lines.\nNo shading, no grayscale, no texture.\n\nExtremely simplified SVG contour.\nLaser engraving ready.",
                    
                    // 同步 JSON 裡的所有詳細參數
                    model: "dev",
                    go_fast: false,
                    lora_scale: 0.8,
                    megapixels: "1",
                    num_outputs: 1,
                    aspect_ratio: "1:1",
                    output_format: "png",
                    guidance_scale: 2.5,
                    output_quality: 80,
                    prompt_strength: 0.78,
                    extra_lora_scale: 1.05,
                    num_inference_steps: 28
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
            
            // 🌟 步驟 3: Sharp 過濾 (只留純黑線條，把剩餘的深色雜訊洗成白底)
            const processedBuffer = await sharp(imgResponse.data)
                .flatten({ background: '#FFFFFF' }) 
                .greyscale()                        
                .threshold(100)                     
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
